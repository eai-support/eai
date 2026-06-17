#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROFILE="${EAI_SMOKE_PROFILE:-dev}"
EAI_CLI_BIN="${EAI_CLI_BIN:-eai}"
SMOKE_ID="${EAI_SMOKE_ID:-$(date -u +%Y%m%d%H%M%S)}"
OUTPUT_ROOT="${EAI_SMOKE_OUTPUT_ROOT:-$CLI_ROOT/.smoke/resourceapi-schema-sync-lifecycle}"
RUN_DIR="$OUTPUT_ROOT/$SMOKE_ID"
PROJECT_DIR="$RUN_DIR/project"
PARENT_TENANT_ID="${EAI_SMOKE_PARENT_TENANT_ID:-}"
EXISTING_VERTICAL_KEY="${EAI_SMOKE_EXISTING_VERTICAL_KEY:-codex-resourceapi-smoke}"
NEW_TENANT_KEY="codex-new-tenant-new-vertical-$SMOKE_ID"
NEW_VERTICAL_KEY="codex-existing-tenant-new-vertical-$SMOKE_ID"
NEW_TENANT_ID=""

FAILURES=()
PASSED=()

usage() {
  cat <<'EOF'
Smoke ResourceAPI schema sync for tenant/app lifecycle and storage backends.

Scenarios:
  1. New tenant + new vertical, DocumentDB-only Object Type.
  2. Existing tenant + new vertical, PostgreSQL-only Object Type.
  3. Existing tenant + existing vertical, mixed DocumentDB + PostgreSQL Object Types.

Environment knobs:
  EAI_CLI_BIN                         CLI executable. Default: eai
  EAI_SMOKE_PROFILE                   CLI profile. Default: dev
  EAI_SMOKE_PARENT_TENANT_ID          Existing tenant to use. Default: active CLI tenant
  EAI_SMOKE_EXISTING_VERTICAL_KEY     Existing app key for scenario 3. Default: codex-resourceapi-smoke
  EAI_SMOKE_ID                        Stable ID. Reuse to test update/idempotency. Default: UTC timestamp
  EAI_SMOKE_OUTPUT_ROOT               Output root. Default: .smoke/resourceapi-schema-sync-lifecycle
  EAI_SMOKE_SKIP_NEW_TENANT=1         Skip scenario 1.
  EAI_SMOKE_SKIP_EXISTING_NEW=1       Skip scenario 2.
  EAI_SMOKE_SKIP_EXISTING_EXISTING=1  Skip scenario 3.
  EAI_SMOKE_ALLOW_FAILURES=1          Always exit 0, but still report failures.

Examples:
  npm run smoke:resourceapi-lifecycle
  EAI_CLI_BIN=/opt/homebrew/bin/eai EAI_SMOKE_PROFILE=dev npm run smoke:resourceapi-lifecycle
  EAI_SMOKE_ID=20260617 npm run smoke:resourceapi-lifecycle
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

mkdir -p "$RUN_DIR" "$PROJECT_DIR/src/eai.config"

log() {
  printf '[smoke] %s\n' "$*"
}

record_failure() {
  local scenario="$1"
  local message="$2"
  FAILURES+=("$scenario: $message")
  printf '[smoke][fail] %s: %s\n' "$scenario" "$message" >&2
}

record_pass() {
  local scenario="$1"
  local message="$2"
  PASSED+=("$scenario: $message")
  printf '[smoke][pass] %s: %s\n' "$scenario" "$message"
}

json_read() {
  local file="$1"
  local expression="$2"
  node - "$file" "$expression" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const expression = process.argv[3];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(2);
}
let value;
try {
  value = Function('data', `return (${expression});`)(data);
} catch {
  process.exit(3);
}
if (value === undefined || value === null) process.exit(4);
if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
else process.stdout.write(String(value));
NODE
}

json_check() {
  local file="$1"
  local expression="$2"
  node - "$file" "$expression" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const expression = process.argv[3];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(2);
}
let ok = false;
try {
  ok = Boolean(Function('data', `return (${expression});`)(data));
} catch {
  ok = false;
}
process.exit(ok ? 0 : 1);
NODE
}

