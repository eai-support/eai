# Traceability

| Requirement | Planned implementation | Owned evidence |
| --- | --- | --- |
| DTE-009, DTE-014 | `src/commands/eai-managed-deploy.ts`, GitHub link/client identity | CLI integration and source-client tests |
| DTE-016 | `src/lib/eai-managed-source.ts` | `tests/unit/eai-managed-source.test.ts` |
| DTE-018 | `src/lib/eai-managed-deploy.ts` | `tests/unit/eai-managed-deploy.test.ts` |
| DTE-019–DTE-021, DTE-088 | embedded workflow/collector and candidate pin manifest | linked-source/release metadata and deploy integration tests |
| DTE-031–DTE-035 | dispatch state and exact retry/resume validation | managed deploy unit/integration tests |
| DTE-091 | managed API/browser origin allowlists and redirect rejection | source-client and deploy integration tests |
| DTE-036, DTE-061, DTE-080 | `eai deploy doctor` operation binding and evidence output | deploy doctor/help/describe tests |
| DTE-086, DTE-087 | current-main merge and exact-head checks | build, lint, `test:eai-cli:ci`, release preflight |
