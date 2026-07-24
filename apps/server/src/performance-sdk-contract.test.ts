import { createPerformanceUploadEvent, type PerformanceEvent } from "@github-profile-sam/performance-sdk/contract";
import { describe, expect, it } from "vitest";
import { performanceEventSchema } from "./performance-events";

describe("browser SDK and ingestion API contract", () => {
  it("accepts the SDK payload without retaining URL secrets", () => {
    const event: PerformanceEvent = {
      schemaVersion: "1.0",
      eventId: "0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3",
      appId: "github-profile-web",
      release: "1.2.3",
      environment: "test",
      sessionId: "c2a9d808-4f06-4ccb-b7bf-fd43176591d6",
      occurredAt: "2026-07-24T00:00:00.000Z",
      type: "api",
      page: "/profiles?token=page-secret",
      name: "https://api.example.com/user?token=request-secret",
      duration: 123,
      statusCode: 200,
      success: true
    };

    const upload = createPerformanceUploadEvent(event, "https://app.example.com/");

    expect(performanceEventSchema.safeParse(upload).success).toBe(true);
    expect(JSON.stringify(upload)).not.toMatch(/token|secret/);
    expect(upload).toMatchObject({ eventType: "http", route: "/profiles", name: "api-user", unit: "ms" });
  });
});
