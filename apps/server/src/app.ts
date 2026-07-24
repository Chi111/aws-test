import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import { z } from "zod";
import { canRead, canWrite, signSession, verifyPassword, verifySession, type SessionUser } from "./auth";
import { createProfileUpdatedEvent } from "./profile-events";
import {
  cleanPerformanceEvents,
  parsePerformanceBatch,
  PERFORMANCE_BODY_LIMIT_BYTES,
  sanitizePerformanceEvent
} from "./performance-events";
import { DrizzleRepository, type AppRepository, type GithubProfileInput } from "./repository";

type Variables = {
  user: SessionUser;
};

type CreateAppOptions = {
  repository?: AppRepository;
  jwtSecret?: string;
  corsOrigin?: string;
  fetchGithub?: typeof fetch;
  fetchGoService?: typeof fetch;
  goServiceBaseUrl?: string;
  releaseVersion?: string;
  isProduction?: boolean;
  performanceIngestEnabled?: boolean;
  performanceHashSecret?: string;
  now?: () => Date;
};

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1)
});

const githubTokenSchema = z.object({
  token: z.string().min(1)
});

const fieldSchema = z.object({
  fieldKey: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/),
  fieldValue: z.string().trim().min(1).max(2000)
});

const githubUsernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/);

const goIntroductionSchema = z.object({
  profile: z.object({
    githubId: z.string(),
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    htmlUrl: z.url(),
    publicRepos: z.number().int().nonnegative(),
    followers: z.number().int().nonnegative(),
    following: z.number().int().nonnegative()
  }),
  introduction: z.string().min(1)
});

const performanceOverviewSchema = z
  .object({
    window: z.enum(["24h", "7d", "30d"]).default("24h"),
    appId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/)
      .optional(),
    route: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^\/[^\s?#]*$/)
      .optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional()
  })
  .strict()
  .refine((query) => Boolean(query.from) === Boolean(query.to), {
    message: "from and to must be supplied together"
  });

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    canWrite: canWrite(user.role)
  };
}

