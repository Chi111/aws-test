import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  adminUsers,
  githubProfileFields,
  githubProfiles,
  performanceEvents,
  profileEventOutbox,
  rawPerformanceEvents,
  type AdminUser,
  type GithubProfile,
  type GithubProfileField
} from "@github-profile-sam/db/schema";
import type { Role } from "./auth";
import type { ProfileUpdatedEvent } from "./profile-events";
import type {
  CleanPerformanceEvent,
  PerformanceEvent,
  PerformanceOverview,
  PerformanceOverviewQuery
} from "./performance-events";

export type AppUser = Pick<AdminUser, "id" | "email" | "name" | "passwordHash"> & { role: Role };

export type GithubProfileInput = {
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  following: number;
  githubUpdatedAt: string | null;
};

export type FieldInput = {
  githubId: string;
  fieldKey: string;
  fieldValue: string;
};

export type AppRepository = {
  findUserByEmail(email: string): Promise<AppUser | null>;
  findUserById(id: string): Promise<AppUser | null>;
  listProfiles(): Promise<GithubProfile[]>;
  upsertGithubProfile(profile: GithubProfileInput, event?: ProfileUpdatedEvent): Promise<GithubProfile>;
  listFields(githubId: string): Promise<GithubProfileField[]>;
  createField(input: FieldInput): Promise<GithubProfileField>;
  deleteField(id: string): Promise<boolean>;
  enqueuePerformanceEvents(events: PerformanceEvent[]): Promise<number>;
  savePerformanceEvents(events: CleanPerformanceEvent[]): Promise<number>;
  getPerformanceOverview(query: PerformanceOverviewQuery): Promise<PerformanceOverview>;
};

export class DrizzleRepository implements AppRepository {
  private async getDb() {
    const { db } = await import("@github-profile-sam/db");
    return db;
  }

  async findUserByEmail(email: string) {
    const db = await this.getDb();
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    return user ? { ...user, role: user.role as Role } : null;
  }

  async findUserById(id: string) {
    const db = await this.getDb();
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return user ? { ...user, role: user.role as Role } : null;
  }

  async listProfiles() {
    const db = await this.getDb();
    return db.select().from(githubProfiles);
  }

  async upsertGithubProfile(profile: GithubProfileInput, event?: ProfileUpdatedEvent) {
    const db = await this.getDb();
    return db.transaction(async (transaction) => {
      const [saved] = await transaction
        .insert(githubProfiles)
        .values(profile)
        .onConflictDoUpdate({
          target: githubProfiles.githubId,
          set: {
            login: profile.login,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            htmlUrl: profile.htmlUrl,
            publicRepos: profile.publicRepos,
            followers: profile.followers,
            following: profile.following,
            githubUpdatedAt: profile.githubUpdatedAt,
            fetchedAt: new Date().toISOString()
          }
        })
        .returning();
      if (!saved) {
        throw new Error("Failed to save GitHub profile");
      }

      if (event) {
        await transaction
          .insert(profileEventOutbox)
          .values({ eventId: event.eventId, eventType: event.eventType, payload: event })
          .onConflictDoNothing({ target: profileEventOutbox.eventId });
      }

      return saved;
    });
  }

  async listFields(githubId: string) {
    const db = await this.getDb();
    return db.select().from(githubProfileFields).where(eq(githubProfileFields.githubId, githubId));
  }

  async createField(input: FieldInput) {
    const db = await this.getDb();
    const [field] = await db
      .insert(githubProfileFields)
      .values(input)
      .onConflictDoUpdate({
        target: [githubProfileFields.githubId, githubProfileFields.fieldKey],
        set: { fieldValue: input.fieldValue }
      })
      .returning();
    if (!field) {
      throw new Error("Failed to save GitHub profile field");
    }
    return field;
  }

  async deleteField(id: string) {
    const db = await this.getDb();
    const deleted = await db.delete(githubProfileFields).where(eq(githubProfileFields.id, id)).returning({ id: githubProfileFields.id });
    return deleted.length > 0;
  }

  async enqueuePerformanceEvents(events: PerformanceEvent[]) {
    if (events.length === 0) {
      return 0;
    }
    const db = await this.getDb();
    const inserted = await db
      .insert(rawPerformanceEvents)
      .values(
        events.map((event) => ({
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event
        }))
      )
      .onConflictDoNothing({ target: rawPerformanceEvents.eventId })
      .returning({ eventId: rawPerformanceEvents.eventId });
    return inserted.length;
  }

  async savePerformanceEvents(events: CleanPerformanceEvent[]) {
    if (events.length === 0) {
      return 0;
    }
    const db = await this.getDb();
    const inserted = await db
      .insert(performanceEvents)
      .values(events)
      .onConflictDoNothing({ target: performanceEvents.eventId })
      .returning({ eventId: performanceEvents.eventId });
    return inserted.length;
  }

