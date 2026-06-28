import { env } from "@github-profile-sam/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import { createDatabaseSslConfig } from "./ssl";

export function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: createDatabaseSslConfig({
      nodeEnv: env.NODE_ENV,
      sslCaPath: env.DATABASE_SSL_CA_PATH,
    }),
  });

  return drizzle(pool, { schema });
}

export const db = createDb();
