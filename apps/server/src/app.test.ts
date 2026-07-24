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
  const rawPerformanceEvents = new Set<string>();
  const cleanPerformanceEvents = new Set<string>();

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
    },
    enqueuePerformanceEvents: async (events) => {
      let inserted = 0;
      for (const event of events) {
        if (!rawPerformanceEvents.has(event.eventId)) {
          rawPerformanceEvents.add(event.eventId);
          inserted += 1;
        }
      }
      return inserted;
    },
    savePerformanceEvents: async (events) => {
      let inserted = 0;
      for (const event of events) {
        if (!cleanPerformanceEvents.has(event.eventId)) {
          cleanPerformanceEvents.add(event.eventId);
          inserted += 1;
        }
      }
      return inserted;
    },
    getPerformanceOverview: async (query) => ({
      apps: ["github-profile"],
      summary: {
        events: 10,
        pageViews: 4,
        errors: 1,
        errorRate: 0.25,
        avgDuration: 125,
        p75: 150,
        p95: 250,
        uniqueSessions: 3
      },
      trends: [],
      vitals: [],
      slowPages: [],
      topErrors: [],
      generatedAt: "2026-07-24T00:00:00.000Z",
      window: query
    })
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

  it("atomically queues a sanitized profile.updated outbox event while saving a profile", async () => {
    const repository = await createRepo();
    const upsertGithubProfile = vi.spyOn(repository, "upsertGithubProfile");
    const app = createApp({
      repository,
      fetchGithub: vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 456,
            login: "event-user",
            name: "Event User",
            avatar_url: "https://avatars.githubusercontent.com/u/456",
            html_url: "https://github.com/event-user",
            public_repos: 4,
            followers: 5,
            following: 6,
            updated_at: "2026-07-21T01:02:03Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });
    const login = await app.fetch(jsonRequest("/api/auth/login", { email: "admin@example.com", password: "Admin123!" }));

    const response = await app.fetch(
      jsonRequest("/api/github/profile", { token: "ghp_never_publish_this" }, cookieFrom(login))
    );

    expect(response.status).toBe(200);
    expect(upsertGithubProfile).toHaveBeenCalledOnce();
    expect(upsertGithubProfile).toHaveBeenCalledWith(
      expect.objectContaining({ githubId: "456", login: "event-user" }),
      expect.objectContaining({
        specVersion: "1.0",
        eventType: "profile.updated",
        idempotencyKey: "456:2026-07-21T01:02:03Z",
        profile: expect.objectContaining({ githubId: "456", login: "event-user" })
      })
    );
    expect(JSON.stringify(upsertGithubProfile.mock.calls[0]?.[1])).not.toContain("ghp_never_publish_this");
  });

  it("exposes the release version in the public health response", async () => {
    const app = createApp({ repository: await createRepo(), releaseVersion: "release-abc123" });

    const response = await app.fetch(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "github-profile-sam",
      version: "release-abc123"
    });
  });

  it("accepts a public performance batch and cleans it inline outside production", async () => {
    const repository = await createRepo();
    const savePerformanceEvents = vi.spyOn(repository, "savePerformanceEvents");
    const app = createApp({
      repository,
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      performanceHashSecret: "test-performance-secret"
    });

    const response = await app.fetch(
      jsonRequest("/api/performance/events", {
        events: [
          {
            eventId: "0c2f1f40-6dd3-4d3e-9aa6-a55f0f1c0ed3",
            eventType: "navigation",
            occurredAt: "2026-07-23T23:59:00.000Z",
            appId: "github-profile",
            sessionId: "opaque_session_123456",
            route: "/profiles/123",
            name: "navigation.duration",
            value: 321.5,
            unit: "ms",
            sdkVersion: "1.0.0"
          }
        ]
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0, mode: "inline" });
    expect(savePerformanceEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        appId: "github-profile",
        route: "/profiles/:id",
        sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ]);
    expect(JSON.stringify(savePerformanceEvents.mock.calls)).not.toContain("opaque_session_123456");
  });

  it("queues sanitized raw performance events in production", async () => {
    const repository = await createRepo();
    const enqueuePerformanceEvents = vi.spyOn(repository, "enqueuePerformanceEvents");
    const app = createApp({
      repository,
      isProduction: true,
      performanceIngestEnabled: true,
      now: () => new Date("2026-07-24T00:00:00.000Z")
    });

    const response = await app.fetch(
      jsonRequest("/api/performance/events", {
        events: [
          {
            eventId: "44b099ab-bc54-4bff-9afe-6a5c5118bf4d",
            eventType: "error",
            occurredAt: "2026-07-23T23:59:00.000Z",
            appId: "github-profile",
            sessionId: "opaque_session_123456",
            route: "/",
            name: "javascript.error",
            value: 1,
            unit: "count",
            sdkVersion: "1.0.0",
            message: "Failed for sam@example.com at https://example.com/path?token=secret"
          }
        ]
      })
    );

    expect(response.status).toBe(202);
    expect(enqueuePerformanceEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        message: "Failed for [redacted-email] at [redacted-url]"
      })
    ]);
  });

  it("disables production ingestion when the cleaning worker is not enabled", async () => {
    const repository = await createRepo();
    const enqueuePerformanceEvents = vi.spyOn(repository, "enqueuePerformanceEvents");
    const app = createApp({
      repository,
      isProduction: true,
      performanceIngestEnabled: false
    });

    const response = await app.fetch(jsonRequest("/api/performance/events", { events: [] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(enqueuePerformanceEvents).not.toHaveBeenCalled();
  });

  it("rejects oversized, stale, and privacy-unsafe performance payloads", async () => {
    const app = createApp({
      repository: await createRepo(),
      now: () => new Date("2026-07-24T00:00:00.000Z")
    });
    const stale = await app.fetch(
      jsonRequest("/api/performance/events", {
        events: [
          {
            eventId: "68efe092-764d-48fe-80ca-16eb66342881",
            eventType: "page-view",
            occurredAt: "2026-01-01T00:00:00.000Z",
            appId: "github-profile",
            sessionId: "opaque_session_123456",
            route: "/?email=sam@example.com",
            name: "page.view",
            value: 1,
            unit: "count",
            sdkVersion: "1.0.0"
          }
        ]
      })
    );
    expect(stale.status).toBe(400);

    const oversized = await app.fetch(
      new Request("http://localhost/api/performance/events", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(129 * 1024) },
        body: "{}"
      })
    );
    expect(oversized.status).toBe(413);
  });

  it("requires authentication for performance overview and supports window filters", async () => {
    const repository = await createRepo();
    const getPerformanceOverview = vi.spyOn(repository, "getPerformanceOverview");
    const app = createApp({
      repository,
      now: () => new Date("2026-07-24T00:00:00.000Z")
    });

    const unauthorized = await app.fetch(new Request("http://localhost/api/performance/overview?window=7d"));
    expect(unauthorized.status).toBe(401);

    const login = await app.fetch(jsonRequest("/api/auth/login", { email: "viewer@example.com", password: "Viewer123!" }));
    const response = await app.fetch(
      new Request("http://localhost/api/performance/overview?window=7d&appId=github-profile&route=%2F", {
        headers: { cookie: cookieFrom(login) }
      })
    );
    expect(response.status).toBe(200);
    expect(getPerformanceOverview).toHaveBeenCalledWith({
      from: "2026-07-17T00:00:00.000Z",
      to: "2026-07-24T00:00:00.000Z",
      window: "7d",
      appId: "github-profile",
      route: "/"
    });
  });

  it("calls the Go health endpoint through its configured Cloud Map DNS name", async () => {
    const fetchGoService = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://go.internal.github-profile:8080/healthz");
      return new Response(JSON.stringify({ service: "github-profile-go", status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      discovery: "cloud-map",
      service: "github-profile-go",
      status: "ok"
    });
    expect(fetchGoService).toHaveBeenCalledOnce();
  });

  it("does not attempt service discovery when the Go endpoint is not configured", async () => {
    const fetchGoService = vi.fn();
    const app = createApp({ repository: await createRepo(), fetchGoService, goServiceBaseUrl: "" });

    const response = await app.fetch(new Request("http://localhost/api/go/health"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Go service discovery is not configured" });
    expect(fetchGoService).not.toHaveBeenCalled();
  });

  it("returns a sanitized error when the Go service cannot be reached", async () => {
    const fetchGoService = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND go.internal.github-profile");
    });
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/health"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Go service is unavailable" });
  });

  it("rejects an unexpected Go health response", async () => {
    const fetchGoService = vi.fn(async () =>
      new Response(JSON.stringify({ service: "unexpected-service", status: "ok" }), { status: 200 })
    );
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/health"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Go service returned an invalid health response" });
  });

  it("returns a generated introduction through the Go service", async () => {
    const fetchGoService = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://go.internal.github-profile:8080/api/v1/introductions/Chi111");
      return new Response(
        JSON.stringify({
          profile: {
            githubId: "123",
            login: "chi111",
            name: "Chi",
            avatarUrl: "https://avatars.githubusercontent.com/u/123",
            htmlUrl: "https://github.com/Chi111",
            publicRepos: 8,
            followers: 12,
            following: 3
          },
          introduction: "你好，我是 Chi（GitHub: @chi111）。"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/introductions/Chi111"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { login: "chi111", publicRepos: 8 },
      introduction: "你好，我是 Chi（GitHub: @chi111）。"
    });
    expect(fetchGoService).toHaveBeenCalledOnce();
  });

  it("rejects an invalid username without calling the Go service", async () => {
    const fetchGoService = vi.fn();
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/introductions/-invalid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "GitHub username is invalid" });
    expect(fetchGoService).not.toHaveBeenCalled();
  });

  it("preserves a sanitized profile-not-found response from Go", async () => {
    const fetchGoService = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: "profile_not_found", message: "GitHub profile was not found" } }),
        { status: 404, headers: { "content-type": "application/json" } }
      )
    );
    const app = createApp({
      repository: await createRepo(),
      fetchGoService,
      goServiceBaseUrl: "http://go.internal.github-profile:8080"
    });

    const response = await app.fetch(new Request("http://localhost/api/go/introductions/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "GitHub profile was not found" });
  });
});
