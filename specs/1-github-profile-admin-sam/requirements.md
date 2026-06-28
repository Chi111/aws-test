# Requirements: GitHub Profile Admin SAM MVP

## Goal
Build a small backend admin system that can be run locally and deployed with SAM.

## Acceptance Criteria
- Three seeded roles exist: admin, operator, viewer.
- Login uses internal demo accounts and an httpOnly session cookie.
- Different roles see different navigation and pages.
- Admin and operator can fetch a GitHub profile with a personal token.
- The GitHub token is never stored and is not logged.
- Saved GitHub profiles can have custom key-value fields added and deleted.
- Viewer can inspect saved profiles and fields but cannot write.
- Drizzle owns the minimum PostgreSQL schema.
- SAM deploys the Hono Lambda into existing VPC private subnets and points at an existing Aurora PostgreSQL database.