  async getPerformanceOverview(query: PerformanceOverviewQuery): Promise<PerformanceOverview> {
    const db = await this.getDb();
    const filters = [
      gte(performanceEvents.occurredAt, query.from),
      lte(performanceEvents.occurredAt, query.to),
      query.appId ? eq(performanceEvents.appId, query.appId) : undefined,
      query.route ? eq(performanceEvents.route, query.route) : undefined
    ].filter((condition): condition is Exclude<typeof condition, undefined> => condition !== undefined);
    const where = and(...filters);
    const durationFilter = sql`${performanceEvents.eventType} = 'navigation' and ${performanceEvents.unit} = 'ms'`;

    const [apps, summaryRows, trendRows, vitalRows, slowPageRows, errorRows] = await Promise.all([
      db
        .selectDistinct({ appId: performanceEvents.appId })
        .from(performanceEvents)
        .orderBy(asc(performanceEvents.appId)),
      db
        .select({
          events: count(),
          pageViews: sql<number>`count(*) filter (where ${performanceEvents.eventType} = 'page-view')`,
          errors: sql<number>`count(*) filter (where ${performanceEvents.eventType} = 'error')`,
          errorSessions: sql<number>`count(distinct ${performanceEvents.sessionHash}) filter (where ${performanceEvents.eventType} = 'error')`,
          avgDuration: sql<number>`coalesce(avg(${performanceEvents.value}) filter (where ${durationFilter}), 0)`,
          p75: sql<number>`coalesce(percentile_cont(0.75) within group (order by ${performanceEvents.value}) filter (where ${durationFilter}), 0)`,
          p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${performanceEvents.value}) filter (where ${durationFilter}), 0)`,
          uniqueSessions: sql<number>`count(distinct ${performanceEvents.sessionHash})`
        })
        .from(performanceEvents)
        .where(where),
      db
        .select({
          bucket: sql<string>`date_trunc(${query.window === "24h" ? "hour" : "day"}, ${performanceEvents.occurredAt})`,
          pageViews: sql<number>`count(*) filter (where ${performanceEvents.eventType} = 'page-view')`,
          errors: sql<number>`count(*) filter (where ${performanceEvents.eventType} = 'error')`,
          avgDuration: sql<number>`coalesce(avg(${performanceEvents.value}) filter (where ${durationFilter}), 0)`,
          p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${performanceEvents.value}) filter (where ${durationFilter}), 0)`
        })
        .from(performanceEvents)
        .where(where)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          name: performanceEvents.name,
          value: sql<number>`coalesce(percentile_cont(0.75) within group (order by ${performanceEvents.value}), 0)`,
          rating: sql<string | null>`mode() within group (order by ${performanceEvents.rating})`,
          samples: count()
        })
        .from(performanceEvents)
        .where(and(where, eq(performanceEvents.eventType, "web-vital")))
        .groupBy(performanceEvents.name)
        .orderBy(asc(performanceEvents.name)),
      db
        .select({
          route: performanceEvents.route,
          avgDuration: sql<number>`avg(${performanceEvents.value})`,
          p95: sql<number>`percentile_cont(0.95) within group (order by ${performanceEvents.value})`,
          count: count()
        })
        .from(performanceEvents)
        .where(and(where, eq(performanceEvents.eventType, "navigation")))
        .groupBy(performanceEvents.route)
        .orderBy(desc(sql`avg(${performanceEvents.value})`))
        .limit(10),
      db
        .select({
          message: performanceEvents.message,
          count: count(),
          lastSeen: sql<string>`max(${performanceEvents.occurredAt})`
        })
        .from(performanceEvents)
        .where(and(where, eq(performanceEvents.eventType, "error")))
        .groupBy(performanceEvents.message)
        .orderBy(desc(count()))
        .limit(10)
    ]);

    const summary = summaryRows[0];
    const pageViews = numeric(summary?.pageViews);
    const errors = numeric(summary?.errors);
    const uniqueSessions = numeric(summary?.uniqueSessions);
    return {
      apps: apps.map(({ appId }) => appId),
      summary: {
        events: numeric(summary?.events),
        pageViews,
        errors,
        errorRate: uniqueSessions > 0 ? round(numeric(summary?.errorSessions) / uniqueSessions) : 0,
        avgDuration: round(numeric(summary?.avgDuration)),
        p75: round(numeric(summary?.p75)),
        p95: round(numeric(summary?.p95)),
        uniqueSessions
      },
      trends: trendRows.map((row) => {
        const bucket = new Date(row.bucket).toISOString();
        return {
          bucket,
          label: query.window === "24h" ? bucket.slice(11, 16) : bucket.slice(5, 10),
          pageViews: numeric(row.pageViews),
          errors: numeric(row.errors),
          avgDuration: round(numeric(row.avgDuration)),
          p95: round(numeric(row.p95))
        };
      }),
      vitals: vitalRows.map((row) => ({
        name: row.name,
        value: round(numeric(row.value)),
        rating:
          row.rating === "good" || row.rating === "needs-improvement" || row.rating === "poor" ? row.rating : undefined,
        samples: numeric(row.samples)
      })),
      slowPages: slowPageRows.map((row) => ({
        route: row.route,
        avgDuration: round(numeric(row.avgDuration)),
        p95: round(numeric(row.p95)),
        count: numeric(row.count)
      })),
      topErrors: errorRows
        .filter((row): row is typeof row & { message: string } => typeof row.message === "string")
        .map((row) => ({
          message: row.message,
          count: numeric(row.count),
          lastSeen: new Date(row.lastSeen).toISOString()
        })),
      generatedAt: new Date().toISOString(),
      window: query
    };
  }
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
