export type PerformanceEventType = "page_view" | "navigation" | "resource" | "web_vital" | "api" | "error";

export type PerformanceRating = "good" | "needs-improvement" | "poor";

export type PerformanceEvent = {
  schemaVersion: "1.0";
  eventId: string;
  appId: string;
  release: string;
  environment: string;
  sessionId: string;
  occurredAt: string;
  type: PerformanceEventType;
  page: string;
  name: string;
  duration?: number;
  value?: number;
  rating?: PerformanceRating;
  statusCode?: number;
  success?: boolean;
  metadata?: Record<string, string | number | boolean>;
};

export type PerformanceUploadEvent = {
  eventId: string;
  eventType: "page-view" | "web-vital" | "navigation" | "resource" | "http" | "error";
  occurredAt: string;
  appId: string;
  sessionId: string;
  route: string;
  name: string;
  value: number;
  unit: "ms" | "score" | "count";
  rating?: PerformanceRating;
  appVersion: string;
  sdkVersion: string;
  message?: string;
  dimensions?: {
    initiatorType?: string;
    statusCode?: number;
  };
};

const MAX_TEXT_LENGTH = 500;
const SDK_VERSION = "browser-0.1.0";

function finite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : undefined;
}

export function sanitizePerformanceText(value: string, maxLength = MAX_TEXT_LENGTH) {
  return value
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
    .slice(0, maxLength);
}

function sanitizePathIdentifiers(pathname: string) {
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
  const segments = pathname.split("/");
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

export function sanitizePerformanceUrl(value: string, base = "http://localhost") {
  try {
    const url = new URL(value, base);
    return sanitizePerformanceText(sanitizePathIdentifiers(url.pathname || "/"));
  } catch {
    return sanitizePerformanceText(sanitizePathIdentifiers(value.split(/[?#]/, 1)[0] || "/"));
  }
}

function routeFrom(value: string, base: string) {
  const path = sanitizePerformanceUrl(value, base);
  return (path.startsWith("/") ? path : `/${path}`).slice(0, 512);
}

function safeIdentifier(value: string, fallback: string) {
  let normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  if (normalized && !/^[a-zA-Z]/.test(normalized)) {
    normalized = `v-${normalized}`.slice(0, 80);
  }
  return normalized || fallback;
}

export function createPerformanceUploadEvent(event: PerformanceEvent, base: string): PerformanceUploadEvent {
  const typeMap = {
    page_view: "page-view",
    navigation: "navigation",
    resource: "resource",
    web_vital: "web-vital",
    api: "http",
    error: "error"
  } as const;
  const value =
    event.type === "page_view" || event.type === "error"
      ? 1
      : finite(event.value ?? event.duration) ?? 0;
  const unit =
    event.type === "page_view" || event.type === "error"
      ? "count"
      : event.type === "web_vital" && event.name === "CLS"
        ? "score"
        : "ms";
  const dimensions: { initiatorType?: string; statusCode?: number } = {};
  const initiatorType = event.metadata?.initiatorType;
  if (typeof initiatorType === "string") {
    dimensions.initiatorType = safeIdentifier(initiatorType, "other");
  }
  if (event.statusCode !== undefined) {
    dimensions.statusCode = event.statusCode;
  }
  return {
    eventId: event.eventId,
    eventType: typeMap[event.type],
    occurredAt: event.occurredAt,
    appId: safeIdentifier(event.appId, "web-app"),
    sessionId: event.sessionId,
    route: routeFrom(event.page, base),
    name: safeIdentifier(
      event.type === "error"
        ? "javascript-error"
        : event.type === "api" || event.type === "resource"
          ? `${event.type}-${sanitizePerformanceUrl(event.name, base)}`
          : event.name,
      "unnamed"
    ),
    value,
    unit,
    appVersion: safeIdentifier(event.release, "local"),
    sdkVersion: SDK_VERSION,
    ...(event.rating ? { rating: event.rating } : {}),
    ...(event.type === "error" ? { message: sanitizePerformanceText(event.name) } : {}),
    ...(Object.keys(dimensions).length > 0 ? { dimensions } : {})
  };
}
