import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

dotenv.config({
  path: "../../apps/server/.env",
});

function dbCredentials() {
  const databaseUrl = process.env.DATABASE_URL || "";
  const sslCaPath = process.env.DATABASE_SSL_CA_PATH;

  if (!sslCaPath) {
    return { url: databaseUrl };
  }

  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    ssl: {
      ca: readFileSync(sslCaPath, "utf8"),
      rejectUnauthorized: true,
    },
  };
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: dbCredentials(),
});
