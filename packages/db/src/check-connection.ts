import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

dotenv.config({ path: "../../apps/server/.env" });

const databaseUrl = process.env.DATABASE_URL ?? "";
const sslCaPath = process.env.DATABASE_SSL_CA_PATH;

function maskUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return value ? "<invalid-url>" : "<missing>";
  }
}

console.log("DB config:", {
  databaseUrl: maskUrl(databaseUrl),
  hasSslCaPath: Boolean(sslCaPath),
  sslCaPath,
  sslCaPathExists: sslCaPath ? existsSync(sslCaPath) : null,
});

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing in apps/server/.env");
}

if (sslCaPath && !existsSync(sslCaPath)) {
  throw new Error(`DATABASE_SSL_CA_PATH does not exist: ${sslCaPath}`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslCaPath
    ? {
        ca: readFileSync(sslCaPath, "utf8"),
        rejectUnauthorized: true,
      }
    : undefined,
  connectionTimeoutMillis: 10_000,
});

try {
  const result = await pool.query("select current_database() as database, current_user as user, version() as version");
  console.log("DB connection ok:", result.rows[0]);
} catch (error) {
  console.error("DB connection failed:");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
