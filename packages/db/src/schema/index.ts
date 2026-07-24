import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const adminRole = pgEnum("admin_role", ["admin", "operator", "viewer"]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  role: adminRole("role").notNull().default("viewer"),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
});

export const githubProfiles = pgTable("github_profiles", {
  githubId: varchar("github_id", { length: 64 }).primaryKey(),
  login: varchar("login", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  htmlUrl: text("html_url").notNull(),
  publicRepos: integer("public_repos").notNull().default(0),
  followers: integer("followers").notNull().default(0),
  following: integer("following").notNull().default(0),
  githubUpdatedAt: timestamp("github_updated_at", { withTimezone: true, mode: "string" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
});

export const githubProfileFields = pgTable(
  "github_profile_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: varchar("github_id", { length: 64 })
      .notNull()
      .references(() => githubProfiles.githubId, { onDelete: "cascade" }),
    fieldKey: varchar("field_key", { length: 80 }).notNull(),
    fieldValue: text("field_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("github_profile_fields_profile_key_unique").on(table.githubId, table.fieldKey)]
);

export const profileEventOutbox = pgTable(
  "profile_event_outbox",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    processingAt: timestamp("processing_at", { withTimezone: true, mode: "string" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
  },
  (table) => [index("profile_event_outbox_pending_idx").on(table.publishedAt, table.createdAt)]
);

export const rawPerformanceEvents = pgTable(
  "performance_events_raw",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    processingAt: timestamp("processing_at", { withTimezone: true, mode: "string" }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectionReason: varchar("rejection_reason", { length: 500 }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
  },
  (table) => [index("performance_events_raw_pending_idx").on(table.processedAt, table.rejectedAt, table.receivedAt)]
);

export const performanceEvents = pgTable(
  "performance_events",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    appId: varchar("app_id", { length: 80 }).notNull(),
    sessionHash: varchar("session_hash", { length: 64 }).notNull(),
    route: varchar("route", { length: 512 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    value: doublePrecision("value").notNull(),
    unit: varchar("unit", { length: 16 }).notNull(),
    rating: varchar("rating", { length: 32 }),
    appVersion: varchar("app_version", { length: 80 }),
    sdkVersion: varchar("sdk_version", { length: 80 }).notNull(),
    initiatorType: varchar("initiator_type", { length: 80 }),
    navigationType: varchar("navigation_type", { length: 32 }),
    statusCode: integer("status_code"),
    message: varchar("message", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow()
  },
  (table) => [
    index("performance_events_occurred_at_idx").on(table.occurredAt),
    index("performance_events_app_occurred_at_idx").on(table.appId, table.occurredAt),
    index("performance_events_route_occurred_at_idx").on(table.route, table.occurredAt),
    index("performance_events_name_occurred_at_idx").on(table.name, table.occurredAt)
  ]
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type GithubProfile = typeof githubProfiles.$inferSelect;
export type GithubProfileField = typeof githubProfileFields.$inferSelect;
export type ProfileEventOutbox = typeof profileEventOutbox.$inferSelect;
export type RawPerformanceEvent = typeof rawPerformanceEvents.$inferSelect;
export type PerformanceEvent = typeof performanceEvents.$inferSelect;
