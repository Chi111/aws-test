# AWS AIOps Agent

This project includes a read-only AIOps investigation path deployed as a separate SAM stack:

```text
CloudWatch alarm enters ALARM
  -> EventBridge
  -> AIOps investigator Lambda
  -> Amazon Bedrock Converse tool-use loop
  -> CloudWatch Logs / alarm details / SQS queue attributes
  -> encrypted SNS report topic
  -> durable encrypted SQS report queue and optional email
```

The agent does not run in the application VPC because it does not need Aurora access. It receives no permissions to deploy, restart, delete, or otherwise mutate monitored resources.

## Source layout

- `apps/aiops-agent/src/handler.ts`: validates the EventBridge event, runs the investigation, and publishes the report.
- `apps/aiops-agent/src/agent.ts`: Bedrock Converse tool-use loop.
- `apps/aiops-agent/src/tools.ts`: allow-listed, read-only AWS tools and log redaction.
- `infra/sam/aiops-template.yaml`: Lambda, EventBridge rule, SNS topic, and least-privilege runtime IAM.

## GitHub configuration

Set these repository variables:

```text
ENABLE_AIOPS=true
BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0
AIOPS_NOTIFICATION_EMAIL=your-email@example.com
```

`AIOPS_NOTIFICATION_EMAIL` is optional. When it is set, confirm the subscription from the email sent by SNS. `BEDROCK_MODEL_ID` may be a model ID or inference profile ID that supports Converse tool use in the deployment region.

The deployment workflow reads the profile queue and DLQ URLs from the main SAM stack and passes them to the AIOps stack. The agent can only inspect queues whose ARNs start with `${PROJECT_NAME}-profile-events`.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm --filter @github-profile-sam/aiops-agent test
pnpm --filter @github-profile-sam/aiops-agent check-types
pnpm --filter @github-profile-sam/aiops-agent build
sam validate --lint --template-file infra/sam/aiops-template.yaml
sam build --template-file infra/sam/aiops-template.yaml
```

## AWS verification

1. Enable AIOps and deploy the main branch.
2. Confirm the `${PROJECT_NAME}-aiops` CloudFormation stack succeeds.
3. Confirm the SNS email subscription if configured.
4. Temporarily trigger one of the existing project alarms or publish a matching CloudWatch Alarm State Change event to EventBridge.
5. Check `/aws/lambda/${PROJECT_NAME}-aiops-investigator` for `AIOps investigation report published`.
6. Read the report from the dedicated `${PROJECT_NAME}-aiops-reports` SQS queue and verify it contains evidence, likely causes, next steps, and confidence.

If Bedrock is temporarily unavailable (for example, while a new AWS account is being verified), the Lambda publishes a sanitized report with `status: "failed"` and then returns the original error so EventBridge can retry. No alarm is silently discarded.

## Security boundaries

- Log messages are treated as untrusted input in the system prompt.
- Structured secret keys plus common passwords, tokens, cookies, JWTs, database URLs, AWS/GitHub credentials, PEM blocks, and email addresses are redacted before log results are sent to Bedrock.
- The completed model report is redacted a second time before it is published to the encrypted SNS topic.
- Queries are restricted to configured log-group prefixes and at most 60 minutes / 50 results.
- The first version performs diagnosis only. Automated remediation is intentionally out of scope.
