import { createFileRoute } from "@tanstack/react-router";
import { Activity, GitBranch, KeyRound, Lock, LogOut, Plus, Shield, Trash2, UserRound } from "lucide-react";
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
type View = "dashboard" | "profiles" | "fields" | "access";

const apiBase = env.VITE_SERVER_URL.replace(/\/+$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
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
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary-button" type="submit">
          <KeyRound aria-hidden="true" />
          Login
        </button>
        {error ? <p className="banner error">{error}</p> : null}
        <p className="hint">Try admin@example.com, operator@example.com, or viewer@example.com.</p>
      </form>
    </main>
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
  if (view === "profiles") return "GitHub Profiles";
  if (view === "fields") return "Custom Fields";
  if (view === "access") return "Access";
  return "Dashboard";
}
