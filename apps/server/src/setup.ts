import { env } from "@github-profile-sam/env/server";
import { Pool } from "pg";
import { createPasswordHash } from "./auth";

const users = [
  { email: "admin@example.com", name: "Admin", role: "admin", password: "Admin123!" },
  { email: "operator@example.com", name: "Operator", role: "operator", password: "Operator123!" },
  { email: "viewer@example.com", name: "Viewer", role: "viewer", password: "Viewer123!" }
] as const;

export async function handler() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();

  try {
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
