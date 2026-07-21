import { randomUUID } from "node:crypto";
import { z } from "zod";

export const profileUpdatedEventSchema = z.object({
  specVersion: z.literal("1.0"),
  eventId: z.uuid(),
  eventType: z.literal("profile.updated"),
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(300),
  profile: z.object({
    githubId: z.string().min(1),
    login: z.string().min(1),
    name: z.string().nullable(),
    htmlUrl: z.url(),
    publicRepos: z.number().int().nonnegative(),
    followers: z.number().int().nonnegative(),
    following: z.number().int().nonnegative(),
    githubUpdatedAt: z.string().nullable()
  })
});

export type ProfileUpdatedEvent = z.infer<typeof profileUpdatedEventSchema>;

type ProfileEventSource = ProfileUpdatedEvent["profile"] & {
  fetchedAt?: string;
};

export function createProfileUpdatedEvent(
  profile: ProfileEventSource,
  options: { eventId?: string; occurredAt?: string } = {}
): ProfileUpdatedEvent {
  const eventId = options.eventId ?? randomUUID();
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const sourceRevision = profile.githubUpdatedAt ?? profile.fetchedAt ?? eventId;

  return {
    specVersion: "1.0",
    eventId,
    eventType: "profile.updated",
    occurredAt,
    idempotencyKey: `${profile.githubId}:${sourceRevision}`,
    profile: {
      githubId: profile.githubId,
      login: profile.login,
      name: profile.name,
      htmlUrl: profile.htmlUrl,
      publicRepos: profile.publicRepos,
      followers: profile.followers,
      following: profile.following,
      githubUpdatedAt: profile.githubUpdatedAt
    }
  };
}
