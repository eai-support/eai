---
id: "cli-tenant-types-workflow"
title: "Feature Spec: CLI Tenant and Types Workflow"
status: "draft"
created: "2026-04-04"
updated: "2026-04-04"
priority: "medium"
assignee: "engineer-agent"
---

# Feature Spec: CLI Tenant and Types Workflow

## Summary

Harden the CLI tenant and object-type workflow so it matches the platform's tenant semantics and provides clear guidance when tenant configuration is missing.

## User Stories

### US1: Tenant-admin tenant listing

As a CLI user, I want `eai tenant list` to show only tenants where I am a tenant admin so that the command reflects the tenants I can actively administer.

#### Acceptance Criteria

1. The command filters out inactive tenants.
2. The command accepts tenant-admin membership from `isTenantAdmin`, `roles`, or `roleAssignments`.
3. If no tenant-admin memberships exist, the command explains that the authenticated tenant context is not the same as tenant-admin access.

### US2: Predictable tenant resolution for object types

As a CLI user, I want `eai types seed` and `eai types diff` to resolve tenant IDs predictably so that I do not seed or diff the wrong Configurator tenant.

#### Acceptance Criteria

1. `TENANT_<KEY>_ID` is preferred for matching tenant keys.
2. `--tenant-key` and `--tenant-id` can be used for explicit overrides.
3. `TENANT_DEFAULT_ID` is only used for conventional default scopes (`template` / `default`).
4. Non-default scopes without an explicit mapping produce actionable guidance instead of silently using a generic default tenant.
5. Local-only object types appear in `types diff`.

### US3: Clear workflow guidance

As a CLI user, I want the docs and command help to explain the object type workflow and tenant prerequisites so that I can seed and verify object types without reverse-engineering the CLI behavior.

#### Acceptance Criteria

1. Docs explain the `TENANT_<KEY>_ID` convention.
2. Docs explain when `TENANT_DEFAULT_ID` and authenticated tenant fallback are used.
3. Docs describe the validate → diff → seed → resources schema workflow.
