import { readFileSync } from "node:fs";

type DatabaseSslOptions = {
  nodeEnv?: string;
  sslCaPath?: string;
};

export function createDatabaseSslConfig({ nodeEnv, sslCaPath }: DatabaseSslOptions) {
  if (sslCaPath) {
    return {
      ca: readFileSync(sslCaPath, "utf8"),
      rejectUnauthorized: true,
    };
  }

  if (nodeEnv === "production") {
    return {
      rejectUnauthorized: false,
    };
  }

  return undefined;
}
