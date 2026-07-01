#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT_DIR/tests/fixtures/stage050/workflow-setup.json"
ARTIFACT_DIR="${STAGE050_ARTIFACT_DIR:-$ROOT_DIR/.stage050-artifacts}"
ARTIFACT="$ARTIFACT_DIR/eai-cli-workflow-setup.md"

cd "$ROOT_DIR"

node - "$FIXTURE" <<'NODE'
const fs = require('fs');
const fixturePath = process.argv[2];
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expected = {
  stage: 'stage050',
  contract: 'source-unknown-workflow-setup',
  sourceMode: 'source-unknown',
  environment: 'preview',
};
for (const [key, value] of Object.entries(expected)) {
  if (fixture[key] !== value) {
    throw new Error(`Fixture ${key} expected ${value}, got ${fixture[key]}`);
  }
}
if (!fixture.tenantId || !fixture.appKey) {
  throw new Error('Fixture tenantId and appKey are required.');
}
if (!fixture.workflowPath || !fixture.ref || !fixture.configHash) {
  throw new Error('Fixture workflowPath, ref, and configHash are required.');
}
if (!fixture.operationBinding?.operationId || !fixture.operationBinding?.nonce) {
  throw new Error('Fixture operationBinding operationId and nonce are required.');
}
if (!String(fixture.operationBinding.storedNonce || '').startsWith('sha256:')) {
  throw new Error('Fixture operationBinding storedNonce must describe a sha256 hash.');
}
if (!Array.isArray(fixture.positiveAssertions) || fixture.positiveAssertions.length < 4) {
  throw new Error('Fixture must include positive workflow-setup assertions.');
}
if (!Array.isArray(fixture.negativeAssertions) || fixture.negativeAssertions.length < 4) {
  throw new Error('Fixture must include negative workflow-setup assertions.');
}
if (!Array.isArray(fixture.evidenceTests) || fixture.evidenceTests.length < 2) {
  throw new Error('Fixture must include the Stage 050 evidence test list.');
}
NODE

npx vitest run tests/integration/platform-api-client.test.ts tests/integration/vertical.test.ts

mkdir -p "$ARTIFACT_DIR"
cat > "$ARTIFACT" <<EOF
# Stage 050 eai-cli Workflow Setup Evidence

- Command: \`./scripts/verify-stage050-workflow-setup.sh\`
- Fixture: \`tests/fixtures/stage050/workflow-setup.json\`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown workflow setup request, environment/workflow/ref/commit/config-hash payload, operation ID and one-time nonce response, server-side nonce hash storage expectation.
- Negative assertions: empty app key rejection, empty environment rejection, wrong tenant validation failure before setup, no Admin Portal generated-source export invocation, no live-smoke nonce issuance by default.
- Result: passed
EOF

echo "Wrote $ARTIFACT"
