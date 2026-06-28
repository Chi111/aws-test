import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/lambda.ts", "./src/setup.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [
    /@github-profile-sam\/.*/,
    /^@hono\/node-server(\/.*)?$/,
    /^dotenv(\/.*)?$/,
    /^drizzle-orm(\/.*)?$/,
    /^hono(\/.*)?$/,
    /^pg(\/.*)?$/,
    /^zod(\/.*)?$/,
  ],
});
