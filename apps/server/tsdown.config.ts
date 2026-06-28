import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/lambda.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@github-profile-sam\/.*/],
});
