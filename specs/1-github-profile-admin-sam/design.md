# Design: GitHub Profile Admin SAM MVP

## Architecture
- `apps/web`: React/Vite admin UI from better-t-stack.
- `apps/server`: Hono API for auth, RBAC, GitHub profile fetch, field CRUD, Node dev server, and Lambda handler.
- `packages/db`: Drizzle schema and migration commands for PostgreSQL.
- `infra`: SAM template and sample parameters for existing VPC/Aurora.

## Data Model
- `admin_users`: seeded demo users with role and password hash.
- `github_profiles`: non-sensitive GitHub account snapshot.
- `github_profile_fields`: custom fields linked to a saved GitHub profile.

## Security Defaults
- GitHub token is accepted only in the profile fetch request body and is not persisted.
- Session is an httpOnly JWT cookie.
- Backend enforces role permissions; frontend only mirrors them for UX.

## Deployment
SAM does not create Aurora. It accepts VPC, private subnet, security group, database URL, and JWT secret parameters for a dev deployment.

For the MVP baseline, Lambda can keep using existing subnets. For a more complete cloud architecture, `EnableManagedVpcNetworking=true` lets SAM add one public subnet, two private Lambda subnets, a NAT Gateway, and route tables inside the existing VPC. The API and setup Lambda then use the managed private subnets automatically.

Database setup runs through a VPC-internal Lambda function after `sam deploy`, so GitHub-hosted runners do not need direct network access to RDS.
