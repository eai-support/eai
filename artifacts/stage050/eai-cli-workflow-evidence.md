# Stage 050 eai-cli Workflow Evidence

- Command: `./scripts/verify-stage050-workflow-evidence.sh`
- Fixture: `tests/fixtures/stage050/workflow-evidence.json`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown workflow evidence request with GitHub OIDC bearer auth, operation/nonce/config-hash payload, artifact/image digest payload, OIDC claim metadata payload, setup operation consumption expectation.
- Negative assertions: empty app key rejection, missing operation/nonce rejection, invalid digest rejection, wrong tenant validation failure before evidence submission, no live-smoke nonce consumption by default.
- Result: passed
