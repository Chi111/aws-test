import assert from "node:assert/strict";
import test from "node:test";
import worker, { previewTarget, proxyPreview } from "./worker.js";

test("maps only the two supported Go preview routes", () => {
  assert.equal(previewTarget("/api/go/health"), "/healthz");
  assert.equal(previewTarget("/api/go/introductions/Chi111"), "/api/v1/introductions/Chi111");
  assert.equal(previewTarget("/api/go/introductions/-invalid"), null);
  assert.equal(previewTarget("/api/admin/users"), null);
});

test("adds routing proof to a PR introduction response", async () => {
  const response = await proxyPreview(
    new Request("https://pr.example/api/go/introductions/Chi111"),
    { PR_BACKEND_URL: "http://preview-alb.example", PR_NUMBER: "5" },
    async (url, init) => {
      assert.equal(String(url), "http://preview-alb.example/api/v1/introductions/Chi111");
      assert.equal(init.headers["x-preview-pr"], "5");
      return Response.json({
        profile: { login: "Chi111" },
        introduction: "你好，我是 Chi111。",
        backendProof: {
          service: "github-profile-go",
          runtime: "go",
          dataSource: "postgresql",
        },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-preview-service"), "github-profile-go");
  assert.deepEqual(await response.json(), {
    profile: { login: "Chi111" },
    introduction: "你好，我是 Chi111。",
    backendProof: {
      service: "github-profile-go",
      runtime: "go",
      dataSource: "postgresql",
    },
    preview: {
      prNumber: 5,
      runtime: "go",
      service: "github-profile-go",
      routing: "cloudflare-worker-to-pr-alb",
    },
  });
});

test("does not become an arbitrary origin proxy", async () => {
  const fetcher = async () => {
    throw new Error("fetch should not be called");
  };
  const response = await proxyPreview(
    new Request("https://pr.example/api/admin/users"),
    { PR_BACKEND_URL: "http://preview-alb.example", PR_NUMBER: "5" },
    fetcher,
  );
  assert.equal(response, null);
});

test("returns JSON 404 for unsupported API routes instead of the SPA shell", async () => {
  let assetsCalled = false;
  const response = await worker.fetch(
    new Request("https://pr.example/api/auth/me"),
    {
      PR_BACKEND_URL: "http://preview-alb.example",
      PR_NUMBER: "5",
      ASSETS: {
        fetch() {
          assetsCalled = true;
          return new Response("<html>SPA shell</html>");
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), {
    error: "API route is not available in this PR preview",
  });
  assert.equal(assetsCalled, false);
});
