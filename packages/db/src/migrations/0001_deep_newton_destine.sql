CREATE TABLE "profile_event_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "profile_event_outbox_pending_idx" ON "profile_event_outbox" USING btree ("published_at","created_at");