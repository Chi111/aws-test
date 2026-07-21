import { describe, expect, it, vi } from "vitest";
import { handler, processProfileEventRecord } from "./profile-event-worker";

const validEvent = {
  specVersion: "1.0",
  eventId: "70d7f9d8-c3c1-4d1b-b67e-bfcf1f8511bc",
  eventType: "profile.updated",
  occurredAt: "2026-07-21T01:02:03.000Z",
  idempotencyKey: "456:2026-07-21T01:02:03Z",
  profile: {
    githubId: "456",
    login: "event-user",
    name: "Event User",
    htmlUrl: "https://github.com/event-user",
    publicRepos: 4,
    followers: 5,
    following: 6,
    githubUpdatedAt: "2026-07-21T01:02:03Z"
  }
};

describe("profile event worker", () => {
  it("accepts a valid profile.updated event", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      processProfileEventRecord({ messageId: "message-1", body: JSON.stringify(validEvent) })
    ).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"eventType":"profile.updated"'));

    info.mockRestore();
  });

  it("returns only invalid records as partial batch failures", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handler({
      Records: [
        { messageId: "good-message", body: JSON.stringify(validEvent) },
        { messageId: "bad-json", body: "{" },
        { messageId: "bad-schema", body: JSON.stringify({ eventType: "unknown" }) }
      ]
    });

    expect(response).toEqual({
      batchItemFailures: [{ itemIdentifier: "bad-json" }, { itemIdentifier: "bad-schema" }]
    });
    expect(error).toHaveBeenCalledTimes(2);

    info.mockRestore();
    error.mockRestore();
  });
});
