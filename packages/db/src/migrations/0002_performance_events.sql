CREATE TABLE IF NOT EXISTS "performance_events_raw" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" varchar(500),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_events_raw_pending_idx" ON "performance_events_raw" USING btree ("processed_at","rejected_at","received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"app_id" varchar(80) NOT NULL,
	"session_hash" varchar(64) NOT NULL,
	"route" varchar(512) NOT NULL,
	"name" varchar(80) NOT NULL,
	"value" double precision NOT NULL,
	"unit" varchar(16) NOT NULL,
	"rating" varchar(32),
	"app_version" varchar(80),
	"sdk_version" varchar(80) NOT NULL,
	"initiator_type" varchar(80),
	"navigation_type" varchar(32),
	"status_code" integer,
	"message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_events_occurred_at_idx" ON "performance_events" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_events_app_occurred_at_idx" ON "performance_events" USING btree ("app_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_events_route_occurred_at_idx" ON "performance_events" USING btree ("route","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_events_name_occurred_at_idx" ON "performance_events" USING btree ("name","occurred_at");
