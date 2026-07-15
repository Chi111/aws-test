# GitHub Profile Admin SAM MVP

MVP backend admin system built with `better-t-stack`: React/Vite, Hono, Drizzle, PostgreSQL, and SAM.

The first Go migration increment lives in `apps/go-server`. It adds a read-only profile introduction API designed for Docker, ECS Fargate, ALB health checks, and later Cloud Map integration. See `apps/go-server/README.md` for its runtime contract and local commands.

The PR preview architecture uses GitHub OIDC, three narrowly scoped IAM roles, CodeBuild, ECR, a shared ALB, and per-PR ECS Fargate services. See [PR 独立预览环境](docs/pr-preview-architecture.md) for the architecture and manual AWS console checklist.

The private service-to-service path lets the VPC-attached Lambda call the ECS Go service through Cloud Map DNS without traversing the public ALB. See [Lambda 通过 Cloud Map 调用 ECS Go 服务](docs/cloud-map-lambda.md).

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
- Optional managed VPC networking parameters:
  - `EnableManagedVpcNetworking`
  - `InternetGatewayId`
  - `ManagedPublicSubnetCidr`
  - `ManagedPrivateSubnet1Cidr`
  - `ManagedPrivateSubnet2Cidr`
  - `ManagedPublicSubnetAz`
  - `ManagedPrivateSubnet1Az`
  - `ManagedPrivateSubnet2Az`

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
- Optional variable `ENABLE_MANAGED_VPC_NETWORKING`
- Optional variable `INTERNET_GATEWAY_ID`
- Optional variables `MANAGED_PUBLIC_SUBNET_CIDR`, `MANAGED_PRIVATE_SUBNET_1_CIDR`, `MANAGED_PRIVATE_SUBNET_2_CIDR`
- Optional variables `MANAGED_PUBLIC_SUBNET_AZ`, `MANAGED_PRIVATE_SUBNET_1_AZ`, `MANAGED_PRIVATE_SUBNET_2_AZ`

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
| `CORS_ORIGIN` | First deploy: `http://localhost:3001`; after deploy, update to `http://github-profile-sam-dev-web-311816466050-us-east-2.s3-website.us-east-2.amazonaws.com` |
| `VPC_ID` | `vpc-0b653a19dd83dfa79` |
| `PRIVATE_SUBNET_IDS` | `subnet-0afbf279c7e89bd2d,subnet-0f1075ff3eaba752e` |
| `AURORA_SECURITY_GROUP_ID` | `sg-0b4619fa07595e65f` |
| `VITE_SERVER_URL` | First deploy: `http://localhost:3000`; after deploy, update to the API URL |
| `SAM_ARTIFACT_BUCKET` | Optional. Default: `github-profile-sam-dev-artifacts-311816466050-us-east-2` |
| `ENABLE_MANAGED_VPC_NETWORKING` | Optional. `false` keeps the current default subnets; `true` creates one public subnet, two private subnets, NAT, and routes |
| `INTERNET_GATEWAY_ID` | Required when `ENABLE_MANAGED_VPC_NETWORKING=true`. Current default VPC IGW was `igw-01db71fd0dd6333e6` during audit |
| `MANAGED_PUBLIC_SUBNET_CIDR` | Optional. Default `172.31.240.0/24` |
| `MANAGED_PRIVATE_SUBNET_1_CIDR` | Optional. Default `172.31.241.0/24` |
| `MANAGED_PRIVATE_SUBNET_2_CIDR` | Optional. Default `172.31.242.0/24` |
| `MANAGED_PUBLIC_SUBNET_AZ` | Optional. Default `us-east-2a` |
| `MANAGED_PRIVATE_SUBNET_1_AZ` | Optional. Default `us-east-2b` |
| `MANAGED_PRIVATE_SUBNET_2_AZ` | Optional. Default `us-east-2c` |

GitHub repo: `Chi111/aws-test`.

The workflow does not connect to RDS directly from GitHub-hosted runners. It deploys a VPC-internal `SetupFunction`, then invokes that Lambda to create the MVP tables and seed demo users from inside your VPC. Keep RDS private; the RDS security group only needs to allow PostgreSQL from the Lambda security group created by the SAM stack.

## Optional: Managed VPC Networking

The default MVP can run with the existing default subnets. To get closer to a production-style assignment architecture, enable SAM-managed networking:

- One public subnet for NAT.
- Two private subnets for Lambda.
- Public route table to the existing Internet Gateway.
- Private route table to NAT Gateway.
- API and setup Lambda automatically use the two managed private subnets.
- Aurora remains the existing database in the same VPC.

Important: NAT Gateway has hourly and data processing cost. Enable it only when you need Lambda outbound internet access, for example calling GitHub `/user` from inside the VPC.

Before enabling, confirm the CIDR blocks do not overlap with existing VPC subnets. Current defaults are intentionally high in the default VPC range:

```txt
public:    172.31.240.0/24
private 1: 172.31.241.0/24
private 2: 172.31.242.0/24
```

To enable from GitHub Actions variables:

```txt
ENABLE_MANAGED_VPC_NETWORKING=true
INTERNET_GATEWAY_ID=igw-01db71fd0dd6333e6
MANAGED_PUBLIC_SUBNET_CIDR=172.31.240.0/24
MANAGED_PRIVATE_SUBNET_1_CIDR=172.31.241.0/24
MANAGED_PRIVATE_SUBNET_2_CIDR=172.31.242.0/24
MANAGED_PUBLIC_SUBNET_AZ=us-east-2a
MANAGED_PRIVATE_SUBNET_1_AZ=us-east-2b
MANAGED_PRIVATE_SUBNET_2_AZ=us-east-2c
```

IAM examples are provided here:

- `infra/iam/github-actions-trust-policy.example.json`
- `infra/iam/github-actions-deploy-policy.example.json`
- `infra/iam/cloud-map-deploy-policy.example.json`
- `infra/iam/pr-trigger-fallback-policy.example.json`
- `infra/iam/pr-trigger-fallback-trust-policy.example.json`
- `infra/iam/codebuild-fallback-trust-policy.example.json`

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
