import { describe, expect, it, vi } from "vitest";
import { cleanupPerformanceEvents, processClaimedPerformanceEvents } from "./performance-log-worker";

const validPayload = {
  eventId: "0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3",
  eventType: "navigation",
  occurredAt: "2026-07-24T00:00:00.000Z",
  appId: "github-profile",
  sessionId: "opaque_session_123456",
  route: "/",
  name: "navigation.duration",
  value: 125,
  unit: "ms",
  sdkVersion: "1.0.0"
};

describe("performance log worker", () => {
  it("enforces bounded retention for raw and cleaned performance data", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 5 });

    await expect(cleanupPerformanceEvents({ query } as never, 7, 90)).resolves.toEqual({
      rawDeleted: 3,
      cleanDeleted: 5
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("where received_at"),
      [7]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("performance_events"),
      [90]
    );
  });

  it("cleans valid rows and permanently rejects invalid rows", async () => {
    const dependencies = {
      save: vi.fn(async () => undefined),
      markProcessed: vi.fn(async () => undefined),
      markRejected: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined)
    };

    const result = await processClaimedPerformanceEvents(
      [
        { eventId: validPayload.eventId, payload: validPayload, attemptCount: 1 },
        { eventId: "invalid", payload: { eventType: "unknown" }, attemptCount: 1 }
      ],
      "worker-secret",
      dependencies
    );

    expect(result).toEqual({ claimed: 2, processed: 1, rejected: 1, failed: 0 });
    expect(dependencies.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: validPayload.eventId, sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    );
    expect(dependencies.markProcessed).toHaveBeenCalledWith(validPayload.eventId);
    expect(dependencies.markRejected).toHaveBeenCalledWith("invalid", expect.stringContaining("schema validation failed"));
  });

  it("releases transient failures and rejects rows after five attempts", async () => {
    const save = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const dependencies = {
      save,
      markProcessed: vi.fn(async () => undefined),
      markRejected: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined)
    };

    const result = await processClaimedPerformanceEvents(
      [
        { eventId: validPayload.eventId, payload: validPayload, attemptCount: 2 },
        {
          eventId: "b95719c8-40c3-4b31-9542-e239852e66a0",
          payload: { ...validPayload, eventId: "b95719c8-40c3-4b31-9542-e239852e66a0" },
          attemptCount: 5
        }
      ],
      "worker-secret",
      dependencies
    );

    expect(result).toEqual({ claimed: 2, processed: 0, rejected: 1, failed: 1 });
    expect(dependencies.release).toHaveBeenCalledWith(validPayload.eventId, expect.any(Error));
    expect(dependencies.markRejected).toHaveBeenCalledWith(
      "b95719c8-40c3-4b31-9542-e239852e66a0",
      expect.stringContaining("after 5 attempts")
    );
  });
});