run_capture() {
  local scenario="$1"
  local name="$2"
  shift 2
  local dir="$RUN_DIR/$scenario"
  mkdir -p "$dir"
  local stdout_file="$dir/$name.stdout"
  local stderr_file="$dir/$name.stderr"
  local meta_file="$dir/$name.meta.json"

  log "$scenario :: $name"
  set +e
  "$@" >"$stdout_file" 2>"$stderr_file"
  local status=$?
  set -e

  node - "$meta_file" "$status" "$stdout_file" "$stderr_file" "$*" <<'NODE'
const fs = require('node:fs');
const [file, status, stdoutFile, stderrFile, command] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  status: Number(status),
  command,
  stdoutFile,
  stderrFile,
  timestamp: new Date().toISOString(),
}, null, 2)}\n`);
NODE
  return "$status"
}

run_required() {
  local scenario="$1"
  local name="$2"
  shift 2
  if ! run_capture "$scenario" "$name" "$@"; then
    record_failure "$scenario" "$name failed; see $RUN_DIR/$scenario/$name.stderr"
    return 1
  fi
  return 0
}

resolve_parent_tenant() {
  if [[ -n "$PARENT_TENANT_ID" ]]; then
    return 0
  fi

  local scenario="setup"
  run_required "$scenario" "tenant-list" "$EAI_CLI_BIN" --profile "$PROFILE" tenant list --format json || return 1
  PARENT_TENANT_ID="$(json_read "$RUN_DIR/$scenario/tenant-list.stdout" \
    "(data.tenants || data.docs || data.resources || []).find((tenant) => tenant.active)?.id || (data.tenants || data.docs || data.resources || [])[0]?.id || (data.tenants || data.docs || data.resources || [])[0]?.data?.id" \
    || true)"
  if [[ -z "$PARENT_TENANT_ID" ]]; then
    record_failure "$scenario" "could not resolve active parent tenant; set EAI_SMOKE_PARENT_TENANT_ID"
    return 1
  fi
}

write_project_config() {
  cat > "$PROJECT_DIR/.env.local" <<EOF
NEXT_PUBLIC_APP_NAME=resourceapi-schema-sync-smoke
EAI_VERTICAL_KEY=$EXISTING_VERTICAL_KEY
EOF

  local suffix="${SMOKE_ID//[^a-zA-Z0-9]/}"
  local pg_table="codex_pg_${suffix}"
  local doc_collection="codex_doc_${suffix}"

  cat > "$PROJECT_DIR/src/eai.config/object-types.ts" <<EOF
export const objectTypes = {
  '$NEW_TENANT_KEY': [
    {
      name: 'CodexNewTenantDocumentDb$suffix',
      displayName: 'Codex New Tenant DocumentDB $suffix',
      description: 'Smoke test: new tenant + new vertical + DocumentDB-only ResourceAPI schema sync.',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: '${doc_collection}_new_tenant',
          partitionKey: 'tenantId',
        },
      },
    },
  ],
  '$NEW_VERTICAL_KEY': [
    {
      name: 'CodexExistingTenantPostgresql$suffix',
      displayName: 'Codex Existing Tenant PostgreSQL $suffix',
      description: 'Smoke test: existing tenant + new vertical + PostgreSQL-only ResourceAPI schema sync.',
      status: 'published',
      storageBackend: 'postgresql',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-database',
          schemaName: 'resources',
          tableName: '${pg_table}_new_vertical',
        },
      },
    },
  ],
  '$EXISTING_VERTICAL_KEY': [
    {
      name: 'CodexExistingVerticalPostgresql$suffix',
      displayName: 'Codex Existing Vertical PostgreSQL $suffix',
      description: 'Smoke test: existing tenant + existing vertical + PostgreSQL ResourceAPI schema sync.',
      status: 'published',
      storageBackend: 'postgresql',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-database',
          schemaName: 'resources',
          tableName: '${pg_table}_existing_vertical',
        },
      },
    },
    {
      name: 'CodexExistingVerticalDocumentDb$suffix',
      displayName: 'Codex Existing Vertical DocumentDB $suffix',
      description: 'Smoke test: existing tenant + existing vertical + DocumentDB ResourceAPI schema sync.',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: '${doc_collection}_existing_vertical',
          partitionKey: 'tenantId',
        },
      },
    },
  ],
}
EOF
}

ensure_vertical_exists() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  local name="$4"

  run_capture "$scenario" "vertical-create-$key" \
    "$EAI_CLI_BIN" --profile "$PROFILE" vertical create "$name" \
      --tenant-id "$tenant_id" \
      --key "$key" \
      --template eai-app-template \
      --source smoke-resourceapi-schema-sync \
      --format json
  local status=$?
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi
  if grep -Eiq '409|conflict|already|duplicate|exists' "$RUN_DIR/$scenario/vertical-create-$key.stderr" "$RUN_DIR/$scenario/vertical-create-$key.stdout"; then
    log "$scenario :: app $key already exists; continuing"
    return 0
  fi
  record_failure "$scenario" "vertical create failed for $key"
  return 1
}

provision_vertical_storage() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  run_required "$scenario" "vertical-provision-$key" \
    "$EAI_CLI_BIN" --profile "$PROFILE" vertical provision "$key" \
      --tenant-id "$tenant_id" \
      --backend all \
      --format json
}

run_app_provisioning_job() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  run_required "$scenario" "app-provisioning-job-$key" \
    "$EAI_CLI_BIN" --profile "$PROFILE" publicapi post "/v4/platform/tenants/$tenant_id/apps/$key/provisioning-jobs" \
      --tenant-id "$tenant_id" \
      --data '{}' \
      --format json
}

app_enrollment_is_ready() {
  local file="$1"
  json_check "$file" \
    "(() => { const docs = data.resources || data.docs || data.body?.docs || []; const item = docs[0] || {}; const record = item.data || item; const metadata = record.metadata || {}; return record.provisioningState === 'ready' || record.readiness?.ready === true || record.readiness?.status === 'ready' || metadata.appProvisioning?.status === 'ready' || metadata.resourceApiSchemaSync?.status === 'synced'; })()"
}

ensure_app_provisioning_ready() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  local precheck="app-provisioning-precheck-$key"

  run_capture "$scenario" "$precheck" \
    "$EAI_CLI_BIN" --profile "$PROFILE" resources list tenant-vertical-enrollment \
      --tenant-id "$tenant_id" \
      --where "{\"verticalKey\":{\"equals\":\"$key\"}}" \
      --limit 5 \
      --format json >/dev/null

  if app_enrollment_is_ready "$RUN_DIR/$scenario/$precheck.stdout"; then
    log "$scenario :: app $key already has ready resources; skipping provisioning job"
    return 0
  fi

  run_app_provisioning_job "$scenario" "$tenant_id" "$key"
}

seed_types() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  run_required "$scenario" "types-seed-$key" \
    "$EAI_CLI_BIN" --profile "$PROFILE" types seed \
      --tenant-key "$key" \
      --tenant-id "$tenant_id" \
      --format json
}

wait_for_sync() {
  local scenario="$1"
  local tenant_id="$2"
  local key="$3"
  local attempt=1
  local status=""
  while [[ "$attempt" -le 30 ]]; do
    run_capture "$scenario" "enrollment-$key-$attempt" \
      "$EAI_CLI_BIN" --profile "$PROFILE" resources list tenant-vertical-enrollment \
        --tenant-id "$tenant_id" \
        --where "{\"verticalKey\":{\"equals\":\"$key\"}}" \
        --limit 5 \
        --format json >/dev/null
    status="$(json_read "$RUN_DIR/$scenario/enrollment-$key-$attempt.stdout" \
      "(() => { const docs = data.resources || data.docs || data.body?.docs || []; const item = docs[0] || {}; const record = item.data || item; return record.metadata?.resourceApiSchemaSync?.status || record.resourceApiSchemaSync?.status || ''; })()" \
      || true)"
    if [[ "$status" == "synced" ]]; then
      return 0
    fi
    if [[ "$status" == "failed" ]]; then
      break
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  record_failure "$scenario" "ResourceAPI schema sync for $key did not reach synced (last status: ${status:-unknown})"
  return 1
}

verify_schema_contains() {
  local scenario="$1"
  local tenant_id="$2"
  shift 2
  local names=("$@")

  run_required "$scenario" "resources-schema" "$EAI_CLI_BIN" --profile "$PROFILE" resources schema --tenant-id "$tenant_id" --format json || return 1
  local missing=()
  for name in "${names[@]}"; do
    if ! json_check "$RUN_DIR/$scenario/resources-schema.stdout" \
      "(data.objectTypes || data.body?.objectTypes || []).some((type) => type.name === '$name' || type.slug === '$name')"; then
      missing+=("$name")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    record_failure "$scenario" "resources schema missing: ${missing[*]}"
    return 1
  fi
}

create_and_delete_resource() {
  local scenario="$1"
  local tenant_id="$2"
  local type_name="$3"
  local payload="{\"title\":\"$scenario $type_name\",\"status\":\"draft\"}"

  run_required "$scenario" "resource-create-$type_name" \
    "$EAI_CLI_BIN" --profile "$PROFILE" resources create "$type_name" \
      --tenant-id "$tenant_id" \
      --format json \
      --data "$payload" || return 1

  local resource_id
  resource_id="$(json_read "$RUN_DIR/$scenario/resource-create-$type_name.stdout" "data.id || data.resource?.id || data.body?.id" || true)"
  if [[ -z "$resource_id" ]]; then
    record_failure "$scenario" "could not read created resource id for $type_name"
    return 1
  fi

  run_required "$scenario" "resource-delete-$type_name" \
    "$EAI_CLI_BIN" --profile "$PROFILE" resources delete "$type_name" "$resource_id" \
      --tenant-id "$tenant_id" \
      --force \
      --format json || return 1
}

scenario_new_tenant_new_vertical() {
  local scenario="new-tenant-new-vertical-documentdb"
  [[ "${EAI_SMOKE_SKIP_NEW_TENANT:-}" == "1" ]] && { log "$scenario :: skipped"; return 0; }

  run_required "$scenario" "tenant-create" \
    "$EAI_CLI_BIN" --profile "$PROFILE" tenant create \
      --name "Codex Lifecycle Smoke $SMOKE_ID" \
      --slug "codex-lifecycle-$SMOKE_ID" \
      --parent "$PARENT_TENANT_ID" \
      --usecase generic \
      --industry generic \
      --starter-template eai-app-template \
      --format json || return 1

  NEW_TENANT_ID="$(json_read "$RUN_DIR/$scenario/tenant-create.stdout" \
    "data.tenant?.doc?.id || data.tenant?.id || data.doc?.id || data.id || data.status?.tenantId" \
    || true)"
  if [[ -z "$NEW_TENANT_ID" ]]; then
    record_failure "$scenario" "could not resolve created tenant id"
    return 1
  fi

  ensure_vertical_exists "$scenario" "$NEW_TENANT_ID" "$NEW_TENANT_KEY" "Codex New Tenant Smoke" || return 1
  provision_vertical_storage "$scenario" "$NEW_TENANT_ID" "$NEW_TENANT_KEY" || return 1
  ensure_app_provisioning_ready "$scenario" "$NEW_TENANT_ID" "$NEW_TENANT_KEY" || return 1
  seed_types "$scenario" "$NEW_TENANT_ID" "$NEW_TENANT_KEY" || return 1
  wait_for_sync "$scenario" "$NEW_TENANT_ID" "$NEW_TENANT_KEY" || return 1

  local type_name="CodexNewTenantDocumentDb${SMOKE_ID//[^a-zA-Z0-9]/}"
  verify_schema_contains "$scenario" "$NEW_TENANT_ID" "$type_name" || return 1
  create_and_delete_resource "$scenario" "$NEW_TENANT_ID" "$type_name" || return 1
  record_pass "$scenario" "DocumentDB-only lifecycle synced and accepted create/delete"
}

scenario_existing_tenant_new_vertical() {
  local scenario="existing-tenant-new-vertical-postgresql"
  [[ "${EAI_SMOKE_SKIP_EXISTING_NEW:-}" == "1" ]] && { log "$scenario :: skipped"; return 0; }

  ensure_vertical_exists "$scenario" "$PARENT_TENANT_ID" "$NEW_VERTICAL_KEY" "Codex Existing Tenant Smoke" || return 1
  provision_vertical_storage "$scenario" "$PARENT_TENANT_ID" "$NEW_VERTICAL_KEY" || return 1
  ensure_app_provisioning_ready "$scenario" "$PARENT_TENANT_ID" "$NEW_VERTICAL_KEY" || return 1
  seed_types "$scenario" "$PARENT_TENANT_ID" "$NEW_VERTICAL_KEY" || return 1
  wait_for_sync "$scenario" "$PARENT_TENANT_ID" "$NEW_VERTICAL_KEY" || return 1

  local type_name="CodexExistingTenantPostgresql${SMOKE_ID//[^a-zA-Z0-9]/}"
  verify_schema_contains "$scenario" "$PARENT_TENANT_ID" "$type_name" || return 1
  create_and_delete_resource "$scenario" "$PARENT_TENANT_ID" "$type_name" || return 1
  record_pass "$scenario" "PostgreSQL-only lifecycle synced and accepted create/delete"
}

scenario_existing_tenant_existing_vertical() {
  local scenario="existing-tenant-existing-vertical-mixed"
  [[ "${EAI_SMOKE_SKIP_EXISTING_EXISTING:-}" == "1" ]] && { log "$scenario :: skipped"; return 0; }

  ensure_vertical_exists "$scenario" "$PARENT_TENANT_ID" "$EXISTING_VERTICAL_KEY" "Codex Existing Vertical Smoke" || return 1
  provision_vertical_storage "$scenario" "$PARENT_TENANT_ID" "$EXISTING_VERTICAL_KEY" || return 1
  ensure_app_provisioning_ready "$scenario" "$PARENT_TENANT_ID" "$EXISTING_VERTICAL_KEY" || return 1
  seed_types "$scenario" "$PARENT_TENANT_ID" "$EXISTING_VERTICAL_KEY" || return 1
  wait_for_sync "$scenario" "$PARENT_TENANT_ID" "$EXISTING_VERTICAL_KEY" || return 1

  local suffix="${SMOKE_ID//[^a-zA-Z0-9]/}"
  local pg_type="CodexExistingVerticalPostgresql$suffix"
  local doc_type="CodexExistingVerticalDocumentDb$suffix"
  verify_schema_contains "$scenario" "$PARENT_TENANT_ID" "$pg_type" "$doc_type" || return 1
  create_and_delete_resource "$scenario" "$PARENT_TENANT_ID" "$pg_type" || return 1
  create_and_delete_resource "$scenario" "$PARENT_TENANT_ID" "$doc_type" || return 1
  record_pass "$scenario" "mixed PostgreSQL+DocumentDB lifecycle synced and accepted create/delete"
}

main() {
  log "profile: $PROFILE"
  log "cli: $EAI_CLI_BIN"
  log "run dir: $RUN_DIR"

  resolve_parent_tenant || true
  if [[ -z "$PARENT_TENANT_ID" ]]; then
    record_failure "setup" "missing parent tenant"
  else
    log "parent tenant: $PARENT_TENANT_ID"
  fi

  write_project_config
  cd "$PROJECT_DIR" || exit 1
  run_required "setup" "types-validate" "$EAI_CLI_BIN" --profile "$PROFILE" types validate || true

  if [[ "${#FAILURES[@]}" -eq 0 ]]; then
    scenario_new_tenant_new_vertical || true
    scenario_existing_tenant_new_vertical || true
    scenario_existing_tenant_existing_vertical || true
  fi

  {
    echo "ResourceAPI schema sync lifecycle smoke"
    echo "Run ID: $SMOKE_ID"
    echo "Profile: $PROFILE"
    echo "Parent tenant: ${PARENT_TENANT_ID:-unresolved}"
    echo "Existing vertical: $EXISTING_VERTICAL_KEY"
    echo "Output: $RUN_DIR"
    echo
    echo "Passed:"
    if [[ "${#PASSED[@]}" -eq 0 ]]; then
      echo "  none"
    else
      printf '  - %s\n' "${PASSED[@]}"
    fi
    echo
    echo "Failures:"
    if [[ "${#FAILURES[@]}" -eq 0 ]]; then
      echo "  none"
    else
      printf '  - %s\n' "${FAILURES[@]}"
    fi
  } | tee "$RUN_DIR/summary.txt"

  if [[ "${#FAILURES[@]}" -gt 0 && "${EAI_SMOKE_ALLOW_FAILURES:-}" != "1" ]]; then
    exit 1
  fi
}

main "$@"
