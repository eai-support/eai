# Protect existing storage during type seed

A published Object Type can already use a dedicated PostgreSQL table label with a different prefix from the runtime workspace's current naming rule. Reprovisioning or renaming that binding can affect existing records.

## Draft behavior

- Resolve the exact app enrollment and runtime workspace before evaluating tenant-specific names.
- Read the matching definitions from the regional runtime catalog by name or slug. Compare complete bounded results across two scans per batch. If a published, ready, dedicated `tenant-postgres` definition uses a different prefix, report its slug and ask for ownership verification. Apply the same check when the proposed backend changes.
- Preview and seed stop the entire batch on this finding. An incomplete workspace response stops the check. A new dedicated definition still requires the runtime prefix.
- A server binding conflict on save, compatibility retry or publish stops the command. Any eligible direct-write fallback repeats the catalog check before its first write.
- Online seed and diff can carry forward a relationship without a declared target only when the entire field matches a unique published definition in the runtime catalog. This case requires manifest publication. Standalone validation and new or changed relationships require an explicit target.
- Seed checks the existing app's exclusive runtime ownership and definition IDs before carrying those fields forward. A current-prefix dedicated table cannot be renamed. Diff reports changes to existing select choices.

## Qualification

Permission to publish an additive change requires a server decision backed by the exact published definition and enrollment. Storage readiness alone cannot establish ownership.

## Verification

`npm test -- tests/integration/types.test.ts tests/unit/type-seed-preflight.test.ts`
