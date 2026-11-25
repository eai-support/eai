# Protect existing storage during type seed

An inherited SQL label can refer to records in the child's dedicated database. Use the published binding for updates and the runtime prefix for new definitions.

- AC-1. Read the exact app, owner and runtime workspace and check provisioning before saving or publishing. Conflicting readiness or an incomplete catalog blocks a seed.
- AC-2. For an inherited binding, preview the whole manifest through regional PublicAPI. Match each child ID, revision and grant to its bound, ready enrollment. Dry-run performs no schema or record writes. A missing grant or changed binding stops the batch.
- AC-3. A verified grant covers added optional fields and dropdown choices. Preserve existing choices and legacy relationships. After publication, `types diff` reports a field whose type or required flag differs. Ordinary legacy publications still require their existing exclusive claim. Direct CRUD fallback cannot publish an inherited type.

Run `npm test -- tests/integration/types.test.ts tests/unit/type-seed-preflight.test.ts`.
