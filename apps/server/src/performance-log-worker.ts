import { createDatabaseSslConfig } from "@github-profile-sam/db/ssl";
import { Pool } from "pg";
import { cleanPerformanceEvent, performanceEventSchema, type CleanPerformanceEvent } from "./performance-events";

export type ClaimedPerformanceEvent = {
  eventId: string;
  payload: unknown;
  attemptCount: number;
};

type WorkerDependencies = {
  save(event: CleanPerformanceEvent): Promise<void>;
  markProcessed(eventId: string): Promise<void>;
  markRejected(eventId: string, reason: string): Promise<void>;
  release(eventId: string, error: unknown): Promise<void>;
};

export async function processClaimedPerformanceEvents(
  rows: ClaimedPerformanceEvent[],
  hashSecret: string,
  dependencies: WorkerDependencies
) {
  let processed = 0;
  let rejected = 0;
  let failed = 0;

  for (const row of rows) {
    const parsed = performanceEventSchema.safeParse(row.payload);
    if (!parsed.success) {
      const reason = `schema validation failed: ${parsed.error.issues[0]?.message ?? "invalid event"}`.slice(0, 500);
      await dependencies.markRejected(row.eventId, reason);
      rejected += 1;
      continue;
    }

    try {
      await dependencies.save(cleanPerformanceEvent(parsed.data, hashSecret));
      await dependencies.markProcessed(row.eventId);
      processed += 1;
    } catch (error) {
      if (row.attemptCount >= 5) {
        await dependencies.markRejected(
          row.eventId,
          `processing failed after ${row.attemptCount} attempts: ${
            error instanceof Error ? error.message : "unknown error"
          }`.slice(0, 500)
        );
        rejected += 1;
      } else {
        await dependencies.release(row.eventId, error);
        failed += 1;
      }
    }
  }

  return { claimed: rows.length, processed, rejected, failed };
}

export async function claimPendingPerformanceEvents(pool: Pool, limit: number) {
  const result = await pool.query<ClaimedPerformanceEvent>(
    `with candidates as (
       select event_id
       from performance_events_raw
       where processed_at is null
         and rejected_at is null
         and (processing_at is null or processing_at < now() - interval '5 minutes')
       order by received_at
       limit $1
       for update skip locked
     )
     update performance_events_raw as raw
     set processing_at = now(),
         attempt_count = raw.attempt_count + 1
     from candidates
     where raw.event_id = candidates.event_id
     returning raw.event_id as "eventId", raw.payload, raw.attempt_count as "attemptCount"`,
    [limit]
  );
  return result.rows;
}

export async function runWorkerBatch(pool: Pool, batchSize: number, hashSecret: string) {
  const rows = await claimPendingPerformanceEvents(pool, batchSize);
  return processClaimedPerformanceEvents(rows, hashSecret, {
    save: async (event) => {
      await pool.query(
        `insert into performance_events (
           event_id, event_type, occurred_at, app_id, session_hash, route, name, value, unit,
           rating, app_version, sdk_version, initiator_type, navigation_type, status_code, message
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
         ) on conflict (event_id) do nothing`,
        [
          event.eventId,
          event.eventType,
          event.occurredAt,
          event.appId,
          event.sessionHash,
          event.route,
          event.name,
          event.value,
          event.unit,
          event.rating,
          event.appVersion,
          event.sdkVersion,
          event.initiatorType,
          event.navigationType,
          event.statusCode,
          event.message
        ]
      );
    },
    markProcessed: async (eventId) => {
      await pool.query(
        `update performance_events_raw
         set processed_at = now(),
             processing_at = null,
             rejection_reason = null,
             payload = jsonb_build_object('eventId', event_id, 'eventType', event_type)
         where event_id = $1`,
        [eventId]
      );
    },
    markRejected: async (eventId, reason) => {
      await pool.query(
        `update performance_events_raw
         set rejected_at = now(),
             processing_at = null,
             rejection_reason = $2,
             payload = jsonb_build_object('eventId', event_id, 'eventType', event_type)
         where event_id = $1`,
        [eventId, reason]
      );
    },
    release: async (eventId, error) => {
      console.error("Performance event processing failed", {
        eventId,
        error: error instanceof Error ? error.message : "unknown error"
      });
      await pool.query(
        `update performance_events_raw
         set processing_at = null, rejection_reason = $2
         where event_id = $1`,
        [eventId, (error instanceof Error ? error.message : "unknown error").slice(0, 500)]
      );
    }
  });
}

export async function cleanupPerformanceEvents(pool: Pool, rawRetentionDays: number, cleanRetentionDays: number) {
  const [raw, clean] = await Promise.all([
    pool.query(
      `delete from performance_events_raw
       where received_at < now() - make_interval(days => $1)`,
      [rawRetentionDays]
    ),
    pool.query(
      `delete from performance_events
       where occurred_at < now() - make_interval(days => $1)`,
      [cleanRetentionDays]
    )
  ]);
  return { rawDeleted: raw.rowCount ?? 0, cleanDeleted: clean.rowCount ?? 0 };
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export async function runPerformanceLogWorker() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const pollIntervalMs = positiveInteger(process.env.PERFORMANCE_WORKER_POLL_INTERVAL_MS, 2_000, 60_000);
  const batchSize = positiveInteger(process.env.PERFORMANCE_WORKER_BATCH_SIZE, 100, 1_000);
  const rawRetentionDays = positiveInteger(process.env.PERFORMANCE_RAW_RETENTION_DAYS, 7, 365);
  const cleanRetentionDays = positiveInteger(process.env.PERFORMANCE_CLEAN_RETENTION_DAYS, 90, 3_650);
  const hashSecret = process.env.PERFORMANCE_HASH_SECRET;
  if (!hashSecret || hashSecret.length < 32) {
    throw new Error("PERFORMANCE_HASH_SECRET must contain at least 32 characters");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: createDatabaseSslConfig({
      nodeEnv: process.env.NODE_ENV,
      sslCaPath: process.env.DATABASE_SSL_CA_PATH
    })
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let nextCleanupAt = 0;

  console.info("Performance log worker started", {
    pollIntervalMs,
    batchSize,
    rawRetentionDays,
    cleanRetentionDays
  });
  try {
    while (!stopping) {
      if (Date.now() >= nextCleanupAt) {
        const cleanup = await cleanupPerformanceEvents(pool, rawRetentionDays, cleanRetentionDays).catch((error) => {
          console.error("Performance retention cleanup failed", {
            error: error instanceof Error ? error.message : "unknown error"
          });
          return null;
        });
        if (cleanup && (cleanup.rawDeleted > 0 || cleanup.cleanDeleted > 0)) {
          console.info("Performance retention cleanup completed", cleanup);
        }
        nextCleanupAt = Date.now() + 60 * 60 * 1_000;
      }
      const result = await runWorkerBatch(pool, batchSize, hashSecret).catch((error) => {
        console.error("Performance worker batch failed", {
          error: error instanceof Error ? error.message : "unknown error"
        });
        return { claimed: 0, processed: 0, rejected: 0, failed: 1 };
      });
      if (result.claimed > 0) {
        console.info("Performance worker batch completed", result);
      }
      if (!stopping && result.claimed < batchSize) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  } finally {
    await pool.end();
    console.info("Performance log worker stopped");
  }
}

if (process.argv[1]?.endsWith("performance-log-worker.mjs")) {
  void runPerformanceLogWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
