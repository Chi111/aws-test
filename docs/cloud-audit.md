# Cloud Resource Audit

Use this checklist for the `github-profile-sam-dev` MVP deployment in AWS account `311816466050`, region `us-east-2`.

## Current Deployment Failure

The latest failure is IAM-related:

```txt
not authorized to perform: cloudformation:CreateChangeSet on resource:
arn:aws:cloudformation:us-east-2:aws:transform/Serverless-2016-10-31
```

This means the GitHub Actions deploy role can upload SAM artifacts to S3, but cannot create the CloudFormation changeset for a SAM template.

Fix: attach `infra/iam/github-actions-deploy-policy.example.json` to the IAM role used by `AWS_DEPLOY_ROLE_ARN`.

## AWS CLI Audit Result

Checked on 2026-06-29 with read-only AWS CLI commands.

Good:

- AWS account is `311816466050`.
- GitHub Actions role is `arn:aws:iam::311816466050:role/github`.
- OIDC trust policy allows `repo:Chi111/aws-test:ref:refs/heads/main`.
- RDS instance `database-1-instance-1` is `available`.
- Aurora cluster `database-1` is `available`.
- PostgreSQL database name is `database_japan`.
- RDS endpoint is `database-1-instance-1.cziie46y84oa.us-east-2.rds.amazonaws.com:5432`.
- RDS public access is disabled.
- RDS security group is `sg-0b4619fa07595e65f`.
- SAM artifact bucket `github-profile-sam-dev-artifacts-311816466050-us-east-2` exists in `us-east-2`.

Needs fixing before the next deploy:

- The stack `github-profile-sam-dev` is currently `ROLLBACK_COMPLETE`; delete it before the next create attempt. The workflow now removes this failed shell automatically.
- Current IAM simulation shows `iam:CreateRole`, `iam:TagRole`, `iam:AttachRolePolicy`, `iam:PassRole`, `ec2:CreateSecurityGroup`, `ec2:CreateTags`, and security group rule writes are still `implicitDeny`.
- Attach `infra/iam/github-actions-deploy-policy.example.json` as an inline policy, or temporarily attach `IAMFullAccess` and `AmazonEC2FullAccess` for this dev MVP deployment.
- After `IAMFullAccess` and `AmazonEC2FullAccess` were added, the next rollback was caused by missing API Gateway permissions: `apigateway:POST` on `arn:aws:apigateway:us-east-2::/tags/...`. Add `AmazonAPIGatewayAdministrator`, or use the updated API Gateway statement in `infra/iam/github-actions-deploy-policy.example.json`.

Networking note for after deploy:

- The selected subnets are default subnets with `MapPublicIpOnLaunch=true`.
- The VPC has an Internet Gateway route, but no NAT Gateway.
- Lambda functions attached to a VPC do not automatically receive public IPs, so GitHub API calls from Lambda may fail until private subnets with NAT, or another outbound design, is added.

## GitHub OIDC

- IAM OIDC provider: `token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`
- Allowed branch subject: `repo:Chi111/aws-test:ref:refs/heads/main`
- Example trust policy: `infra/iam/github-actions-trust-policy.example.json`

## GitHub Repository Settings

Secrets:

- `AWS_DEPLOY_ROLE_ARN`
- `DATABASE_URL`
- `JWT_SECRET`

Variables:

- `AWS_REGION=us-east-2`
- `STACK_NAME=github-profile-sam-dev`
- `PROJECT_NAME=github-profile-sam-dev`
- `CORS_ORIGIN=http://localhost:3001` for first deploy
- `VPC_ID=vpc-0b653a19dd83dfa79`
- `PRIVATE_SUBNET_IDS=subnet-0afbf279c7e89bd2d,subnet-0f1075ff3eaba752e`
- `AURORA_SECURITY_GROUP_ID=sg-0b4619fa07595e65f`
- `VITE_SERVER_URL=http://localhost:3000` for first deploy
- Optional `SAM_ARTIFACT_BUCKET=github-profile-sam-dev-artifacts-311816466050-us-east-2`

## RDS and VPC

- RDS resource identifier can remain `database-1`.
- RDS instance endpoint can remain `database-1-instance-1.cziie46y84oa.us-east-2.rds.amazonaws.com`.
- PostgreSQL database name in `DATABASE_URL` should be `database_japan`.
- RDS public access should stay disabled.
- RDS security group should allow PostgreSQL `5432` from the SAM-created Lambda security group after deployment.
- The two Lambda subnets should have outbound internet access through NAT if the API needs to call GitHub.

## Expected Deployment Order

1. GitHub Actions assumes the OIDC role.
2. Workflow builds web and server.
3. Workflow creates or reuses the SAM artifact bucket.
4. `sam deploy` creates CloudFormation resources.
5. CloudFormation creates the Lambda security group and adds Aurora ingress from that group.
6. Workflow invokes `SetupFunction` inside the VPC to create tables and seed users.
7. Workflow syncs frontend assets to the S3 website bucket.
