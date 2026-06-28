import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import { z } from "zod";
import { canRead, canWrite, signSession, verifyPassword, verifySession, type SessionUser } from "./auth";
import { DrizzleRepository, type AppRepository, type GithubProfileInput } from "./repository";

type Variables = {
  user: SessionUser;
};

type CreateAppOptions = {
  repository?: AppRepository;
  jwtSecret?: string;
  corsOrigin?: string;
  fetchGithub?: typeof fetch;
  isProduction?: boolean;
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

  app.get("/health", (c) => c.json({ status: "ok", service: "github-profile-sam" }));

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
      secure: options.isProduction ?? process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 8
    });
    return c.json({ user: publicUser(sessionUser) });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, "admin_session", { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (c) => c.json({ user: publicUser(c.get("user")) }));

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
      return c.json({ profile: await repository.upsertGithubProfile(profile) });
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
