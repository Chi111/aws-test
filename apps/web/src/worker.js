const introductionPath = /^\/api\/go\/introductions\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)$/;

export function previewTarget(pathname) {
  if (pathname === "/api/go/health") return "/healthz";
  const match = introductionPath.exec(pathname);
  if (match) return `/api/v1/introductions/${encodeURIComponent(match[1])}`;
  return null;
}

export async function proxyPreview(request, env, fetcher = fetch) {
  const incoming = new URL(request.url);
  const targetPath = previewTarget(incoming.pathname);
  if (!targetPath) return null;
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!env.PR_BACKEND_URL || !/^\d{1,5}$/.test(env.PR_NUMBER ?? "")) {
    return Response.json({ error: "PR backend is not configured" }, { status: 503 });
  }

  const target = new URL(targetPath, `${env.PR_BACKEND_URL.replace(/\/+$/, "")}/`);
  const response = await fetcher(target, {
    headers: {
      accept: "application/json",
      "x-preview-pr": env.PR_NUMBER,
    },
    redirect: "manual",
  });
  const body = await response.json().catch(() => ({ error: "PR backend returned invalid JSON" }));
  const proof = {
    prNumber: Number(env.PR_NUMBER),
    runtime: "go",
    service: "github-profile-go",
    routing: "cloudflare-worker-to-pr-alb",
  };

  return Response.json(
    typeof body === "object" && body !== null ? { ...body, preview: proof } : { error: "Invalid response", preview: proof },
    {
      status: response.status,
      headers: {
        "cache-control": "no-store",
        "x-preview-pr": env.PR_NUMBER,
        "x-preview-runtime": "go",
        "x-preview-service": "github-profile-go",
      },
    },
  );
}

export default {
  async fetch(request, env) {
    const previewResponse = await proxyPreview(request, env);
    if (previewResponse) return previewResponse;

    const incoming = new URL(request.url);
    if (incoming.pathname.startsWith("/api/")) {
      return Response.json({ error: "API route is not available in this PR preview" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
