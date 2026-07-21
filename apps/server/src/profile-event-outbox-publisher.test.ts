import { describe, expect, it, vi } from "vitest";
import { publishClaimedEvents } from "./profile-event-outbox-publisher";

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

describe("profile event outbox publisher", () => {
  it("marks valid events published and releases invalid events for retry", async () => {
    const publish = vi.fn(async () => undefined);
    const markPublished = vi.fn(async () => undefined);
    const releaseFailed = vi.fn(async () => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await publishClaimedEvents(
      [
        { eventId: validEvent.eventId, payload: validEvent },
        { eventId: "a4ca8e21-9862-4018-ada3-7eb1d2c5d66f", payload: { eventType: "invalid" } }
      ],
      { publish, markPublished, releaseFailed }
    );

    expect(result).toEqual({ claimed: 2, published: 1, failed: 1 });
    expect(publish).toHaveBeenCalledOnce();
    expect(markPublished).toHaveBeenCalledWith(validEvent.eventId);
    expect(releaseFailed).toHaveBeenCalledWith("a4ca8e21-9862-4018-ada3-7eb1d2c5d66f", expect.any(Error));
    error.mockRestore();
  });
});
