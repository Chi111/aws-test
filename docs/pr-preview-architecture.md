# PR 独立预览环境

这套方案的目标不是让每个 PR 复制一整套昂贵的基础设施，而是共享入口、隔离运行单元：

- 常驻资源：一个 ALB、一个 ECS 集群。
- 每个 PR：一个 Fargate 服务、任务定义、目标组、ALB 主机名规则、安全组和日志组。
- PR 打开或更新：构建镜像并创建/更新 `github-profile-pr-<编号>`。
- PR 关闭或合并：删除对应 CloudFormation 栈。
- Cloudflare：Worker Static Assets 承载前端；每个 PR 上传一个不切换生产流量的 Worker Version，使用
  `pr-<编号>-github-profile-sam-chi111.<子域>.workers.dev` 预览。

```mermaid
flowchart LR
  PR["GitHub PR"] -->|"OIDC 临时凭证"| Trigger["触发角色"]
  Trigger -->|"只允许 StartBuild"| CB["CodeBuild 角色"]
  CB -->|"构建并推送"| ECR["ECR"]
  CB -->|"AssumeRole"| Deploy["部署角色"]
  Deploy --> CFN["CloudFormation"]
  CFN --> Base["共享 ALB + ECS 集群"]
  CFN --> Preview["PR 专属 Fargate 服务"]
  PR --> CF["Cloudflare Worker 前端预览"]
  Base --> Preview
```

## Cloudflare Worker 前端预览

Cloudflare 不需要自定义域名。生产前端使用 `github-profile-sam-chi111.<子域>.workers.dev`，PR 前端使用
Worker Preview URL。仓库需要以下配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 仅允许上传 Worker 版本 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 指定部署账户 |
| Variable | `CLOUDFLARE_WORKER_NAME` | `github-profile-sam-chi111` |

前端构建和 Cloudflare 上传被拆成两个 GitHub Actions Job。PR 代码所在的 Job 不接收 Token，只上传静态构建
产物；第二个 Job 从可信 `main` 分支读取 [Wrangler 配置](../apps/web/wrangler.jsonc)，下载静态产物后才注入
Token。这样 PR 构建脚本无法读取 Cloudflare 凭证。Fork PR 不运行 Cloudflare 部署。

当前 Worker 预览前端使用仓库变量 `VITE_SERVER_URL` 指向共享 AWS API。PR 专属 Go 服务仍通过共享 ALB 的
Host Header 单独验收；若要实现前端到 PR 后端的完全隔离，后续应为每个 PR 提供可由浏览器直接访问的 HTTPS
API URL。

## 三个 IAM 角色为什么分开

| 角色 | 能做什么 | 不能做什么 |
| --- | --- | --- |
| `github-profile-pr-trigger-role` | GitHub OIDC 登录；启动并查询指定 CodeBuild 项目 | 不能推镜像、不能创建 ECS |
| `github-profile-codebuild-role` | 写构建日志、推送指定 ECR、承担部署角色 | 不能直接管理整个 AWS 账户 |
| `github-profile-pr-deploy-role` | 创建和删除预览所需的 CloudFormation/ECS/ALB/安全组/日志资源 | 不能创建 IAM 角色；只能 Pass 现有 ECS 执行角色 |

GitHub 和 CodeBuild 都不保存长期 Access Key。所有权限都是短期凭证。

## CodeBuild 配额为 0 时的执行器切换

新 AWS 账户可能暂时无法启动任何 CodeBuild 构建。此时设置 GitHub 仓库变量
`PR_EXECUTOR=github-actions`，工作流会保留相同的三角色权限链，只把执行计算从 CodeBuild 容器切换到
GitHub 托管 Runner：

```mermaid
flowchart LR
  PR["GitHub PR"] -->|"OIDC"| Trigger["触发角色"]
  Trigger -->|"AssumeRole"| Build["CodeBuild 角色（构建权限边界）"]
  Build --> ECR["ECR"]
  Build -->|"AssumeRole"| Deploy["部署角色"]
  Deploy --> CFN["CloudFormation"]
```

`github-profile-codebuild-role` 在这里仍代表“构建权限边界”，只是暂时不由 CodeBuild 服务承担计算。
AWS 放开配额后，将 `PR_EXECUTOR` 改成 `codebuild` 即可切回原路径。

手动配置三项 IAM：

1. 将 `github-profile-pr-trigger-role` 的信任关系更新为
   [触发角色回退信任策略](../infra/iam/pr-trigger-fallback-trust-policy.example.json)，只允许本仓库 PR 和 `main`。
2. 将 [触发角色回退权限](../infra/iam/pr-trigger-fallback-policy.example.json) 添加到
   `github-profile-pr-trigger-role`。
3. 将 `github-profile-codebuild-role` 的信任关系更新为
   [构建角色回退信任策略](../infra/iam/codebuild-fallback-trust-policy.example.json)。它同时信任 CodeBuild 服务和
   唯一的触发角色，不直接信任任意 GitHub 工作流。

