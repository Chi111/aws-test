# AWS Synthetics、SNS/SQS/DLQ 与 API 灰度作业

本项目已经实现三条可独立验收的链路：

1. CloudWatch Synthetics 定时访问公开的 `GET /health`，验证状态码、服务名和发布版本。
2. 保存 GitHub Profile 时在同一个 PostgreSQL 事务中写入 `profile.updated` Outbox；定时 Publisher Lambda 将已提交事件发布到 SNS，SNS 投递到 SQS，Worker Lambda 消费；连续失败三次的消息进入 SQS DLQ。
3. SAM 为 API Lambda 发布 `live` Alias，并由 CodeDeploy 按 `Canary10Percent10Minutes` 将 10% 流量先切到新版本。API 用 CloudWatch Embedded Metric Format 记录所有 HTTP 5xx；另一个 Lambda `Errors` 告警捕获崩溃、超时和未处理异常，两类告警都能终止并回滚异常部署。

## 需要手工完成的配置

把 `infra/iam/github-actions-deploy-policy.example.json` 的更新内容同步到 `AWS_DEPLOY_ROLE_ARN` 对应的角色。策略需要允许 CloudFormation 管理 SNS、SQS、Synthetics、CloudWatch Alarm、Lambda Version/Alias 和 CodeDeploy。

在 GitHub repository variables 中配置：

```text
ENABLE_SYNTHETICS=true
SYNTHETICS_CANARY_NAME=gh-profile-api-dev
SYNTHETICS_SCHEDULE_EXPRESSION=rate(1 minute)
SYNTHETICS_RUNTIME_VERSION=syn-nodejs-puppeteer-16.1
```

收集完作业截图后，把 `SYNTHETICS_SCHEDULE_EXPRESSION` 改回 `rate(5 minutes)`。

Synthetics 结果桶设置了 `DeletionPolicy: Retain`，避免删除 Stack 时因桶内已有运行结果而失败。彻底清理作业资源时，需要在确认不再需要截图和 HAR 文件后手工清空并删除该结果桶。

API Lambda 位于 VPC 内并且需要访问 GitHub 与 SNS。如果当前 Lambda 子网没有 NAT，请设置：

```text
ENABLE_MANAGED_VPC_NETWORKING=true
```

这会创建 NAT Gateway，会产生持续费用。也可以自行提供已有的私有子网/NAT 方案。

## 本地校验

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check-types
pnpm build
sam validate --lint --template-file infra/sam/template.yaml
sam build --template-file infra/sam/template.yaml
```

## 部署和灰度验证

第一次部署创建基线版本和 `live` Alias。第二次有代码或配置变化的部署才适合观察 10% 到 100% 的流量切换。

从 CloudFormation 取得 API URL：

```bash
STACK_NAME=github-profile-sam-dev
AWS_REGION=us-east-2
API_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)
curl --fail --silent "$API_URL/health"
```

`/health` 会返回 GitHub commit SHA，便于区分旧版本和新版本：

```json
{
  "status": "ok",
  "service": "github-profile-sam",
  "version": "<github-sha>"
}
```

第二次部署期间，在 CodeDeploy 控制台记录 10% 新版本、90% 旧版本的截图；完成后记录新版本 100% 的截图。也可以在 CloudWatch Lambda Metrics 中按 `ExecutedVersion` 查看两个版本的调用量。

## SNS/SQS 正常消息验证

从 CloudFormation 输出取得 Topic ARN：

```bash
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ProfileEventsTopicArn'].OutputValue" \
  --output text)
```

正常使用页面拉取并保存一个 GitHub Profile。Profile 数据和 Outbox 事件会原子提交；一分钟内，`profile-event-outbox-publisher` 会把事件发布到 SNS。也可以直接发布一条符合结构的测试消息：

```bash
aws sns publish \
  --region "$AWS_REGION" \
  --topic-arn "$TOPIC_ARN" \
  --message '{"specVersion":"1.0","eventId":"70d7f9d8-c3c1-4d1b-b67e-bfcf1f8511bc","eventType":"profile.updated","occurredAt":"2026-07-21T01:02:03.000Z","idempotencyKey":"456:2026-07-21T01:02:03Z","profile":{"githubId":"456","login":"event-user","name":"Event User","htmlUrl":"https://github.com/event-user","publicRepos":4,"followers":5,"following":6,"githubUpdatedAt":"2026-07-21T01:02:03Z"}}'
```

在 `/aws/lambda/github-profile-sam-dev-profile-event-outbox-publisher` 中可以检查 Publisher 执行结果，在 `/aws/lambda/github-profile-sam-dev-profile-event-worker` 中应看到 `Processed profile event`。

## DLQ 验证

发布非法消息：

```bash
aws sns publish \
  --region "$AWS_REGION" \
  --topic-arn "$TOPIC_ARN" \
  --message '{"eventType":"invalid.assignment.test"}'
```

Worker 会返回该消息的 `batchItemFailures`。消息在可见性超时后重试，接收次数达到队列配置的上限后进入 `github-profile-sam-dev-profile-events-dlq`。记录以下证据：

- Worker 的三次结构校验失败日志。
- 主队列最终没有该消息。
- DLQ 的 `ApproximateNumberOfMessagesVisible` 大于零。
- DLQ 中保存着原始非法消息。

## Synthetics 验证

启用后，CloudWatch Synthetics 中会出现 `gh-profile-api-dev`。脚本检查：

- HTTP 状态码是 `200`。
- `status` 是 `ok`。
- `service` 是 `github-profile-sam`。
- 响应包含非空 `version`。

记录连续成功运行、Step duration、`SuccessPercent=100` 以及 `Synthetics-Alarm-gh-profile-api-dev-1` 为 `OK` 的截图。需要演示失败时，可以临时在控制台执行一个指向不存在路径的副本 Canary，不必破坏生产 Canary 或 API。

## 关键文件

- `apps/server/src/app.ts`：保存 Profile 后发布事件，并在健康响应中返回发布版本。
- `apps/server/src/profile-events.ts`：事件契约、脱敏字段和幂等键。
- `apps/server/src/profile-event-outbox-publisher.ts`：认领已提交 Outbox 记录、发布 SNS，并记录成功或失败。
- `apps/server/src/profile-event-worker.ts`：SQS 消费、校验和部分批次失败响应。
- `apps/server/src/api-metrics.ts`：使用 CloudWatch Embedded Metric Format 记录可触发灰度回滚的 API 5xx。
- `infra/sam/template.yaml`：SNS、SQS、DLQ、Worker、Synthetics、Alarm、Alias 和 CodeDeploy。
- `.github/workflows/deploy.yml`：把 GitHub SHA 和作业配置传入 SAM。
