import { createHmac } from "node:crypto";
import { z } from "zod";

export const PERFORMANCE_BATCH_LIMIT = 50;
export const PERFORMANCE_BODY_LIMIT_BYTES = 128 * 1024;
export const PERFORMANCE_EVENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PERFORMANCE_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const safeIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/);

const versionIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/);

const routeSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^\/[^\s?#]*$/, "route must be a path without a query string or fragment");

export const performanceEventSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.enum(["page-view", "web-vital", "navigation", "resource", "http", "error", "custom"]),
    occurredAt: z.iso.datetime({ offset: true }),
    appId: safeIdentifier,
    sessionId: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/, "sessionId must be an opaque identifier"),
    route: routeSchema,
    name: safeIdentifier,
    value: z.number().finite().nonnegative().max(86_400_000),
    unit: z.enum(["ms", "score", "bytes", "count"]),
    rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
    appVersion: versionIdentifier.optional(),
    sdkVersion: versionIdentifier,
    message: z.string().trim().min(1).max(500).optional(),
    dimensions: z
      .object({
        initiatorType: safeIdentifier.optional(),
        navigationType: z.enum(["navigate", "reload", "back-forward", "prerender"]).optional(),
        statusCode: z.number().int().min(100).max(599).optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((event, context) => {
    if (event.eventType === "error" && !event.message) {
      context.addIssue({ code: "custom", path: ["message"], message: "message is required for error events" });
    }
    if (event.eventType === "page-view" && (event.unit !== "count" || event.value !== 1)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "page-view events must use value 1 and unit count"
      });
    }
    if (["navigation", "resource", "http"].includes(event.eventType) && event.unit !== "ms") {
      context.addIssue({ code: "custom", path: ["unit"], message: `${event.eventType} events must use unit ms` });
    }
  });

export const performanceBatchSchema = z
  .object({
    events: z.array(performanceEventSchema).min(1).max(PERFORMANCE_BATCH_LIMIT)
  })
  .strict()
  .superRefine(({ events }, context) => {
    const seen = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (seen.has(event.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: "eventId must be unique within a batch"
        });
      }
      seen.add(event.eventId);
    }
  });

export type PerformanceEvent = z.infer<typeof performanceEventSchema>;

export type CleanPerformanceEvent = {
  eventId: string;
  eventType: PerformanceEvent["eventType"];
  occurredAt: string;
  appId: string;
  sessionHash: string;
  route: string;
  name: string;
  value: number;
  unit: PerformanceEvent["unit"];
  rating: PerformanceEvent["rating"] | null;
  appVersion: string | null;
  sdkVersion: string;
  initiatorType: string | null;
  navigationType: string | null;
  statusCode: number | null;
  message: string | null;
};

export type PerformanceOverviewQuery = {
  from: string;
  to: string;
  window: "24h" | "7d" | "30d" | "custom";
  appId?: string;
  route?: string;
};

export type PerformanceOverview = {
  apps: string[];
  summary: {
    events: number;
    pageViews: number;
    errors: number;
    errorRate: number;
    avgDuration: number;
    p75: number;
    p95: number;
    uniqueSessions: number;
  };
  trends: Array<{
    bucket: string;
    label: string;
    pageViews: number;
    errors: number;
    avgDuration: number;
    p95: number;
  }>;
  vitals: Array<{
    name: string;
    value: number;
    rating: PerformanceEvent["rating"];
    samples: number;
  }>;
  slowPages: Array<{
    route: string;
    avgDuration: number;
    p95: number;
    count: number;
  }>;
  topErrors: Array<{
    message: string;
    count: number;
    lastSeen: string;
  }>;
  generatedAt: string;
  window: PerformanceOverviewQuery;
};

export function parsePerformanceBatch(payload: unknown, now = new Date()) {
  const parsed = performanceBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return parsed;
  }

  const earliest = now.getTime() - PERFORMANCE_EVENT_MAX_AGE_MS;
  const latest = now.getTime() + PERFORMANCE_EVENT_MAX_FUTURE_SKEW_MS;
  for (const [index, event] of parsed.data.events.entries()) {
    const timestamp = Date.parse(event.occurredAt);
    if (timestamp < earliest || timestamp > latest) {
      return {
        success: false as const,
        error: new z.ZodError([
          {
            code: "custom",
            path: ["events", index, "occurredAt"],
            message: "occurredAt is outside the accepted collection window"
          }
        ])
      };
    }
  }

  return parsed;
}

export function cleanPerformanceEvent(event: PerformanceEvent, hashSecret: string): CleanPerformanceEvent {
  const dimensions = event.dimensions;
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: new Date(event.occurredAt).toISOString(),
    appId: event.appId,
    sessionHash: createHmac("sha256", hashSecret).update(event.sessionId).digest("hex"),
    route: sanitizeRoute(event.route),
    name: event.name,
    value: event.value,
    unit: event.unit,
    rating: event.rating ?? null,
    appVersion: event.appVersion ?? null,
    sdkVersion: event.sdkVersion,
    initiatorType: dimensions?.initiatorType ?? null,
    navigationType: dimensions?.navigationType ?? null,
    statusCode: dimensions?.statusCode ?? null,
    message: event.message ? sanitizeErrorMessage(event.message) : null
  };
}

export function cleanPerformanceEvents(events: PerformanceEvent[], hashSecret: string) {
  return events.map((event) => cleanPerformanceEvent(event, hashSecret));
}

export function sanitizePerformanceEvent(event: PerformanceEvent): PerformanceEvent {
  return {
    ...event,
    route: sanitizeRoute(event.route),
    ...(event.message ? { message: sanitizeErrorMessage(event.message) } : {})
  };
}

export function sanitizeRoute(route: string) {
  const identifierCollections = new Set([
    "accounts",
    "customers",
    "items",
    "orders",
    "organizations",
    "orgs",
    "profiles",
    "projects",
    "repos",
    "sessions",
    "teams",
    "users"
  ]);
  const segments = route.split("/");
  return segments
    .map((segment, index) => {
      const parent = (segments[index - 1] ?? "").toLowerCase();
      return identifierCollections.has(parent) ||
        /^\d+$/.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
        /^[A-Za-z0-9_%+=-]{20,}$/.test(segment) ||
        /%40|@/i.test(segment)
        ? ":id"
        : segment;
    })
    .join("/");
}

export function sanitizeErrorMessage(message: string) {
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-pem]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-key]")
    .replace(/\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{20,}\b/g, "[redacted-token]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]")
    .replace(/\b(?:postgres(?:ql)?:\/\/)[^@\s]+@/gi, "postgresql://[redacted]@")
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]*/gi, "$1[redacted]")
    .replace(
      /((?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|session|jwt|credential|private[_-]?key|database[_-]?url|connection[_-]?string)\s*[:=]\s*)[^\s,;}\]]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "[redacted-opaque]")
    .slice(0, 500);
}
