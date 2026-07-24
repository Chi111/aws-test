import { createFileRoute } from "@tanstack/react-router";
import { Activity, ExternalLink, Gauge, GitBranch, KeyRound, Lock, LogOut, Plus, RefreshCw, Search, Shield, Sparkles, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { env } from "@github-profile-sam/env/web";

export const Route = createFileRoute("/")({
  component: AdminApp,
});

type Role = "admin" | "operator" | "viewer";
type User = { id: string; email: string; name: string; role: Role; canWrite: boolean };
type Profile = {
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  following: number;
};
type Field = { id: string; githubId: string; fieldKey: string; fieldValue: string; createdAt: string };
type IntroductionResult = {
  profile: Profile;
  introduction: string;
  backendProof?: { runtime: string; service: string; dataSource: string };
  preview?: { prNumber: number; runtime: string; service: string; routing: string };
};
type View = "dashboard" | "performance" | "introduction" | "profiles" | "fields" | "access";
type PerformanceWindow = "24h" | "7d" | "30d";
type PerformanceApplication = { id: string; name: string };
type TrendPoint = {
  timestamp: string;
  pageViews: number;
  p95: number;
  errorRate: number;
};
type VitalMetric = {
  name: string;
  value: number;
  unit: string;
  rating?: "good" | "needs-improvement" | "poor";
};
type ErrorRank = { message: string; count: number; lastSeen?: string };
type SlowPageRank = { path: string; p95: number; samples: number };
type PerformanceOverview = {
  applications: PerformanceApplication[];
  summary: {
    pageViews: number;
    sessions: number;
    errorRate: number;
    p95: number;
  };
  trend: TrendPoint[];
  vitals: VitalMetric[];
  errors: ErrorRank[];
  slowPages: SlowPageRank[];
  updatedAt?: string;
};

const apiBase = env.VITE_SERVER_URL.replace(/\/+$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("API route is not available in this preview");
  }

  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedGithubId, setSelectedGithubId] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.githubId === selectedGithubId) ?? profiles[0],
    [profiles, selectedGithubId]
  );

  async function loadSession() {
    setLoading(true);
    try {
      const result = await api<{ user: User }>("/api/auth/me");
      setUser(result.user);
      await loadProfiles();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfiles() {
    const result = await api<{ profiles: Profile[] }>("/api/profiles");
    setProfiles(result.profiles);
    if (result.profiles.length > 0) {
      setSelectedGithubId((current) => current || result.profiles[0].githubId);
    }
  }

  async function loadFields(githubId: string) {
    const result = await api<{ fields: Field[] }>(`/api/profiles/${githubId}/fields`);
    setFields(result.fields);
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      void loadFields(selectedProfile.githubId);
    }
  }, [selectedProfile?.githubId]);

  if (loading) {
    return <div className="center-screen">Loading admin session...</div>;
  }

  if (!user) {
    return <LoginView onLogin={(nextUser) => setUser(nextUser)} />;
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">
          <Shield aria-hidden="true" />
          <div>
            <strong>Profile Admin</strong>
            <span>dev MVP</span>
          </div>
        </div>
        <nav>
          <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")} icon={<Activity />}>
            Dashboard
          </NavButton>
          <NavButton active={view === "performance"} onClick={() => setView("performance")} icon={<Gauge />}>
            Performance
          </NavButton>
          <NavButton active={view === "introduction"} onClick={() => setView("introduction")} icon={<Sparkles />}>
            Go Introduction
          </NavButton>
          <NavButton active={view === "profiles"} onClick={() => setView("profiles")} icon={<GitBranch />}>
            GitHub Profiles
          </NavButton>
          <NavButton active={view === "fields"} onClick={() => setView("fields")} icon={<Plus />}>
            Fields
          </NavButton>
          {user.role === "admin" ? (
            <NavButton active={view === "access"} onClick={() => setView("access")} icon={<Lock />}>
              Access
            </NavButton>
          ) : null}
        </nav>
        <button
          className="logout-button"
          type="button"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST", body: "{}" });
            setUser(null);
          }}
        >
          <LogOut aria-hidden="true" />
          Logout
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">signed in</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="user-pill">
            <UserRound aria-hidden="true" />
            <span>{user.name}</span>
            <strong>{user.role}</strong>
          </div>
        </header>
        {error ? <p className="banner error">{error}</p> : null}
        {status ? <p className="banner success">{status}</p> : null}
        {view === "dashboard" ? <Dashboard user={user} profiles={profiles} /> : null}
        {view === "performance" ? <PerformanceDashboard /> : null}
        {view === "introduction" ? <IntroductionLookup /> : null}
        {view === "profiles" ? (
          <ProfilesView
            canWrite={user.canWrite}
            profiles={profiles}
            onError={setError}
            onStatus={setStatus}
            onLoaded={async () => {
              await loadProfiles();
              setView("profiles");
            }}
          />
        ) : null}
        {view === "fields" ? (
          <FieldsView
            canWrite={user.canWrite}
            profiles={profiles}
            selectedProfile={selectedProfile}
            selectedGithubId={selectedGithubId}
            setSelectedGithubId={setSelectedGithubId}
            fields={fields}
            reloadFields={loadFields}
            onError={setError}
            onStatus={setStatus}
          />
        ) : null}
        {view === "access" ? <AccessView /> : null}
      </main>
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="login-screen">
      <div className="entry-grid">
        <IntroductionLookup />
        <form className="login-panel" onSubmit={submit}>
          <div className="brand">
            <Shield aria-hidden="true" />
            <div>
              <strong>GitHub Profile Admin</strong>
              <span>better-t-stack MVP</span>
            </div>
          </div>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <button className="primary-button" type="submit">
            <KeyRound aria-hidden="true" />
            Login
          </button>
          {error ? <p className="banner error" role="alert">{error}</p> : null}
          <p className="hint">Try admin@example.com, operator@example.com, or viewer@example.com.</p>
        </form>
      </div>
    </main>
  );
}

