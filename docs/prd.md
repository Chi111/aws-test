# PRD: GitHub Profile Admin SAM MVP

## Goal
Build a small backend admin system that demonstrates frontend, backend, database, permissions, and AWS SAM deployment in one project.

## Users
- `admin`: can access all MVP pages and write actions.
- `operator`: can fetch GitHub profiles and manage custom fields.
- `viewer`: can only inspect saved GitHub profiles and fields.

## Core Requirements
- Scaffold the project with better-t-stack using React/Vite, Hono, Drizzle, PostgreSQL, TypeScript, and pnpm.
- Provide an internal demo login, not GitHub OAuth.
- Show different pages and actions for different roles.
- Fetch GitHub account information from a personal token through the backend.
- Never store or log the GitHub token.
- Store only the non-sensitive GitHub profile snapshot.
- Let write roles add and delete custom key-value fields for a saved GitHub profile.
- Use Drizzle for the minimum PostgreSQL schema.
- Deploy the Hono API with SAM into existing VPC private subnets and connect to an existing Aurora PostgreSQL Serverless v2 database.
- Include a GitHub Actions OIDC deployment workflow.

## MVP Scope
- Login page
- Dashboard
- GitHub Profiles page
- Custom Fields page
- Access information page for admin
- Hono auth/profile/field APIs
- Drizzle schema, migration, and seed script
- SAM template and example config
- GitHub Actions workflow template

## Out Of Scope
- GitHub OAuth
- User management UI
- RDS Proxy
- CloudFront custom domain
- WAF
- Multi-environment deployment
- Complex audit logs
- Automatic rollback
- Cost alarm automation

## Acceptance Criteria
- `admin`, `operator`, and `viewer` seeded accounts can log in.
- `admin` and `operator` can fetch a GitHub profile and add/delete fields.
- `viewer` can read saved data but receives a backend `403` on write actions.
- GitHub token is only used in memory for the GitHub `/user` request.
- Tests cover login, write denial, and GitHub profile save.
- Typecheck and build pass.
- SAM template is present for dev deployment with existing VPC/Aurora parameters.

## Related Specs
- `specs/1-github-profile-admin-sam/requirements.md`
- `specs/1-github-profile-admin-sam/design.md`
- `specs/1-github-profile-admin-sam/tasks.md`
