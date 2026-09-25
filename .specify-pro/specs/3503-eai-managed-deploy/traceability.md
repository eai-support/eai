# Traceability

Requirements are defined by the [Issue #3503 hardening amendment](https://github.com/enterpriseaigroup/Issues2025/issues/3503#issuecomment-5826177803).

| Requirement | Planned implementation | Owned evidence |
| --- | --- | --- |
| DTE-009–DTE-011, DTE-014 | `src/commands/eai-managed-deploy.ts`, explicit target tenant, GitHub link/client identity | CLI integration and source-client tests |
| DTE-016 | `src/lib/eai-managed-source.ts` | `tests/unit/eai-managed-source.test.ts` |
| DTE-018, DTE-095 | no-follow source-manifest `configHash` in `src/lib/eai-managed-deploy.ts` and both source submissions, with exact generated-output exclusions shared by the collector | managed deploy/source unit and integration tests |
| DTE-019–DTE-021, DTE-088 | embedded workflow/collector and candidate pin manifest | linked-source/release metadata and deploy integration tests |
| DTE-031–DTE-035 | dispatch state and exact retry/resume validation | managed deploy unit/integration tests |
| DTE-091 | managed API/browser origin allowlists and redirect rejection | source-client and deploy integration tests |
| DTE-036, DTE-061, DTE-080 | `eai deploy doctor` operation binding, declared-secret authenticated readiness, and evidence output | deploy doctor/help/describe tests |
| DTE-086, DTE-087 | current-main merge and exact-head checks | build, lint, `test:eai-cli:ci`, release preflight |
