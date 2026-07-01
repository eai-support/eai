# Stage 050 eai-cli Connect Existing Evidence

- Command: `./scripts/verify-stage050-connect-existing.sh`
- Fixture: `tests/fixtures/stage050/connect-existing.json`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown registration, config/runtime path payload, source-unknown mode without generated-source ownership, schema/validator provenance payload.
- Negative assertions: invalid repository slug rejection, empty branch rejection, wrong tenant validation failure before registration, no Admin Portal generated-source export invocation, incomplete schema provenance rejection.
- Result: passed
