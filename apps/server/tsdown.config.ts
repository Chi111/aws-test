import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/lambda.ts",
    "./src/setup.ts",
    "./src/profile-event-worker.ts",
    "./src/profile-event-outbox-publisher.ts",
    "./src/performance-log-worker.ts"
  ],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [
    /^@aws-sdk\/client-secrets-manager(\/.*)?$/,
    /^@aws-sdk\/client-sns(\/.*)?$/,
    /@github-profile-sam\/.*/,
    /^@hono\/node-server(\/.*)?$/,
    /^dotenv(\/.*)?$/,
    /^drizzle-orm(\/.*)?$/,
    /^hono(\/.*)?$/,
    /^pg(\/.*)?$/,
    /^zod(\/.*)?$/,
  ],
});
