# Traceability

Requirements are defined by the [Issue #3503 hardening amendment](https://github.com/enterpriseaigroup/Issues2025/issues/3503#issuecomment-5826177803).

| Requirement | Planned implementation | Owned evidence |
| --- | --- | --- |
| DTE-009–DTE-011, DTE-014 | `src/commands/eai-managed-deploy.ts`, explicit target tenant, exact GitHub link session/client identity | CLI integration and source-client tests |
| DTE-016 | bounded publication in `src/lib/eai-managed-source.ts` and bounded no-follow workflow-evidence ingestion in `src/lib/source-unknown-evidence-file.ts` | managed-source unit and workflow-evidence integration tests |
| DTE-018, DTE-095 | no-follow source-manifest `configHash` in the focused managed-deploy modules and both source submissions, with exact generated-output exclusions, ancestor-link rejection, and nonregular-entry rejection shared by the collector | managed deploy/source unit and integration tests |
| DTE-019–DTE-021, DTE-088 | embedded workflow/collector, canonical-path candidate pin manifest, and canonical remote tag-to-commit verification | linked-source/release metadata and deploy integration tests |
| DTE-031–DTE-035 | dispatch state, exact retry/resume validation, and complete unified-operation source revision binding | managed deploy unit/integration tests |
| DTE-091 | managed API client-boundary and browser origin allowlists plus redirect rejection | API client, source-client, and deploy integration tests |
| DTE-036, DTE-061, DTE-080 | `eai deploy doctor` operation binding, canonical declared-secret readiness probe, no-link evidence output, and exact unified-operation deployment/doctor success binding | deploy doctor/runtime/help/describe, operation classifier, and filesystem tests |
| DTE-086, DTE-087 | current-main merge, focused managed deployment module boundaries under 300 lines, and exact-head checks | build, lint, `test:eai-cli:ci`, release preflight |
