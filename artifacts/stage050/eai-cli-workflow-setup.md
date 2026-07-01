# Stage 050 eai-cli Workflow Setup Evidence

- Command: `./scripts/verify-stage050-workflow-setup.sh`
- Fixture: `tests/fixtures/stage050/workflow-setup.json`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown workflow setup request, environment/workflow/ref/commit/config-hash payload, operation ID and one-time nonce response, server-side nonce hash storage expectation.
- Negative assertions: empty app key rejection, empty environment rejection, wrong tenant validation failure before setup, no Admin Portal generated-source export invocation, no live-smoke nonce issuance by default.
- Result: passed
