# Go Profile Introduction Service

This service is the first container workload in the project. It is intentionally small and read-only: it looks up an existing row in `github_profiles` and turns the public profile fields into a deterministic Chinese introduction.

## Runtime contract

| Item | Value |
| --- | --- |
| Port | `8080` by default |
| Liveness | `GET /healthz` |
| Readiness | `GET /readyz` |
| Business API | `GET /api/v1/introductions/{username}` |
| Database | Existing PostgreSQL `github_profiles` table |

The process can start while PostgreSQL is unavailable. In that state `/healthz` remains `200` and `/readyz` returns `503`. This distinction lets ECS keep the process running while ALB stops routing business traffic to an unready task.

## Local commands

Copy `.env.example` values into your shell, then run:

```bash
cd apps/go-server
go test ./...
go test -race ./...
go vet ./...
go run ./cmd/api
```

Check the black-box contract:

```bash
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/readyz
curl -i http://localhost:8080/api/v1/introductions/octocat
```

The introduction endpoint returns `404` until the requested profile already exists in `github_profiles`. The existing Node API remains responsible for fetching and saving GitHub profiles.

## Container commands

Build from the repository root so Docker can copy the Go module and the RDS CA bundle:

```bash
docker build -f apps/go-server/Dockerfile -t github-profile-go:dev .
```

Run without placing secrets in the image:

```bash
docker run --rm \
  -p 8080:8080 \
  -e DATABASE_URL="$DATABASE_URL" \
  github-profile-go:dev
```

For Aurora, set `DATABASE_SSL_CA_PATH=/etc/ssl/certs/aws-rds-global-bundle.pem`. The service then enables TLS 1.2+, verifies the server hostname, and trusts the bundled AWS RDS certificates.

## Architecture boundary

- Node continues to own authentication, GitHub token handling, writes, and migrations.
- Go only reads public profile fields in this first increment.
- `DATABASE_URL` is runtime configuration. It must later come from Secrets Manager, never from the Docker image.
- `/readyz` is the future ALB health-check path.
- The container runs as the distroless `nonroot` user.

