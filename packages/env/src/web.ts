import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url().default("http://localhost:3000"),
    VITE_PERFORMANCE_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    VITE_PERFORMANCE_APP_ID: z.string().min(1).default("github-profile-web"),
    VITE_RELEASE_VERSION: z.string().min(1).default("local"),
    VITE_APP_ENV: z.string().min(1).default("development"),
  },
  runtimeEnv: (import.meta as any).env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
