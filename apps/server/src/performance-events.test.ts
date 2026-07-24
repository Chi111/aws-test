import { describe, expect, it } from "vitest";
import {
  cleanPerformanceEvent,
  parsePerformanceBatch,
  performanceBatchSchema,
  sanitizeErrorMessage,
  sanitizeRoute
} from "./performance-events";

const event = {
  eventId: "0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3",
  eventType: "web-vital" as const,
  occurredAt: "2026-07-24T00:00:00.000Z",
  appId: "github-profile",
  sessionId: "opaque_session_123456",
  route: "/profiles/123",
  name: "LCP",
  value: 2_100,
  unit: "ms" as const,
  rating: "good" as const,
  sdkVersion: "1.0.0"
};

describe("performance event contract", () => {
  it("is strict, bounded, and rejects duplicate event ids", () => {
    expect(performanceBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    expect(performanceBatchSchema.safeParse({ events: [{ ...event, url: "https://example.com/?secret=x" }] }).success).toBe(
      false
    );
    expect(performanceBatchSchema.safeParse({ events: [{ ...event, route: "/?secret=x" }] }).success).toBe(false);
    expect(performanceBatchSchema.safeParse({ events: [event, event] }).success).toBe(false);
    expect(performanceBatchSchema.safeParse({ events: Array.from({ length: 51 }, (_, index) => ({ ...event, eventId: index })) }).success).toBe(false);
  });

  it("enforces event-specific semantics and collection time bounds", () => {
    const wrongPageView = {
      ...event,
      eventType: "page-view",
      name: "page.view",
      value: 2,
      unit: "count"
    };
    expect(performanceBatchSchema.safeParse({ events: [wrongPageView] }).success).toBe(false);
    expect(
      parsePerformanceBatch(
        { events: [event] },
        new Date("2026-09-01T00:00:00.000Z")
      ).success
    ).toBe(false);
  });

  it("hashes session ids and removes direct identifiers from errors", () => {
    const cleaned = cleanPerformanceEvent(event, "secret");
    expect(cleaned.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cleaned.route).toBe("/profiles/:id");
    expect(sanitizeRoute("/users/sam%40example.com")).toBe("/users/:id");
    expect(sanitizeRoute("/users/alice/settings")).toBe("/users/:id/settings");
    expect(sanitizeRoute("/orders/ABC123")).toBe("/orders/:id");
    expect(JSON.stringify(cleaned)).not.toContain(event.sessionId);
    expect(
      sanitizeErrorMessage("User sam@example.com failed at https://example.com/path?token=secret#debug")
    ).toBe("User [redacted-email] failed at [redacted-url]");
    expect(
      sanitizeErrorMessage(
        "authorization: Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk AWS AKIAABCDEFGHIJKLMNOP cookie=session-value"
      )
    ).not.toMatch(/eyJ|AKIAABCDEFGHIJKLMNOP|session-value/);
    expect(sanitizeErrorMessage("cookie: sid=abc; user=alice")).toBe("cookie: [redacted]");
  });
});
