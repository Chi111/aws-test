import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL_CA_PATH: z.string().optional(),
    CORS_ORIGIN: z.url(),
    GO_SERVICE_BASE_URL: z.url().optional(),
    PROFILE_EVENTS_TOPIC_ARN: z.string().min(1).optional(),
    METRIC_SERVICE_NAME: z.string().min(1).default("github-profile-sam-local"),
    RELEASE_VERSION: z.string().min(1).default("local"),
    JWT_SECRET: z.string().min(32).default("dev-only-change-me-jwt-secret-32-chars"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
