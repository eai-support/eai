#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT_DIR/tests/fixtures/stage050/workflow-evidence.json"
ARTIFACT_DIR="$ROOT_DIR/artifacts/stage050"
ARTIFACT="$ARTIFACT_DIR/eai-cli-workflow-evidence.md"

cd "$ROOT_DIR"

node - "$FIXTURE" <<'NODE'
const fs = require('fs');
const fixturePath = process.argv[2];
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expected = {
  stage: 'stage050',
  contract: 'source-unknown-workflow-evidence',
  sourceMode: 'source-unknown',
  environment: 'preview',
};
for (const [key, value] of Object.entries(expected)) {
  if (fixture[key] !== value) {
    throw new Error(`Fixture ${key} expected ${value}, got ${fixture[key]}`);
  }
}
if (!fixture.tenantId || !fixture.appKey || !fixture.operationId) {
  throw new Error('Fixture tenantId, appKey, and operationId are required.');
}
if (!fixture.workflowPath || !fixture.ref || !fixture.configHash) {
  throw new Error('Fixture workflowPath, ref, and configHash are required.');
}
for (const field of ['artifactDigest', 'imageDigest']) {
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(fixture[field] || '')) {
    throw new Error(`Fixture ${field} must be a sha256:<64 hex chars> digest.`);
  }
}
if (!fixture.oidcClaims?.repository || !fixture.oidcClaims?.ref || !fixture.oidcClaims?.sha) {
  throw new Error('Fixture oidcClaims repository, ref, and sha are required.');
}
if (!Array.isArray(fixture.positiveAssertions) || fixture.positiveAssertions.length < 4) {
  throw new Error('Fixture must include positive workflow-evidence assertions.');
}
if (!Array.isArray(fixture.negativeAssertions) || fixture.negativeAssertions.length < 4) {
  throw new Error('Fixture must include negative workflow-evidence assertions.');
}
if (!Array.isArray(fixture.evidenceTests) || fixture.evidenceTests.length < 2) {
  throw new Error('Fixture must include the Stage 050 evidence test list.');
}
NODE

npx vitest run tests/integration/platform-api-client.test.ts tests/integration/vertical.test.ts

mkdir -p "$ARTIFACT_DIR"
cat > "$ARTIFACT" <<EOF
# Stage 050 eai-cli Workflow Evidence

- Command: \`./scripts/verify-stage050-workflow-evidence.sh\`
- Fixture: \`tests/fixtures/stage050/workflow-evidence.json\`
- Positive assertions: tenant app enrollment validation, PublicAPI source-unknown workflow evidence request, operation/nonce/config-hash payload, artifact/image digest payload, OIDC claim metadata payload, setup operation consumption expectation.
- Negative assertions: empty app key rejection, missing operation/nonce rejection, invalid digest rejection, wrong tenant validation failure before evidence submission, no live-smoke nonce consumption by default.
- Result: passed
EOF

echo "Wrote $ARTIFACT"