async function githubProfileFromToken(token: string, fetchGithub: typeof fetch): Promise<GithubProfileInput> {
  const response = await fetchGithub("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "github-profile-sam-mvp"
    }
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "GitHub token was rejected" : "GitHub profile request failed");
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.id !== "number" || typeof body.login !== "string" || typeof body.html_url !== "string") {
    throw new Error("GitHub profile response was missing required fields");
  }
  return {
    githubId: String(body.id),
    login: body.login,
    name: typeof body.name === "string" ? body.name : null,
    avatarUrl: typeof body.avatar_url === "string" ? body.avatar_url : null,
    htmlUrl: body.html_url,
    publicRepos: typeof body.public_repos === "number" ? body.public_repos : 0,
    followers: typeof body.followers === "number" ? body.followers : 0,
    following: typeof body.following === "number" ? body.following : 0,
    githubUpdatedAt: typeof body.updated_at === "string" ? body.updated_at : null
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const repository = options.repository ?? new DrizzleRepository();
  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET ?? "dev-only-change-me-jwt-secret-32-chars";
  const fetchGithub = options.fetchGithub ?? fetch;
  const fetchGoService = options.fetchGoService ?? fetch;
  const goServiceBaseUrl = options.goServiceBaseUrl ?? process.env.GO_SERVICE_BASE_URL ?? "";
  const releaseVersion = options.releaseVersion ?? process.env.RELEASE_VERSION ?? "local";
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const performanceIngestEnabled =
    options.performanceIngestEnabled ??
    (!isProduction || process.env.PERFORMANCE_INGEST_ENABLED === "true");
  const performanceHashSecret =
    options.performanceHashSecret ?? process.env.PERFORMANCE_HASH_SECRET ?? jwtSecret;
  const now = options.now ?? (() => new Date());
  const app = new Hono<{ Variables: Variables }>();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: options.corsOrigin ?? process.env.CORS_ORIGIN ?? "http://localhost:3001",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
      credentials: true
    })
  );

  const requireAuth = async (c: any, next: () => Promise<void>) => {
    const token = getCookie(c, "admin_session");
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(token, jwtSecret);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const user = await repository.findUserById(session.id);
    if (!user || !canRead(user.role)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", { id: user.id, email: user.email, name: user.name, role: user.role });
    return next();
  };

  const requireWrite = async (c: any, next: () => Promise<void>) => {
    const user = c.get("user") as SessionUser;
    if (!canWrite(user.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return next();
  };

  app.get("/health", (c) => c.json({ status: "ok", service: "github-profile-sam", version: releaseVersion }));

  app.get("/api/go/health", async (c) => {
    if (!goServiceBaseUrl) {
      return c.json({ error: "Go service discovery is not configured" }, 503);
    }
    try {
      const healthUrl = new URL("/healthz", `${goServiceBaseUrl.replace(/\/$/, "")}/`);
      const response = await fetchGoService(healthUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) {
        return c.json({ error: "Go service is unavailable" }, 503);
      }
      const health = (await response.json()) as { service?: unknown; status?: unknown };
      if (health.service !== "github-profile-go" || health.status !== "ok") {
        return c.json({ error: "Go service returned an invalid health response" }, 502);
      }
      return c.json({ discovery: "cloud-map", service: health.service, status: health.status });
    } catch {
      return c.json({ error: "Go service is unavailable" }, 503);
    }
  });

  app.get("/api/go/introductions/:username", async (c) => {
    if (!goServiceBaseUrl) {
      return c.json({ error: "Go service discovery is not configured" }, 503);
    }

    const username = githubUsernameSchema.safeParse(c.req.param("username"));
    if (!username.success) {
      return c.json({ error: "GitHub username is invalid" }, 400);
    }

    try {
      const introductionUrl = new URL(
        `/api/v1/introductions/${encodeURIComponent(username.data)}`,
        `${goServiceBaseUrl.replace(/\/$/, "")}/`
      );
      const response = await fetchGoService(introductionUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000)
      });
      const body = (await response.json().catch(() => null)) as unknown;

      if (response.status === 400 || response.status === 404) {
        const upstreamError = z
          .object({ error: z.object({ message: z.string().min(1) }) })
          .safeParse(body);
        const message = upstreamError.success ? upstreamError.data.error.message : "Profile could not be loaded";
        return response.status === 400 ? c.json({ error: message }, 400) : c.json({ error: message }, 404);
      }
      if (!response.ok) {
        return c.json({ error: "Go profile service is temporarily unavailable" }, 503);
      }

      const result = goIntroductionSchema.safeParse(body);
      if (!result.success) {
        return c.json({ error: "Go profile service returned an invalid response" }, 502);
      }
      return c.json(result.data);
    } catch {
      return c.json({ error: "Go profile service is temporarily unavailable" }, 503);
    }
  });

  app.post("/api/auth/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid login payload" }, 400);
    }
    const user = await repository.findUserByEmail(parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return c.json({ error: "Invalid email or password" }, 401);
    }
    const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = await signSession(sessionUser, jwtSecret);
    setCookie(c, "admin_session", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "None" : "Lax",
      path: "/",
      maxAge: 60 * 60 * 8
    });
    return c.json({ user: publicUser(sessionUser) });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, "admin_session", {
      path: "/",
      secure: isProduction,
      sameSite: isProduction ? "None" : "Lax"
    });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (c) => c.json({ user: publicUser(c.get("user")) }));

  app.post("/api/performance/events", async (c) => {
    if (!performanceIngestEnabled) {
      c.header("cache-control", "no-store");
      c.header("retry-after", "300");
      return c.json({ error: "Performance event collection is disabled" }, 503);
    }
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Content-Type must be application/json" }, 415);
    }
    const declaredLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > PERFORMANCE_BODY_LIMIT_BYTES) {
      return c.json({ error: "Performance event batch is too large" }, 413);
    }

    const body = await c.req.text();
    if (Buffer.byteLength(body, "utf8") > PERFORMANCE_BODY_LIMIT_BYTES) {
      return c.json({ error: "Performance event batch is too large" }, 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: "Performance event batch must be valid JSON" }, 400);
    }
    const parsed = parsePerformanceBatch(payload, now());
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid performance event batch",
          issues: parsed.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        },
        400
      );
    }

    const events = parsed.data.events.map(sanitizePerformanceEvent);
    try {
      const saved = isProduction
        ? await repository.enqueuePerformanceEvents(events)
        : await repository.savePerformanceEvents(cleanPerformanceEvents(events, performanceHashSecret));
      c.header("cache-control", "no-store");
      return c.json(
        {
          accepted: saved,
          duplicates: events.length - saved,
          mode: isProduction ? "queued" : "inline"
        },
        202
      );
    } catch (error) {
      console.error("Failed to persist performance events", {
        eventCount: events.length,
        error: error instanceof Error ? error.message : "unknown error"
      });
      return c.json({ error: "Performance event collection is temporarily unavailable" }, 503);
    }
  });

  app.get("/api/performance/overview", requireAuth, async (c) => {
    const parsed = performanceOverviewSchema.safeParse({
      window: c.req.query("window"),
      appId: c.req.query("appId"),
      route: c.req.query("route"),
      from: c.req.query("from"),
      to: c.req.query("to")
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid performance overview query" }, 400);
    }
    const currentTime = now();
    const durationMs =
      parsed.data.window === "24h"
        ? 24 * 60 * 60 * 1000
        : parsed.data.window === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    const from = parsed.data.from ?? new Date(currentTime.getTime() - durationMs).toISOString();
    const to = parsed.data.to ?? currentTime.toISOString();
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) - Date.parse(from) > 90 * 24 * 60 * 60 * 1000) {
      return c.json({ error: "Performance overview window must be positive and at most 90 days" }, 400);
    }
    c.header("cache-control", "private, max-age=30");
    return c.json(
      await repository.getPerformanceOverview({
        from,
        to,
        window: parsed.data.from ? "custom" : parsed.data.window,
        appId: parsed.data.appId,
        route: parsed.data.route
      })
    );
  });

  app.get("/api/profiles", requireAuth, async (c) => {
    return c.json({ profiles: await repository.listProfiles() });
  });

  app.post("/api/github/profile", requireAuth, requireWrite, async (c) => {
    const parsed = githubTokenSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "GitHub token is required" }, 400);
    }
    try {
      const profile = await githubProfileFromToken(parsed.data.token, fetchGithub);
      const savedProfile = await repository.upsertGithubProfile(profile, createProfileUpdatedEvent(profile));
      return c.json({ profile: savedProfile });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "GitHub profile request failed" }, 400);
    }
  });

  app.get("/api/profiles/:githubId/fields", requireAuth, async (c) => {
    return c.json({ fields: await repository.listFields(c.req.param("githubId")) });
  });

  app.post("/api/profiles/:githubId/fields", requireAuth, requireWrite, async (c) => {
    const parsed = fieldSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid field payload" }, 400);
    }
    const field = await repository.createField({ githubId: c.req.param("githubId"), ...parsed.data });
    return c.json({ field }, 201);
  });

  app.delete("/api/fields/:id", requireAuth, requireWrite, async (c) => {
    const deleted = await repository.deleteField(c.req.param("id"));
    return c.json({ deleted });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
