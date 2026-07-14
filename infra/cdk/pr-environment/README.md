# PR Preview Environment

This AWS CDK v2 application defines two kinds of stacks:

- `github-profile-preview-base`: one shared ECS cluster and Application Load Balancer.
- `github-profile-pr-<number>`: one isolated Fargate service, task definition, security group, target group, listener rule, and log group per pull request.

The shared ALB keeps preview costs bounded. Cloudflare points a wildcard record such as `*.preview.example.com` at the base stack's ALB. Each PR stack then routes `pr-<number>.preview.example.com` to its own target group.

The app deliberately uses an existing VPC and the existing `ecsTaskExecutionRole`. It does not create IAM roles or databases. Preview tasks currently receive a non-secret placeholder `DATABASE_URL`; replace that with a Secrets Manager reference before enabling database-backed preview traffic.

## Required environment

Base stack:

```text
DEPLOY_MODE=base
AWS_ACCOUNT_ID=311816466050
AWS_REGION=us-east-2
VPC_ID=vpc-...
PUBLIC_SUBNET_IDS=subnet-a,subnet-b,subnet-c
```

PR stack:

```text
DEPLOY_MODE=pr
PR_NUMBER=123
IMAGE_URI=311816466050.dkr.ecr.us-east-2.amazonaws.com/github-profile-go:pr-123-<sha>
PREVIEW_DOMAIN=preview.example.com
AWS_ACCOUNT_ID=311816466050
AWS_REGION=us-east-2
VPC_ID=vpc-...
PUBLIC_SUBNET_IDS=subnet-a,subnet-b,subnet-c
ECS_TASK_EXECUTION_ROLE_ARN=arn:aws:iam::311816466050:role/service-role/ecsTaskExecutionRole
```

## Local validation

```bash
go test ./...
```

Synthesis requires the environment variables above and the CDK CLI:

```bash
npx aws-cdk@2.1130.0 synth
```
