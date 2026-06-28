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
- Optional variable `SAM_ARTIFACT_BUCKET`

For your current AWS dev setup, use these values:

Secrets:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@database-1-instance-1.cziie46y84oa.us-east-2.rds.amazonaws.com:5432/database_japan` |
| `JWT_SECRET` | Any random string with at least 32 characters |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN trusted by `Chi111/aws-test` GitHub Actions |

RDS console names can be confusing:

- `database-1` is the RDS cluster/resource identifier.
- `database-1-instance-1` is the DB instance/resource identifier and appears in the endpoint host.
- `database_japan` is the PostgreSQL database name used at the end of `DATABASE_URL`.

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
| `SAM_ARTIFACT_BUCKET` | Optional. Default: `github-profile-sam-dev-artifacts-311816466050-us-east-2` |

GitHub repo: `Chi111/aws-test`.

The workflow does not connect to RDS directly from GitHub-hosted runners. It deploys a VPC-internal `SetupFunction`, then invokes that Lambda to create the MVP tables and seed demo users from inside your VPC. Keep RDS private; the RDS security group only needs to allow PostgreSQL from the Lambda security group created by the SAM stack.

IAM examples are provided here:

- `infra/iam/github-actions-trust-policy.example.json`
- `infra/iam/github-actions-deploy-policy.example.json`

The deploy role needs permission to invoke the setup Lambda:

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": "*"
}
```

The workflow uses a fixed S3 bucket for SAM artifacts instead of `sam deploy --resolve-s3`. This avoids the hidden `aws-sam-cli-managed-default` CloudFormation stack. Add these extra permissions to the GitHub Actions deploy role:

```json
{
  "Effect": "Allow",
  "Action": "sts:GetCallerIdentity",
  "Resource": "*"
}
```

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:CreateBucket",
    "s3:GetBucketLocation",
    "s3:ListBucket"
  ],
  "Resource": "arn:aws:s3:::github-profile-sam-dev-artifacts-311816466050-us-east-2"
}
```

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject"
  ],
  "Resource": "arn:aws:s3:::github-profile-sam-dev-artifacts-311816466050-us-east-2/*"
}
```

SAM templates also require CloudFormation access to the AWS-owned transform resource:

```json
{
  "Effect": "Allow",
  "Action": [
    "cloudformation:CreateChangeSet",
    "cloudformation:GetTemplateSummary",
    "cloudformation:ValidateTemplate"
  ],
  "Resource": "arn:aws:cloudformation:us-east-2:aws:transform/Serverless-2016-10-31"
}
```
