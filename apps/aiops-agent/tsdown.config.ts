import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/handler.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/^@aws-sdk\//],
    onlyBundle: false
  }
});
