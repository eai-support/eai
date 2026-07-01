# Stage 050 eai-cli Adopt Observed Evidence

- Command: `./scripts/verify-stage050-adopt-observed.sh`
- Fixture: `tests/fixtures/stage050/adopt-observed.json`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown registration, observed deployment metadata payload, destructive operations blocked until managed redeploy.
- Negative assertions: invalid repository slug rejection, invalid observed URL rejection, wrong tenant validation failure before adoption, no Admin Portal generated-source export invocation.
- Result: passed
