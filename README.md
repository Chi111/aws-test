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
- `pnpm db:check`: print a masked database connectivity diagnostic.
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

For your current AWS dev setup, use these values:

Secrets:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@database-1-instance-1.cziie46y84oa.us-east-2.rds.amazonaws.com:5432/database_japan` |
| `JWT_SECRET` | Any random string with at least 32 characters |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN trusted by `Chi111/aws-test` GitHub Actions |

Variables:

| Name | Value |
| --- | --- |
| `AWS_REGION` | `us-east-2` |
| `STACK_NAME` | `github-profile-sam-dev` |
| `PROJECT_NAME` | `github-profile-sam-dev` |
| `CORS_ORIGIN` | First deploy: `http://localhost:3001`; after deploy, update to the S3 website URL |
| `VPC_ID` | `vpc-0b653a19dd83dfa79` |
| `PRIVATE_SUBNET_IDS` | `subnet-0afbf279c7e89bd2d,subnet-0f1075ff3eaba752e` |
| `AURORA_SECURITY_GROUP_ID` | `sg-0b4619fa07595e65f` |
| `VITE_SERVER_URL` | First deploy: `http://localhost:3000`; after deploy, update to the API URL |

GitHub repo: `Chi111/aws-test`.

The workflow downloads the AWS RDS global CA bundle, then runs `pnpm db:push` and `pnpm db:seed` before `sam deploy`. For that to work, your RDS security group must allow inbound PostgreSQL traffic from GitHub-hosted runners, or you need to run the workflow on a runner that has network access to the VPC.
