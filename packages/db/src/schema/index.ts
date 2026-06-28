import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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

export type AdminUser = typeof adminUsers.$inferSelect;
export type GithubProfile = typeof githubProfiles.$inferSelect;
export type GithubProfileField = typeof githubProfileFields.$inferSelect;
