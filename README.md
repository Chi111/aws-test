# GitHub Profile Admin SAM MVP

MVP backend admin system built with `better-t-stack`: React/Vite, Hono, Drizzle, PostgreSQL, and SAM.

## What It Does

- Internal demo login with three roles: `admin`, `operator`, `viewer`.
- Role-based pages in the admin UI.
- `admin` and `operator` can fetch a GitHub profile with a personal token.
- `viewer` can inspect saved data but cannot write.
- GitHub token is only used for the request to GitHub `/user`; it is not stored.
- Custom key-value fields can be added to saved GitHub profiles.

## Local Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
pnpm db:push
pnpm db:seed
pnpm dev
```

Open the web app at [http://localhost:3001](http://localhost:3001). The API runs at [http://localhost:3000](http://localhost:3000).

Seed accounts:

| Role | Email | Password |
| --- | --- | --- |
| admin | `admin@example.com` | `Admin123!` |
| operator | `operator@example.com` | `Operator123!` |
| viewer | `viewer@example.com` | `Viewer123!` |

## Scripts

- `pnpm dev`: run web and API locally.
- `pnpm test`: run automated tests.
- `pnpm check-types`: TypeScript checks.
- `pnpm build`: build server and web.
- `pnpm db:generate`: generate Drizzle migrations.
- `pnpm db:push`: push schema to a dev database.
- `pnpm db:seed`: seed demo users.

## AWS SAM MVP Deploy

This MVP does not create Aurora. It connects Lambda to an existing Aurora PostgreSQL Serverless v2 database in your existing VPC.

Copy `infra/sam/samconfig.example.toml` to `infra/sam/samconfig.toml`, then fill:

- `DatabaseUrl`
- `JwtSecret`
- `CorsOrigin`
- `VpcId`
- `PrivateSubnetIds`
- `AuroraSecurityGroupId`

Build locally before deploy:

```bash
pnpm test
pnpm build
sam validate --template-file infra/sam/template.yaml
sam build --template-file infra/sam/template.yaml
sam deploy --config-file infra/sam/samconfig.toml --template-file infra/sam/template.yaml
```

## GitHub Actions

`.github/workflows/deploy.yml` uses GitHub OIDC. Configure:

- Secret `AWS_DEPLOY_ROLE_ARN`
- Secret `DATABASE_URL`
- Secret `JWT_SECRET`
- Variable `AWS_REGION`
- Variable `STACK_NAME`
- Variable `PROJECT_NAME`
- Variable `CORS_ORIGIN`
- Variable `VPC_ID`
- Variable `PRIVATE_SUBNET_IDS`
- Variable `AURORA_SECURITY_GROUP_ID`
- Variable `VITE_SERVER_URL`
