import { describe, expect, it, vi } from "vitest";
import { logApiServerErrorMetric } from "./api-metrics";

describe("API server error metrics", () => {
  it("emits CloudWatch Embedded Metric Format for 5xx responses", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logApiServerErrorMetric(503, "github-profile-sam-dev");

    const metric = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(metric).toMatchObject({
      Service: "github-profile-sam-dev",
      Api5xxCount: 1,
      StatusCode: 503,
      _aws: { CloudWatchMetrics: [{ Namespace: "GitHubProfileSam" }] }
    });
    info.mockRestore();
  });

  it("does not emit a server error metric for successful responses", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logApiServerErrorMetric(200, "github-profile-sam-dev");

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
