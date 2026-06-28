import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createPasswordHash } from "./auth";
import type { AppRepository } from "./repository";

function jsonRequest(path: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

function cookieFrom(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function createRepo(): Promise<AppRepository> {
  const users = [
    {
      id: "user-admin",
      email: "admin@example.com",
      name: "Admin",
      role: "admin" as const,
      passwordHash: await createPasswordHash("Admin123!")
    },
    {
      id: "user-viewer",
      email: "viewer@example.com",
      name: "Viewer",
      role: "viewer" as const,
      passwordHash: await createPasswordHash("Viewer123!")
    }
  ];
  const profiles = new Map<string, any>();
  const fields = new Map<string, any[]>();

  return {
    findUserByEmail: async (email) => users.find((user) => user.email === email) ?? null,
    findUserById: async (id) => users.find((user) => user.id === id) ?? null,
    listProfiles: async () => [...profiles.values()],
    upsertGithubProfile: async (profile) => {
      const saved = { ...profile, fetchedAt: new Date("2026-01-01T00:00:00.000Z").toISOString() };
      profiles.set(profile.githubId, saved);
      return saved;
    },
    listFields: async (githubId) => fields.get(githubId) ?? [],
    createField: async (input) => {
      const row = {
        id: `field-${(fields.get(input.githubId)?.length ?? 0) + 1}`,
        githubId: input.githubId,
        fieldKey: input.fieldKey,
        fieldValue: input.fieldValue,
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
      };
      fields.set(input.githubId, [...(fields.get(input.githubId) ?? []), row]);
      return row;
    },
    deleteField: async (id) => {
      for (const [githubId, rows] of fields) {
        const next = rows.filter((row) => row.id !== id);
        if (next.length !== rows.length) {
          fields.set(githubId, next);
          return true;
        }
      }
      return false;
    }
  };
}

describe("admin MVP API", () => {
  it("logs in and returns the current admin session", async () => {
    const app = createApp({ repository: await createRepo() });

    const login = await app.fetch(jsonRequest("/api/auth/login", { email: "admin@example.com", password: "Admin123!" }));
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);

    const me = await app.fetch(new Request("http://localhost/api/auth/me", { headers: { cookie } }));
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ user: { email: "admin@example.com", role: "admin" } });
  });

  it("rejects viewer write access to custom profile fields", async () => {
    const app = createApp({ repository: await createRepo() });
    const login = await app.fetch(jsonRequest("/api/auth/login", { email: "viewer@example.com", password: "Viewer123!" }));
    const cookie = cookieFrom(login);

    const response = await app.fetch(jsonRequest("/api/profiles/123/fields", { fieldKey: "team", fieldValue: "platform" }, cookie));
    expect(response.status).toBe(403);
  });

  it("uses a GitHub token without storing it and saves the returned profile", async () => {
    const fetchGithub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/user");
      expect(init?.headers).toMatchObject({ authorization: "Bearer ghp_demo" });
      return new Response(
        JSON.stringify({
          id: 123,
          login: "octo",
          name: "Octo Cat",
          avatar_url: "https://avatars.githubusercontent.com/u/123",
          html_url: "https://github.com/octo",
          public_repos: 5,
          followers: 10,
          following: 2,
          updated_at: "2026-01-01T00:00:00Z"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const app = createApp({ repository: await createRepo(), fetchGithub });
    const login = await app.fetch(jsonRequest("/api/auth/login", { email: "admin@example.com", password: "Admin123!" }));
    const cookie = cookieFrom(login);

    const response = await app.fetch(jsonRequest("/api/github/profile", { token: "ghp_demo" }, cookie));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ profile: { githubId: "123", login: "octo" } });
  });
});
