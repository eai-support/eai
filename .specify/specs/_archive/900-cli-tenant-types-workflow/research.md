# Research: CLI Tenant and Types Workflow

## Scope

Validate and review the `eai` fixes for:

- tenant-admin-only tenant listing
- tenant-key to tenant-ID resolution for `types seed` / `types diff`
- clearer object type workflow guidance

## External Alignment References

### `eai-council-roi-dash`

- `src/app/api/eai/config/route.ts`
  - runtime tenant config is keyed by `TENANT_KEYS`
  - each tenant key resolves through `TENANT_<KEY>_ID`
  - no generic multi-scope fallback exists for arbitrary tenant keys
- `src/lib/platform/seed-object-types.ts`
  - seeding uses the resolved Configurator tenant record ID
  - requests are routed through PublicAPI orchestrate to `payload:/object-types`

### `com.enterpriseaigroup`

- `src/lib/signup/eai-admin.ts`
  - tenant-admin detection accepts either `isTenantAdmin` or `roles.includes('tenant-admin')`
- `src/lib/account/useActiveTenant.ts`
  - account data may expose `roles` and `isTenantAdmin`
- `src/lib/auth/ciam-auth.ts`
  - active tenant context is part of auth/session resolution and is valid as a single-tenant fallback

### `MigrateDaisy`

- migration docs show deeper Configurator membership modeling through `roleAssignments`
- this means CLI compatibility should tolerate `roleAssignments` as well as simplified `roles` / `isTenantAdmin`

## Implementation Guidance

1. `tenant list` should be explicit about being a tenant-admin view, not a dump of all authenticated memberships.
2. `types seed` and `types diff` must prefer `TENANT_<KEY>_ID`.
3. `TENANT_DEFAULT_ID` is safe only for conventional default scopes such as `template` / `default`.
4. Non-default scopes should require either `TENANT_<KEY>_ID` or `--tenant-id`.
5. Docs should state the workflow and prerequisite resolution rules directly.

## Files In Scope

- `src/commands/tenant.ts`
- `src/commands/types.ts`
- `tests/integration/tenant.test.ts`
- `tests/integration/types.test.ts`
- `docs/src/content/docs/reference/commands/tenant.mdx`
- `docs/src/content/docs/reference/commands/types.mdx`
- `docs/src/content/docs/reference/environment-vars.mdx`
- `docs/src/content/docs/guides/multi-tenant.mdx`
- `docs/src/content/docs/guides/object-types.mdx`

## Risks To Validate

1. Silent fallback to the wrong tenant for non-default scopes.
2. Tenant-admin detection missing one of the known membership shapes.
3. Docs drifting away from actual CLI resolution behavior.
