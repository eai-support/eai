---
id: "901-cli-platform-alignment"
title: "Feature Spec: CLI Platform Alignment"
status: "implemented"
created: "2026-04-04"
updated: "2026-04-04"
priority: "high"
assignee: "engineer-agent"
---

# Feature Spec: CLI Platform Alignment

## Summary

Bring `eai-cli` into line with the current AdminAPI/PublicAPI/application patterns so tenant-aware CLI operations behave like the working app stack and Gofer artifacts no longer point at stale tenant-env assumptions.

## User Stories

### US1: Login-driven tenant context

As a CLI user, I want platform commands to resolve the working tenant from my login and selected tenant context so that I do not need `.env.local` tenant IDs for day-to-day CLI operations.

#### Acceptance Criteria

1. Tenant-aware commands use the active tenant selected from the current login context.
2. No command requires `.env.local` tenant IDs to determine the active working tenant.
3. When multiple tenant-admin memberships exist, the CLI requires an explicit selection.

### US2: Admin-aligned membership and user flows

As a CLI user, I want membership lookup and existing-user provisioning to use the current backend contracts so that the CLI works against the same APIs as the main application.

#### Acceptance Criteria

1. Tenant memberships are resolved through the AdminAPI memberships route exposed through PublicAPI orchestration.
2. Existing-user lookup by email uses the AdminAPI user lookup route.
3. Existing-user add-to-tenant uses the AdminAPI provision route.
4. Self-provisioning remains on the PublicAPI self-provision route.

### US3: Contract verification reflects the live platform shape

As a CLI maintainer, I want `eai verify calls` to check the same route contracts the CLI now depends on so that compatibility issues show up in the right place.

#### Acceptance Criteria

1. Contract audit labels and expectations match admin-backed membership and user lookup routes.
2. Tests cover the admin membership payload shape and direct user lookup shape.
3. Build, lint, and test pass after the contract updates.

### US4: Gofer artifact hygiene

As a maintainer, I want completed historical feature folders archived and active feature folders merged so that Gofer shows a clean, current picture of the repo.

#### Acceptance Criteria

1. Completed feature folders are moved under `.specify/specs/_archive/`.
2. Duplicate or stale tenant/type/auth/help folders are no longer active.
3. One current merged feature folder remains to describe the present codebase and platform alignment state.