没有 Cloudflare 域名时，将 `PREVIEW_DOMAIN` 设置成 `preview.local`。它不是公共 DNS；工作流会在摘要中生成
带 Host Header 的验证命令：

```bash
curl -H 'Host: pr-<编号>.preview.local' http://<共享ALB域名>/healthz
```

首次使用 GitHub Actions 回退路线：

1. Actions → `PR preview shared base` → 保持 Branch 为 `main`，选择 `deploy`，创建共享 ALB 和 ECS 集群。
2. 创建同仓库分支的 PR，`PR preview environment` 自动构建镜像并创建 PR Stack。
3. 使用工作流摘要中的 `curl` 命令验收。
4. 关闭 PR，等待 PR Stack 自动删除。
5. Actions → `PR preview shared base` → 选择 `destroy`，停止共享 ALB 费用。

删除共享 Base Stack 前必须先关闭所有预览 PR，否则 CloudFormation 导出仍被 PR Stack 引用，删除会失败。

## CodeBuild 手动配置

在创建项目之前，先把 [部署权限示例](../infra/iam/pr-deploy-policy.example.json) 作为内联策略添加到
`github-profile-pr-deploy-role`。

创建 CodeBuild 项目时填写：

| 项目 | 值 |
| --- | --- |
| 项目名 | `github-profile-pr-environment` |
| Source | `No source` |
| Buildspec | 选择内联，并复制 [buildspec.pr.yml](../buildspec.pr.yml) 全部内容 |
| Environment image | 最新的 AWS CodeBuild Ubuntu Standard 托管镜像 |
| Compute | Small |
| Privileged | 开启，Docker 构建需要 |
| Service role | 使用现有 `github-profile-codebuild-role` |
| Timeout | 60 分钟 |
| CloudWatch log group | `/aws/codebuild/github-profile-pr-environment` |
| Artifacts | 无 |
| Webhook | 不开启；由 GitHub Actions 显式启动 |

环境变量：

| 名称 | 值 |
| --- | --- |
| `REPOSITORY_URL` | `https://github.com/Chi111/aws-test.git` |
| `CONTROL_PLANE_REF` | `main` |
| `PR_ACTION` | `deploy-base`（GitHub Actions 会覆盖成 `deploy` 或 `destroy`） |
| `DEPLOY_ROLE_ARN` | `arn:aws:iam::311816466050:role/github-profile-pr-deploy-role` |
| `ECR_REPOSITORY_URI` | `311816466050.dkr.ecr.us-east-2.amazonaws.com/github-profile-go` |
| `AWS_REGION` | `us-east-2` |
| `VPC_ID` | `vpc-0b653a19dd83dfa79` |
| `PUBLIC_SUBNET_IDS` | `subnet-0f1075ff3eaba752e,subnet-0afbf279c7e89bd2d,subnet-0af83aebdf25ab627` |
| `ECS_TASK_EXECUTION_ROLE_ARN` | `arn:aws:iam::311816466050:role/service-role/ecsTaskExecutionRole` |
| `PREVIEW_DOMAIN` | 例如 `preview.example.com`，后续换成你的 Cloudflare 域名 |

不要把密码、数据库连接串或 Cloudflare API Token 放进普通环境变量。本阶段的 PR 服务使用不可连接的占位数据库地址，
`/healthz` 可验证容器和 ALB，依赖数据库的接口不会伪装成可用。

## 首次运行顺序

1. 把本次代码合并到 `main`，因为 CodeBuild 只从可信主分支读取部署代码。
2. 手动启动一次 CodeBuild，保留 `PR_ACTION=deploy-base`，创建共享 ALB 和 ECS 集群。
3. 从 CloudFormation 输出复制 `LoadBalancerDNSName`。
4. 在 Cloudflare 建立 `*.preview` 的 CNAME，目标是该 ALB DNS。
5. 在 GitHub 仓库变量中配置 `PREVIEW_DOMAIN` 和 `AWS_REGION=us-east-2`。
6. 创建测试 PR；Actions 成功后访问 `http://pr-<编号>.<PREVIEW_DOMAIN>/healthz`。
7. 关闭 PR，确认 `github-profile-pr-<编号>` CloudFormation 栈被删除。

## 成本与后续增强

- 共享 ALB 持续计费；每个打开的 PR 额外产生一个 0.25 vCPU / 512 MiB Fargate 任务。
- 为 ECR 增加生命周期规则，自动删除 7 天以上的 `pr-` 镜像。
- 当前 Fargate 使用公有子网和公网 IP，以避免 NAT Gateway 的固定费用；安全组只允许 ALB 访问 8080。
- 正式环境应改为私有子网，并使用 NAT 或 VPC Endpoint。
- 当前 ALB 原点是 HTTP。学习链路跑通后再增加 ACM 证书和 HTTPS Listener。
