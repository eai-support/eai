#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT_DIR/tests/fixtures/stage050/connect-existing.json"
ARTIFACT_DIR="$ROOT_DIR/artifacts/stage050"
ARTIFACT="$ARTIFACT_DIR/eai-cli-connect-existing.md"

cd "$ROOT_DIR"

node - "$FIXTURE" <<'NODE'
const fs = require('fs');
const fixturePath = process.argv[2];
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expected = {
  stage: 'stage050',
  contract: 'source-unknown-connect-existing',
  sourceMode: 'source-unknown',
};
for (const [key, value] of Object.entries(expected)) {
  if (fixture[key] !== value) {
    throw new Error(`Fixture ${key} expected ${value}, got ${fixture[key]}`);
  }
}
if (!fixture.tenantId || !fixture.appKey) {
  throw new Error('Fixture tenantId and appKey are required.');
}
if (!fixture.repository?.owner || !fixture.repository?.name) {
  throw new Error('Fixture repository owner and name are required.');
}
if (!fixture.repository?.workflowPath || !fixture.repository?.ref) {
  throw new Error('Fixture repository workflowPath and ref are required.');
}
if (!fixture.configPath || !fixture.runtimePath) {
  throw new Error('Fixture configPath and runtimePath are required.');
}
if (!Array.isArray(fixture.positiveAssertions) || fixture.positiveAssertions.length < 4) {
  throw new Error('Fixture must include positive connect-existing assertions.');
}
if (!Array.isArray(fixture.negativeAssertions) || fixture.negativeAssertions.length < 4) {
  throw new Error('Fixture must include negative connect-existing assertions.');
}
if (!Array.isArray(fixture.evidenceTests) || fixture.evidenceTests.length < 2) {
  throw new Error('Fixture must include the Stage 050 evidence test list.');
}
NODE

npx vitest run tests/integration/platform-api-client.test.ts tests/integration/vertical.test.ts

mkdir -p "$ARTIFACT_DIR"
cat > "$ARTIFACT" <<EOF
# Stage 050 eai-cli Connect Existing Evidence

- Command: \`./scripts/verify-stage050-connect-existing.sh\`
- Fixture: \`tests/fixtures/stage050/connect-existing.json\`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown registration, config/runtime path payload, source-unknown mode without generated-source ownership.
- Negative assertions: invalid repository slug rejection, empty branch rejection, wrong tenant validation failure before registration, no Admin Portal generated-source export invocation.
- Result: passed
EOF

echo "Wrote $ARTIFACT"
