# Protect existing storage during type seed

A published Object Type can already use a dedicated PostgreSQL table label with a different prefix from the runtime workspace's current naming rule. Reprovisioning or renaming that binding can affect existing records.

## Draft behavior

- Resolve the exact app enrollment and runtime workspace before evaluating tenant-specific names.
- For a manifest declaring ready, dedicated `tenant-postgres` storage, read the runtime workspace's storage status once. If an affected type already has a different prefix, report its slug and ask for ownership verification.
- Preview and seed stop the entire batch on this finding. An incomplete workspace response stops the check. A new dedicated definition still requires the runtime prefix.
- A server binding conflict on save or publish stops the command. Keep the binding provided in the manifest and surface the conflict without a direct write or provisioning retry.

## Qualification

Permission to publish an additive change requires a server decision backed by the exact published definition and enrollment. Storage readiness alone cannot establish ownership.

## Verification

`npm test -- tests/integration/types.test.ts tests/unit/type-seed-preflight.test.ts`