function IntroductionLookup() {
  const [username, setUsername] = useState("Chi111");
  const [result, setResult] = useState<IntroductionResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    setError("");
    setResult(null);

    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(normalizedUsername)) {
      setError("Enter a valid GitHub username (1–39 characters).");
      return;
    }

    setLoading(true);
    try {
      const nextResult = await api<IntroductionResult>(
        `/api/go/introductions/${encodeURIComponent(normalizedUsername)}`
      );
      setResult(nextResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Introduction could not be generated");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="introduction-panel" aria-labelledby="go-introduction-title">
      <div className="introduction-heading">
        <span className="eyebrow">Go · ECS Fargate · Cloud Map</span>
        <h1 id="go-introduction-title">Generate a personal introduction</h1>
        <p>Enter a profile already saved in PostgreSQL. The request reaches the private Go service through Lambda service discovery.</p>
      </div>

      <form className="introduction-form" onSubmit={submit}>
        <label htmlFor="github-username">GitHub username</label>
        <div className="introduction-controls">
          <input
            id="github-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Chi111"
            autoComplete="off"
            maxLength={39}
            aria-describedby="introduction-help"
          />
          <button className="primary-button" type="submit" disabled={loading || !username.trim()}>
            <Search aria-hidden="true" />
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
        <span className="hint" id="introduction-help">The GitHub token stays in the Node service and is never sent to Go.</span>
      </form>

      {error ? <p className="banner error" role="alert">{error}</p> : null}
      {result ? (
        <article className="introduction-result" aria-live="polite">
          <div className="introduction-profile">
            {result.profile.avatarUrl ? (
              <img src={result.profile.avatarUrl} alt={`${result.profile.login} avatar`} />
            ) : (
              <div className="avatar-placeholder" aria-hidden="true" />
            )}
            <div>
              <span className="eyebrow">generated by Go</span>
              <h2>{result.profile.name ?? result.profile.login}</h2>
              <a href={result.profile.htmlUrl} target="_blank" rel="noreferrer">
                @{result.profile.login}
                <ExternalLink aria-hidden="true" />
              </a>
            </div>
          </div>
          <p className="introduction-copy">{result.introduction}</p>
          {result.preview ? (
            <p className="preview-proof">
              PR #{result.preview.prNumber} · {result.backendProof?.service ?? result.preview.service} ·{" "}
              {result.backendProof?.runtime ?? result.preview.runtime} · {result.backendProof?.dataSource ?? "unknown data source"} ·{" "}
              {result.preview.routing}
            </p>
          ) : null}
          <dl className="introduction-metrics">
            <div><dt>Repositories</dt><dd>{result.profile.publicRepos}</dd></div>
            <div><dt>Followers</dt><dd>{result.profile.followers}</dd></div>
            <div><dt>Following</dt><dd>{result.profile.following}</dd></div>
          </dl>
        </article>
      ) : null}
    </section>
  );
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} type="button" onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Dashboard({ user, profiles }: { user: User; profiles: Profile[] }) {
  return (
    <section className="content-grid">
      <Metric label="Role" value={user.role} />
      <Metric label="Write access" value={user.canWrite ? "enabled" : "read only"} />
      <Metric label="Saved profiles" value={profiles.length} />
    </section>
  );
}

