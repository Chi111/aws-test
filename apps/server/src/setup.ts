import { env } from "@github-profile-sam/env/server";
import { createDatabaseSslConfig } from "@github-profile-sam/db/ssl";
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Pool } from "pg";
import { createPasswordHash } from "./auth";

const users = [
  { email: "admin@example.com", name: "Admin", role: "admin", password: "Admin123!" },
  { email: "operator@example.com", name: "Operator", role: "operator", password: "Operator123!" },
  { email: "viewer@example.com", name: "Viewer", role: "viewer", password: "Viewer123!" }
] as const;

type SetupEvent = {
  action?: "setup" | "provision-preview-database-user";
  secretArn?: string;
};

const previewSecretName = "github-profile/pr-database-url";
const previewUsernamePattern = /^[a-z][a-z0-9_]{2,62}$/;

export async function handler(event: SetupEvent = {}) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: createDatabaseSslConfig({
      nodeEnv: env.NODE_ENV,
      sslCaPath: env.DATABASE_SSL_CA_PATH,
    }),
  });
  const client = await pool.connect();

  try {
    if (event.action === "provision-preview-database-user") {
      if (!event.secretArn) {
        throw new Error("secretArn is required");
      }
      const secretArn = event.secretArn;
      if (!secretArn.includes(`:secret:${previewSecretName}-`)) {
        throw new Error(`secretArn must refer to ${previewSecretName}`);
      }

      const secrets = new SecretsManagerClient({});
      const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
      if (!secret.SecretString) {
        throw new Error("preview database secret must contain a string value");
      }

      let username: string;
      let password: string;
      if (secret.SecretString.startsWith("postgresql://")) {
        const existing = new URL(secret.SecretString);
        username = decodeURIComponent(existing.username);
        password = decodeURIComponent(existing.password);
      } else {
        const credentials = JSON.parse(secret.SecretString) as { username?: unknown; password?: unknown };
        username = typeof credentials.username === "string" ? credentials.username : "";
        password = typeof credentials.password === "string" ? credentials.password : "";
      }
      if (!previewUsernamePattern.test(username)) {
        throw new Error("preview database username is invalid");
      }
      if (password.length < 32) {
        throw new Error("preview database password must contain at least 32 characters");
      }

      const quoted = await client.query<{
        usernameIdentifier: string;
        passwordLiteral: string;
        databaseIdentifier: string;
      }>(
        `select
           quote_ident($1) as "usernameIdentifier",
           quote_literal($2) as "passwordLiteral",
           quote_ident(current_database()) as "databaseIdentifier"`,
        [username, password],
      );
      const escaped = quoted.rows[0];
      if (!escaped) {
        throw new Error("failed to quote preview database credentials");
      }

      await client.query("begin");
      const existingRole = await client.query<{ exists: boolean }>(
        "select exists(select 1 from pg_roles where rolname = $1) as exists",
        [username],
      );
      if (existingRole.rows[0]?.exists) {
        await client.query(`alter role ${escaped.usernameIdentifier} login password ${escaped.passwordLiteral};`);
      } else {
        await client.query(`create role ${escaped.usernameIdentifier} login password ${escaped.passwordLiteral};`);
      }
      await client.query(`revoke all on all tables in schema public from ${escaped.usernameIdentifier};`);
      await client.query(`grant connect on database ${escaped.databaseIdentifier} to ${escaped.usernameIdentifier};`);
      await client.query(`grant usage on schema public to ${escaped.usernameIdentifier};`);
      await client.query(`grant select on table public.github_profiles to ${escaped.usernameIdentifier};`);
      await client.query("commit");

      const databaseURL = new URL(env.DATABASE_URL);
      databaseURL.username = username;
      databaseURL.password = password;
      databaseURL.searchParams.set("sslmode", "require");
      await secrets.send(new PutSecretValueCommand({
        SecretId: secretArn,
        SecretString: databaseURL.toString(),
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          action: "provision-preview-database-user",
          username,
          grants: ["CONNECT", "USAGE public", "SELECT public.github_profiles"],
          secretUpdated: true,
        }),
      };
    }

    await client.query("begin");
    await client.query("create extension if not exists pgcrypto;");
    await client.query(`
      do $$ begin
        create type admin_role as enum ('admin', 'operator', 'viewer');
      exception
        when duplicate_object then null;
      end $$;
    `);
    await client.query(`
      create table if not exists admin_users (
        id uuid primary key default gen_random_uuid(),
        email varchar(255) not null unique,
        name varchar(120) not null,
        role admin_role not null default 'viewer',
        password_hash text not null,
        created_at timestamptz not null default now()
      );
    `);
    await client.query(`
      create table if not exists github_profiles (
        github_id varchar(64) primary key,
        login varchar(120) not null unique,
        name varchar(255),
        avatar_url text,
        html_url text not null,
        public_repos integer not null default 0,
        followers integer not null default 0,
        following integer not null default 0,
        github_updated_at timestamptz,
        fetched_at timestamptz not null default now()
      );
    `);
    await client.query(`
      create table if not exists github_profile_fields (
        id uuid primary key default gen_random_uuid(),
        github_id varchar(64) not null references github_profiles(github_id) on delete cascade,
        field_key varchar(80) not null,
        field_value text not null,
        created_at timestamptz not null default now()
      );
    `);
    await client.query(`
      create unique index if not exists github_profile_fields_profile_key_unique
      on github_profile_fields (github_id, field_key);
    `);

    for (const user of users) {
      await client.query(
        `
          insert into admin_users (email, name, role, password_hash)
          values ($1, $2, $3, $4)
          on conflict (email) do update set
            name = excluded.name,
            role = excluded.role,
            password_hash = excluded.password_hash;
        `,
        [user.email, user.name, user.role, await createPasswordHash(user.password)]
      );
    }

    await client.query("commit");
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, seededUsers: users.length })
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
