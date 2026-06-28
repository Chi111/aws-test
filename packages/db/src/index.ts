import { env } from "@github-profile-sam/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

import * as schema from "./schema";

export function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL_CA_PATH
      ? {
          ca: readFileSync(env.DATABASE_SSL_CA_PATH, "utf8"),
          rejectUnauthorized: true,
        }
      : undefined,
  });

  return drizzle(pool, { schema });
}

export const db = createDb();
