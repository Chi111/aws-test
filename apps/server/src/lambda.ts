import { env } from "@github-profile-sam/env/server";
import { createApp } from "./app";
import { logApiServerErrorMetric } from "./api-metrics";

type ApiGatewayV2Event = {
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: false;
};

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  goServiceBaseUrl: env.GO_SERVICE_BASE_URL,
  jwtSecret: env.JWT_SECRET,
  releaseVersion: env.RELEASE_VERSION,
  isProduction: env.NODE_ENV === "production"
});

function requestFromEvent(event: ApiGatewayV2Event) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  if (!headers.has("cookie") && event.cookies?.length) {
    headers.set("cookie", event.cookies.join("; "));
  }
  const host = headers.get("host") ?? "lambda.local";
  const rawPath = event.rawPath || "/";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const method = event.requestContext?.http?.method ?? "GET";
  const body =
    event.body && method !== "GET" && method !== "HEAD"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body
      : undefined;

  return new Request(`https://${host}${rawPath}${query}`, { method, headers, body });
}

export async function handler(event: ApiGatewayV2Event): Promise<LambdaResponse> {
  const response = await app.fetch(requestFromEvent(event));
  logApiServerErrorMetric(response.status, env.METRIC_SERVICE_NAME);
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value);
    } else {
      headers[key] = value;
    }
  });
  return {
    statusCode: response.status,
    headers,
    cookies: cookies.length ? cookies : undefined,
    body: await response.text(),
    isBase64Encoded: false
  };
}
