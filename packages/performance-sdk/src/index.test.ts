import { describe, expect, it } from "vitest";
import { createPerformanceUploadEvent, sanitizePerformanceUrl, type PerformanceEvent } from "./index";

describe("performance SDK privacy helpers", () => {
  it("drops query strings and hashes from collected URLs", () => {
    expect(
      sanitizePerformanceUrl(
        "https://example.com/profile?token=ghp_do_not_collect#private",
        "https://example.com/"
      )
    ).toBe("/profile");
    expect(sanitizePerformanceUrl("/profiles/123/0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3")).toBe(
      "/profiles/:id/:id"
    );
    expect(sanitizePerformanceUrl("/users/alice/settings")).toBe("/users/:id/settings");
    expect(sanitizePerformanceUrl("/orders/ABC123")).toBe("/orders/:id");
  });

  it("redacts common secret values from malformed URL text", () => {
    expect(sanitizePerformanceUrl("/broken?token=sk-do-not-collect value")).not.toContain("do-not-collect");
  });

  it("builds the strict server ingestion contract", () => {
    const event: PerformanceEvent = {
      schemaVersion: "1.0",
      eventId: "0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3",
      appId: "github-profile-web",
      release: "1.2.3",
      environment: "test",
      sessionId: "c2a9d808-4f06-4ccb-b7bf-fd43176591d6",
      occurredAt: "2026-07-24T00:00:00.000Z",
      type: "api",
      page: "/profiles?token=secret",
      name: "https://api.example.com/user?token=secret",
      duration: 123.456,
      statusCode: 200,
      success: true,
      metadata: { method: "GET" }
    };

    expect(createPerformanceUploadEvent(event, "https://app.example.com/")).toEqual({
      eventId: event.eventId,
      eventType: "http",
      occurredAt: event.occurredAt,
      appId: "github-profile-web",
      sessionId: event.sessionId,
      route: "/profiles",
      name: "api-user",
      value: 123.46,
      unit: "ms",
      appVersion: "v-1.2.3",
      sdkVersion: "browser-0.1.0",
      dimensions: { statusCode: 200 }
    });
    expect(JSON.stringify(createPerformanceUploadEvent(event, "https://app.example.com/"))).not.toMatch(/token|secret/);
  });

  it("redacts credentials from custom error messages before upload", () => {
    const upload = createPerformanceUploadEvent(
      {
        schemaVersion: "1.0",
        eventId: "58275e0e-e858-467b-a764-7c315e0635a1",
        appId: "github-profile-web",
        release: "1.2.3",
        environment: "test",
        sessionId: "c2a9d808-4f06-4ccb-b7bf-fd43176591d6",
        occurredAt: "2026-07-24T00:00:00.000Z",
        type: "error",
        page: "/",
        name: "authorization=Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk"
      },
      "https://app.example.com/"
    );

    expect(upload.message).toBe("authorization=[redacted]");
    expect(JSON.stringify(upload)).not.toContain("eyJabcdefghijk");

    const cookieUpload = createPerformanceUploadEvent(
      {
        schemaVersion: "1.0",
        eventId: "7ce42ef2-0f50-4ae4-aab7-e55869560d01",
        appId: "github-profile-web",
        release: "1.2.3",
        environment: "test",
        sessionId: "c2a9d808-4f06-4ccb-b7bf-fd43176591d6",
        occurredAt: "2026-07-24T00:00:00.000Z",
        type: "error",
        page: "/",
        name: "cookie: sid=abc; user=alice"
      },
      "https://app.example.com/"
    );
    expect(cookieUpload.message).toBe("cookie: [redacted]");
  });
});