function PerformanceDashboard() {
  const [window, setWindow] = useState<PerformanceWindow>("24h");
  const [appId, setAppId] = useState("");
  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadOverview() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ window });
        if (appId) params.set("appId", appId);
        const result = await api<unknown>(`/api/performance/overview?${params.toString()}`, {
          signal: controller.signal
        });
        setOverview(normalizePerformanceOverview(result));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Performance data could not be loaded");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadOverview();
    return () => controller.abort();
  }, [window, appId, refreshKey]);

  const hasData = overview
    ? overview.summary.pageViews > 0 ||
      overview.summary.sessions > 0 ||
      overview.trend.length > 0 ||
      overview.vitals.length > 0 ||
      overview.errors.length > 0 ||
      overview.slowPages.length > 0
    : false;

  return (
    <section className="performance-dashboard" aria-labelledby="performance-title">
      <div className="performance-toolbar">
        <div>
          <p className="eyebrow">real user monitoring</p>
          <h2 id="performance-title">Application health</h2>
          <p>Latency, Core Web Vitals, and client-side errors from cleaned telemetry.</p>
        </div>
        <div className="performance-filters">
          <label>
            Time range
            <select value={window} onChange={(event) => setWindow(event.target.value as PerformanceWindow)}>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </label>
          <label>
            Application
            <select value={appId} onChange={(event) => setAppId(event.target.value)}>
              <option value="">All applications</option>
              {overview?.applications.map((application) => (
                <option key={application.id} value={application.id}>{application.name}</option>
              ))}
            </select>
          </label>
          <button
            className="refresh-button"
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading}
            aria-label="Refresh performance data"
          >
            <RefreshCw aria-hidden="true" className={loading ? "spinning" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {loading && !overview ? <PerformanceSkeleton /> : null}
      {error ? (
        <div className="performance-state error-state" role="alert">
          <strong>Unable to load performance data</strong>
          <span>{error}</span>
          <button className="primary-button" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {!loading && !error && overview && !hasData ? (
        <div className="performance-state">
          <Gauge aria-hidden="true" />
          <strong>No telemetry in this time range</strong>
          <span>Once the SDK sends events, performance results will appear here.</span>
        </div>
      ) : null}
      {overview && hasData ? (
        <div className={loading ? "performance-content is-refreshing" : "performance-content"} aria-busy={loading}>
          <div className="performance-summary">
            <PerformanceMetric label="Page views" value={formatNumber(overview.summary.pageViews)} detail="clean events" />
            <PerformanceMetric label="Sessions" value={formatNumber(overview.summary.sessions)} detail="unique sessions" />
            <PerformanceMetric
              label="Error rate"
              value={formatPercent(overview.summary.errorRate)}
              detail={overview.summary.errorRate <= 0.01 ? "within target" : "needs attention"}
              tone={overview.summary.errorRate <= 0.01 ? "good" : "poor"}
            />
            <PerformanceMetric
              label="P95 latency"
              value={formatDuration(overview.summary.p95)}
              detail="page load"
              tone={overview.summary.p95 <= 2500 ? "good" : "poor"}
            />
          </div>

          <div className="performance-main-grid">
            <article className="performance-panel trend-panel">
              <PanelHeading title="Performance trend" detail="Page-load latency" />
              <PerformanceTrend data={overview.trend} />
            </article>
            <article className="performance-panel">
              <PanelHeading title="Core Web Vitals" detail="75th percentile" />
              <VitalsList vitals={overview.vitals} />
            </article>
          </div>

          <div className="performance-rank-grid">
            <article className="performance-panel">
              <PanelHeading title="Top errors" detail="Most frequent exceptions" />
              <ErrorsTable errors={overview.errors} />
            </article>
            <article className="performance-panel">
              <PanelHeading title="Slow pages" detail="Ranked by P95 latency" />
              <SlowPagesTable pages={overview.slowPages} />
            </article>
          </div>
          {overview.updatedAt ? (
            <p className="data-freshness">Last updated {formatTimestamp(overview.updatedAt)}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="performance-skeleton" role="status" aria-label="Loading performance data">
      <div className="performance-summary">
        {[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item} />)}
      </div>
      <div className="skeleton-panel" />
    </div>
  );
}

function PerformanceMetric({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "poor";
}) {
  return (
    <article className={`performance-metric${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-heading">
      <h3>{title}</h3>
      <span>{detail}</span>
    </div>
  );
}

function PerformanceTrend({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <InlineEmpty message="No trend samples available." />;

  const chartWidth = 720;
  const chartHeight = 220;
  const plotTop = 16;
  const plotBottom = 184;
  const values = data.map((point) => point.p95);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const coordinates = data.map((point, index) => {
    const x = data.length === 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth;
    const y = plotBottom - ((point.p95 - min) / range) * (plotBottom - plotTop);
    return { x, y, point };
  });
  const line = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = `0,${plotBottom} ${line} ${chartWidth},${plotBottom}`;
  const labelIndexes = Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-labelledby="trend-chart-title trend-chart-desc">
        <title id="trend-chart-title">Page-load latency over time</title>
        <desc id="trend-chart-desc">
          Values range from {formatDuration(min)} to {formatDuration(max)} across {data.length} samples.
        </desc>
        {[0, 1, 2, 3].map((lineIndex) => {
          const y = plotTop + ((plotBottom - plotTop) / 3) * lineIndex;
          return <line className="chart-grid-line" key={lineIndex} x1="0" x2={chartWidth} y1={y} y2={y} />;
        })}
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />
        {coordinates.map(({ x, y, point }, index) => (
          <circle key={`${point.timestamp}-${index}`} className="chart-point" cx={x} cy={y} r="4">
            <title>{`${formatTimestamp(point.timestamp)}: ${formatDuration(point.p95)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis" aria-hidden="true">
        {labelIndexes.map((index) => <span key={index}>{formatChartTime(data[index].timestamp)}</span>)}
      </div>
    </div>
  );
}

function VitalsList({ vitals }: { vitals: VitalMetric[] }) {
  if (vitals.length === 0) return <InlineEmpty message="No Web Vitals samples available." />;
  return (
    <dl className="vitals-list">
      {vitals.map((vital) => {
        const rating = vital.rating ?? rateVital(vital.name, vital.value);
        return (
          <div key={vital.name}>
            <dt>
              <span>{vital.name.toUpperCase()}</span>
              <small>{vitalDescription(vital.name)}</small>
            </dt>
            <dd>
              <strong>{formatVital(vital)}</strong>
              <span className={`rating ${rating}`}>{rating.replace("-", " ")}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ErrorsTable({ errors }: { errors: ErrorRank[] }) {
  if (errors.length === 0) return <InlineEmpty message="No client errors recorded." />;
  return (
    <div className="table-scroll">
      <table className="performance-table">
        <thead><tr><th scope="col">Error</th><th scope="col">Count</th><th scope="col">Last seen</th></tr></thead>
        <tbody>
          {errors.slice(0, 8).map((error, index) => (
            <tr key={`${error.message}-${index}`}>
              <td><span className="error-message">{error.message}</span></td>
              <td>{formatNumber(error.count)}</td>
              <td>{error.lastSeen ? formatTimestamp(error.lastSeen) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlowPagesTable({ pages }: { pages: SlowPageRank[] }) {
  if (pages.length === 0) return <InlineEmpty message="No page latency samples available." />;
  return (
    <div className="table-scroll">
      <table className="performance-table">
        <thead><tr><th scope="col">Page</th><th scope="col">P95</th><th scope="col">Samples</th></tr></thead>
        <tbody>
          {pages.slice(0, 8).map((page, index) => (
            <tr key={`${page.path}-${index}`}>
              <td><code>{page.path}</code></td>
              <td>{formatDuration(page.p95)}</td>
              <td>{formatNumber(page.samples)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineEmpty({ message }: { message: string }) {
  return <p className="inline-empty">{message}</p>;
}

function normalizePerformanceOverview(input: unknown): PerformanceOverview {
  const outer = asRecord(input);
  const source = asRecord(outer.data ?? outer);
  const summary = asRecord(source.summary ?? source.metrics);
  const applications = asArray(source.applications ?? source.apps).map((entry) => {
    if (typeof entry === "string") return { id: entry, name: entry };
    const item = asRecord(entry);
    return { id: asString(item.id ?? item.appId ?? item.key), name: asString(item.name ?? item.label ?? item.id, "Unnamed app") };
  }).filter((application) => application.id);
  const trend = asArray(source.trend ?? source.trends ?? source.series ?? source.timeline).map((entry, index) => {
    const item = asRecord(entry);
    return {
      timestamp: asString(item.timestamp ?? item.time ?? item.bucket ?? item.date, String(index)),
      pageViews: asNumber(item.pageViews ?? item.views ?? item.count ?? item.events),
      p95: asNumber(item.p95 ?? item.p95Latency ?? item.latencyP95 ?? item.avgDuration ?? item.duration),
      errorRate: normalizeRate(item.errorRate ?? item.errors)
    };
  });
  const rawVitals = source.vitals ?? source.webVitals ?? source.coreWebVitals;
  const vitals = Array.isArray(rawVitals)
    ? rawVitals.map(normalizeVital)
    : Object.entries(asRecord(rawVitals)).map(([name, value]) => normalizeVital({ name, ...(typeof value === "object" && value ? value : { value }) }));
  const errors = asArray(source.errors ?? source.topErrors).map((entry) => {
    const item = asRecord(entry);
    return {
      message: asString(item.message ?? item.name ?? item.error ?? item.type, "Unknown error"),
      count: asNumber(item.count ?? item.events ?? item.total),
      lastSeen: optionalString(item.lastSeen ?? item.timestamp ?? item.latestAt)
    };
  });
  const slowPages = asArray(source.slowPages ?? source.pages ?? source.topSlowPages).map((entry) => {
    const item = asRecord(entry);
    return {
      path: asString(item.path ?? item.page ?? item.url ?? item.route, "Unknown page"),
      p95: asNumber(item.p95 ?? item.p95Latency ?? item.latencyP95 ?? item.duration),
      samples: asNumber(item.samples ?? item.count ?? item.views)
    };
  });

  return {
    applications,
    summary: {
      pageViews: asNumber(summary.pageViews ?? summary.views ?? summary.events ?? summary.totalEvents),
      sessions: asNumber(summary.sessions ?? summary.totalSessions ?? summary.uniqueSessions),
      errorRate: normalizeRate(summary.errorRate ?? summary.errors),
      p95: asNumber(summary.p95 ?? summary.p95Latency ?? summary.latencyP95 ?? summary.pageLoadP95)
    },
    trend,
    vitals: vitals.filter((vital) => vital.name && Number.isFinite(vital.value)),
    errors,
    slowPages,
    updatedAt: optionalString(source.updatedAt ?? source.generatedAt)
  };
}

function normalizeVital(input: unknown): VitalMetric {
  const item = asRecord(input);
  const name = asString(item.name ?? item.metric ?? item.key);
  const rawRating = asString(item.rating ?? item.status);
  const rating = rawRating === "good" || rawRating === "poor"
    ? rawRating
    : rawRating === "needs-improvement" || rawRating === "needs improvement"
      ? "needs-improvement"
      : undefined;
  return {
    name,
    value: asNumber(item.value ?? item.p75 ?? item.percentile75),
    unit: asString(item.unit, name.toLowerCase() === "cls" ? "" : "ms"),
    rating
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRate(value: unknown): number {
  const rate = asNumber(value);
  return rate > 1 ? rate / 100 : rate;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(value);
}

function formatDuration(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`;
  return `${Math.round(value)} ms`;
}

function formatVital(vital: VitalMetric): string {
  if (!vital.unit) return vital.value.toFixed(3);
  if (vital.unit === "ms") return formatDuration(vital.value);
  return `${vital.value.toFixed(2)} ${vital.unit}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatChartTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit" }).format(date);
}

function rateVital(name: string, value: number): "good" | "needs-improvement" | "poor" {
  const metric = name.toLowerCase();
  const thresholds: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
    fcp: [1800, 3000],
    ttfb: [800, 1800]
  };
  const [good, poor] = thresholds[metric] ?? [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function vitalDescription(name: string): string {
  const descriptions: Record<string, string> = {
    lcp: "Loading",
    inp: "Interaction",
    cls: "Visual stability",
    fcp: "First paint",
    ttfb: "Server response"
  };
  return descriptions[name.toLowerCase()] ?? "User experience";
}

function ProfilesView({ canWrite, profiles, onLoaded, onError, onStatus }: { canWrite: boolean; profiles: Profile[]; onLoaded: () => Promise<void>; onError: (value: string) => void; onStatus: (value: string) => void }) {
  const [token, setToken] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    onError("");
    onStatus("");
    try {
      await api("/api/github/profile", { method: "POST", body: JSON.stringify({ token }) });
      setToken("");
      onStatus("GitHub profile saved.");
      await onLoaded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "GitHub request failed");
    }
  }

  return (
    <section className="panel">
      {canWrite ? (
        <form className="token-form" onSubmit={submit}>
          <label>
            Personal access token
            <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_..." />
          </label>
          <button className="primary-button" type="submit" disabled={!token.trim()}>
            <GitBranch aria-hidden="true" />
            Fetch profile
          </button>
        </form>
      ) : (
        <p className="banner">Viewer role can inspect saved profiles but cannot fetch or modify data.</p>
      )}
      <div className="profile-list">
        {profiles.length === 0 ? <p className="empty">No saved profiles yet.</p> : null}
        {profiles.map((profile) => (
          <article className="profile-card" key={profile.githubId}>
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <div className="avatar-placeholder" />}
            <div>
              <h2>{profile.login}</h2>
              <p>{profile.name ?? "No display name"}</p>
              <a href={profile.htmlUrl} target="_blank" rel="noreferrer">
                Open GitHub
              </a>
            </div>
            <dl>
              <div><dt>Repos</dt><dd>{profile.publicRepos}</dd></div>
              <div><dt>Followers</dt><dd>{profile.followers}</dd></div>
              <div><dt>Following</dt><dd>{profile.following}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function FieldsView({
  canWrite,
  profiles,
  selectedProfile,
  selectedGithubId,
  setSelectedGithubId,
  fields,
  reloadFields,
  onError,
  onStatus
}: {
  canWrite: boolean;
  profiles: Profile[];
  selectedProfile?: Profile;
  selectedGithubId: string;
  setSelectedGithubId: (value: string) => void;
  fields: Field[];
  reloadFields: (githubId: string) => Promise<void>;
  onError: (value: string) => void;
  onStatus: (value: string) => void;
}) {
  const [fieldKey, setFieldKey] = useState("");
  const [fieldValue, setFieldValue] = useState("");

  async function addField(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfile) return;
    onError("");
    onStatus("");
    try {
      await api(`/api/profiles/${selectedProfile.githubId}/fields`, {
        method: "POST",
        body: JSON.stringify({ fieldKey, fieldValue })
      });
      setFieldKey("");
      setFieldValue("");
      onStatus("Field saved.");
      await reloadFields(selectedProfile.githubId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Field save failed");
    }
  }

  async function deleteField(id: string) {
    if (!selectedProfile) return;
    await api(`/api/fields/${id}`, { method: "DELETE" });
    await reloadFields(selectedProfile.githubId);
  }

  return (
    <section className="panel">
      <div className="field-toolbar">
        <label>
          Profile
          <select value={selectedGithubId || selectedProfile?.githubId || ""} onChange={(event) => setSelectedGithubId(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.githubId} value={profile.githubId}>
                {profile.login}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canWrite && selectedProfile ? (
        <form className="field-form" onSubmit={addField}>
          <input value={fieldKey} onChange={(event) => setFieldKey(event.target.value)} placeholder="field_key" />
          <input value={fieldValue} onChange={(event) => setFieldValue(event.target.value)} placeholder="value" />
          <button className="primary-button" type="submit" disabled={!fieldKey.trim() || !fieldValue.trim()}>
            <Plus aria-hidden="true" />
            Add
          </button>
        </form>
      ) : null}
      <div className="field-list">
        {fields.length === 0 ? <p className="empty">No custom fields for this profile.</p> : null}
        {fields.map((field) => (
          <article className="field-row" key={field.id}>
            <strong>{field.fieldKey}</strong>
            <span>{field.fieldValue}</span>
            {canWrite ? (
              <button type="button" className="icon-button danger" onClick={() => void deleteField(field.id)} aria-label={`Delete ${field.fieldKey}`}>
                <Trash2 aria-hidden="true" />
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AccessView() {
  return (
    <section className="panel">
      <h2>Seeded access model</h2>
      <ul className="access-list">
        <li><strong>admin</strong><span>All MVP pages and write actions.</span></li>
        <li><strong>operator</strong><span>Profiles and fields write actions.</span></li>
        <li><strong>viewer</strong><span>Read-only profile and field inspection.</span></li>
      </ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function viewTitle(view: View) {
  if (view === "performance") return "Performance";
  if (view === "introduction") return "Go Introduction";
  if (view === "profiles") return "GitHub Profiles";
  if (view === "fields") return "Custom Fields";
  if (view === "access") return "Access";
  return "Dashboard";
}
