import { eq } from "drizzle-orm";
import { adminUsers, githubProfileFields, githubProfiles, type AdminUser, type GithubProfile, type GithubProfileField } from "@github-profile-sam/db/schema";
import type { Role } from "./auth";

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
  upsertGithubProfile(profile: GithubProfileInput): Promise<GithubProfile>;
  listFields(githubId: string): Promise<GithubProfileField[]>;
  createField(input: FieldInput): Promise<GithubProfileField>;
  deleteField(id: string): Promise<boolean>;
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

  async upsertGithubProfile(profile: GithubProfileInput) {
    const db = await this.getDb();
    const [saved] = await db
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
    return saved;
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
}
