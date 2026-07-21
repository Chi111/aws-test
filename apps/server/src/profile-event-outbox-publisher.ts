import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { createDatabaseSslConfig } from "@github-profile-sam/db/ssl";
import { Pool } from "pg";
import { profileUpdatedEventSchema } from "./profile-events";

export type ClaimedEvent = {
  eventId: string;
  payload: unknown;
};

type Runtime = {
  pool: Pool;
  sns: SNSClient;
  topicArn: string;
};

type PublishDependencies = {
  publish(event: ReturnType<typeof profileUpdatedEventSchema.parse>): Promise<void>;
  markPublished(eventId: string): Promise<void>;
  releaseFailed(eventId: string, error: unknown): Promise<void>;
};

let runtime: Runtime | undefined;

function getRuntime(): Runtime {
  if (runtime) {
    return runtime;
  }
  const databaseUrl = process.env.DATABASE_URL;
  const topicArn = process.env.PROFILE_EVENTS_TOPIC_ARN;
  if (!databaseUrl || !topicArn) {
    throw new Error("DATABASE_URL and PROFILE_EVENTS_TOPIC_ARN are required");
  }
  runtime = {
    pool: new Pool({
      connectionString: databaseUrl,
      ssl: createDatabaseSslConfig({ nodeEnv: process.env.NODE_ENV, sslCaPath: process.env.DATABASE_SSL_CA_PATH })
    }),
    sns: new SNSClient({}),
    topicArn
  };
  return runtime;
}

async function claimPendingEvents(pool: Pool, limit = 10): Promise<ClaimedEvent[]> {
  const result = await pool.query<ClaimedEvent>(
    `with candidates as (
       select event_id
       from profile_event_outbox
       where published_at is null
         and (processing_at is null or processing_at < now() - interval '5 minutes')
       order by created_at
       limit $1
       for update skip locked
     )
     update profile_event_outbox as outbox
     set processing_at = now(),
         attempt_count = outbox.attempt_count + 1,
         last_error = null
     from candidates
     where outbox.event_id = candidates.event_id
     returning outbox.event_id as "eventId", outbox.payload`,
    [limit]
  );
  return result.rows;
}

async function markPublished(pool: Pool, eventId: string) {
  await pool.query(
    `update profile_event_outbox
     set published_at = now(), processing_at = null, last_error = null
     where event_id = $1`,
    [eventId]
  );
}

async function releaseFailedEvent(pool: Pool, eventId: string, error: unknown) {
  await pool.query(
    `update profile_event_outbox
     set processing_at = null, last_error = $2
     where event_id = $1`,
    [eventId, error instanceof Error ? error.message.slice(0, 2000) : "Unknown SNS publish error"]
  );
}

export async function publishClaimedEvents(events: ClaimedEvent[], dependencies: PublishDependencies) {
  let published = 0;
  let failed = 0;

  for (const row of events) {
    try {
      const event = profileUpdatedEventSchema.parse(row.payload);
      await dependencies.publish(event);
      await dependencies.markPublished(row.eventId);
      published += 1;
    } catch (error) {
      await dependencies.releaseFailed(row.eventId, error);
      console.error("Failed to publish profile outbox event", { eventId: row.eventId, error });
      failed += 1;
    }
  }

  return { claimed: events.length, published, failed };
}

export async function handler() {
  const current = getRuntime();
  const events = await claimPendingEvents(current.pool);
  return publishClaimedEvents(events, {
    publish: async (event) => {
      await current.sns.send(
        new PublishCommand({
          TopicArn: current.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: {
            eventType: { DataType: "String", StringValue: event.eventType }
          }
        })
      );
    },
    markPublished: (eventId) => markPublished(current.pool, eventId),
    releaseFailed: (eventId, error) => releaseFailedEvent(current.pool, eventId, error)
  });
}
