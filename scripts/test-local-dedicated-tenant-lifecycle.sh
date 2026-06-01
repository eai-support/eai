#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$CLI_ROOT/.." && pwd)"
PROFILE="${EAI_E2E_PROFILE:-local}"
PUBLIC_API_URL="${EAI_E2E_PUBLIC_API_URL:-http://localhost:8000}"
TIMESTAMP="$(date +%s)"
RANDOM_SUFFIX="$(node -e "process.stdout.write(Math.random().toString(36).slice(2, 8))")"
TENANT_NAME="e2e-local-${TIMESTAMP}-${RANDOM_SUFFIX}"
TENANT_SLUG="$TENANT_NAME"
TENANT_KEY="local-e2e"
TENANT_ID=""
PROJECT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/eai-local-e2e.XXXXXX")"
PG_ID=""
DOCDB_ID=""
BLOB_ID=""
SEARCH_ID=""
TENANT_CREATE_STDERR=""

ensure_local_search_key_loaded() {
  local current_key=""
  current_key="$(docker exec eai-resourceapi /bin/sh -c 'printenv SEARCH_DEFAULT_API_KEY' 2>/dev/null || true)"
  if [[ -n "$current_key" ]]; then
    return 0
  fi

  if ! command -v az >/dev/null 2>&1; then
    echo "Azure CLI is required to load the local Search admin key for ResourceAPI." >&2
    return 1
  fi

  if [[ -z "${EAI_E2E_SEARCH_SERVICE_NAME:-}" || -z "${EAI_E2E_SEARCH_RESOURCE_GROUP:-}" ]]; then
    echo "Set EAI_E2E_SEARCH_SERVICE_NAME and EAI_E2E_SEARCH_RESOURCE_GROUP to load a Search admin key." >&2
    return 1
  fi

  local search_key=""
  search_key="$(az search admin-key show \
    --service-name "$EAI_E2E_SEARCH_SERVICE_NAME" \
    --resource-group "$EAI_E2E_SEARCH_RESOURCE_GROUP" \
    --query primaryKey \
    -o tsv 2>/dev/null || true)"

  if [[ -z "$search_key" ]]; then
    echo "Could not resolve the local Search admin key." >&2
    return 1
  fi

  export RESOURCES_API_SEARCH_DEFAULT_API_KEY="$search_key"
  (cd "$WORKSPACE_ROOT" && docker compose up -d --force-recreate resourceapi >/dev/null)

  local ready=0
  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:8003/health >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [[ "$ready" -ne 1 ]]; then
    echo "ResourceAPI did not become ready after reloading the Search key." >&2
    return 1
  fi
}

cleanup_storage() {
  if [[ -z "$TENANT_ID" ]]; then
    return 0
  fi

  local tenant_compact="${TENANT_ID//-/}"
  local tenant_db="tenant_${tenant_compact}"
  local mongo_db="tenant-${tenant_compact}"

  docker exec eai-postgres psql -U postgres -d resources -c "DELETE FROM tenant_connections WHERE tenant_id = '${TENANT_ID}';" >/dev/null 2>&1 || true
  docker exec eai-postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${tenant_db};" >/dev/null 2>&1 || true
  docker exec eai-mongodb mongosh --quiet --eval "db.getSiblingDB('${mongo_db}').dropDatabase();" >/dev/null 2>&1 || true

  docker exec eai-resourceapi python - <<PY >/dev/null 2>&1 || true
import asyncio
from azure.storage.blob.aio import BlobServiceClient

AZURITE_ACCOUNT_KEY = ''.join([
    'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSR',
    'Z6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==',
])
CONNECTION = (
    'DefaultEndpointsProtocol=http;'
    'AccountName=devstoreaccount1;'
    f'AccountKey={AZURITE_ACCOUNT_KEY};'
    'BlobEndpoint=http://azurite:10000/devstoreaccount1'
)
TENANT_ID='${TENANT_ID}'
PREFIX=f"tenant/{TENANT_ID}/"

async def main():
    client = BlobServiceClient.from_connection_string(CONNECTION)
    try:
        await client.delete_container(TENANT_ID)
    except Exception:
        pass
    try:
        container = client.get_container_client("tenant-files")
        async for blob in container.list_blobs(name_starts_with=PREFIX):
            await container.delete_blob(blob.name, delete_snapshots="include")
    except Exception:
        pass
    await client.close()

asyncio.run(main())
PY
}

cleanup_prior_test_tenants() {
  local tenants_json
  tenants_json="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"
  node -e '
    const data = JSON.parse(process.argv[1]);
    const parentId = process.argv[2];
    const ids = (data.tenants || [])
      .filter((tenant) => tenant.id !== parentId)
      .map((tenant) => tenant.id);
    process.stdout.write(ids.join("\n"));
  ' "$tenants_json" "$PARENT_TENANT_ID" | while IFS= read -r tenant_id; do
    [[ -z "$tenant_id" ]] && continue
    node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant delete "$tenant_id" --force --format json >/dev/null 2>&1 || true
    local tenant_compact="${tenant_id//-/}"
    docker exec eai-postgres psql -U postgres -d resources -c "DELETE FROM tenant_connections WHERE tenant_id = '${tenant_id}';" >/dev/null 2>&1 || true
    docker exec eai-postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS tenant_${tenant_compact};" >/dev/null 2>&1 || true
    docker exec eai-mongodb mongosh --quiet --eval "db.getSiblingDB('tenant-${tenant_compact}').dropDatabase();" >/dev/null 2>&1 || true
  done
}

cleanup() {
  set +e

  if [[ -n "$TENANT_ID" ]]; then
    node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant select "$PARENT_TENANT_ID" >/dev/null 2>&1 || true

    if [[ -n "$PG_ID" ]]; then
      node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantPgNote "$PG_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null 2>&1 || true
    fi
    if [[ -n "$DOCDB_ID" ]]; then
      node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantDocumentNote "$DOCDB_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null 2>&1 || true
    fi
    if [[ -n "$BLOB_ID" ]]; then
      node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantBlobNote "$BLOB_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null 2>&1 || true
    fi
    if [[ -n "$SEARCH_ID" ]]; then
      node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantSearchNote "$SEARCH_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null 2>&1 || true
    fi

    node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant delete "$TENANT_ID" --force --format json >/dev/null 2>&1 || true
    cleanup_storage
  fi

  rm -f "$TENANT_CREATE_STDERR"
  rm -rf "$PROJECT_DIR"
}

trap cleanup EXIT

json_field() {
  local json="$1"
  local expression="$2"
  node -e "const data = JSON.parse(process.argv[1]); const value = (${expression}); if (value === undefined || value === null) process.exit(2); if (typeof value === 'object') console.log(JSON.stringify(value)); else console.log(String(value));" "$json"
}

assert_json() {
  local json="$1"
  local expression="$2"
  local message="$3"
  node -e "const data = JSON.parse(process.argv[1]); if (!(${expression})) { console.error(process.argv[2]); process.exit(1); }" "$json" "$message"
}

retry_search() {
  local query="$1"
  local attempt=1
  while [[ $attempt -le 10 ]]; do
    local output
    output="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources search "$query" --tenant-id "$TENANT_ID" --types TenantSearchNote --mode fulltext --format json)"
    if node -e "const data = JSON.parse(process.argv[1]); process.exit((data.results || []).length > 0 ? 0 : 1);" "$output"; then
      printf '%s' "$output"
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

wait_for_published_object_types() {
  local attempts="${1:-60}"
  local delay_secs="${2:-2}"
  local output=""

  for _ in $(seq 1 "$attempts"); do
    output="$(node - "$TENANT_ID" "$PROFILE" "$PUBLIC_API_URL" "$CLI_ROOT" <<'NODE'
const tenantId = process.argv[2];
const profileName = process.argv[3];
const publicApiUrl = process.argv[4];
const cliRoot = process.argv[5];
(async () => {
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const distUrl = (file) => pathToFileURL(join(cliRoot, 'dist/lib', file)).href;
  const profile = await import(distUrl('profile.js'));
  profile.setActiveProfile(profileName);
  const { getAccessToken } = await import(distUrl('auth.js'));
  const token = await getAccessToken();
  const url = new URL(`${publicApiUrl}/v4/data/resources/object-types`);
  url.searchParams.set('where[tenant][equals]', tenantId);
  url.searchParams.set('where[status][equals]', 'published');
  url.searchParams.set('limit', '20');
  url.searchParams.set('depth', '0');
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
    },
  });
  process.stdout.write(await response.text());
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
)"
    if node -e '
      const data = JSON.parse(process.argv[1]);
      const names = new Set((data.docs || []).map((item) => item.name));
      const required = ["TenantPgNote", "TenantDocumentNote", "TenantBlobNote", "TenantSearchNote"];
      process.exit(required.every((name) => names.has(name)) ? 0 : 1);
    ' "$output"; then
      printf '%s' "$output"
      return 0
    fi
    sleep "$delay_secs"
  done

  printf '%s' "$output"
  return 1
}

wait_for_schema_types() {
  local attempts="${1:-60}"
  local delay_secs="${2:-2}"
  local output=""

  for _ in $(seq 1 "$attempts"); do
    output="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources schema --tenant-id "$TENANT_ID" --format json)"
    if node -e '
      const data = JSON.parse(process.argv[1]);
      const names = new Set((data.objectTypes || []).map((item) => item.name));
      const required = ["TenantPgNote", "TenantDocumentNote", "TenantBlobNote", "TenantSearchNote"];
      process.exit(required.every((name) => names.has(name)) ? 0 : 1);
    ' "$output"; then
      printf '%s' "$output"
      return 0
    fi
    sleep "$delay_secs"
  done

  printf '%s' "$output"
  return 1
}

create_test_tenant() {
  local create_json=""
  local before_tenants_json=""
  local after_tenants_json=""
  TENANT_CREATE_STDERR="$(mktemp "${TMPDIR:-/tmp}/eai-local-e2e-tenant-create.XXXXXX")"
  before_tenants_json="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"

  set +e
  node "$CLI_ROOT/dist/index.js" \
    --profile "$PROFILE" \
    tenant create \
    --name "$TENANT_NAME" \
    --slug "$TENANT_SLUG" \
    --parent "$PARENT_TENANT_ID" \
    --format text > /dev/null 2>"$TENANT_CREATE_STDERR"
  local create_exit=$?
  set -e

  if [[ $create_exit -eq 0 ]]; then
    after_tenants_json="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"
    create_json="$(node -e '
      const beforeData = JSON.parse(process.argv[1]);
      const afterData = JSON.parse(process.argv[2]);
      const slug = process.argv[3];
      const beforeIds = new Set((beforeData.tenants || []).map((tenant) => tenant.id));
      const created =
        (afterData.tenants || []).find((tenant) => tenant.slug === slug)
        || (afterData.tenants || []).find((tenant) => !beforeIds.has(tenant.id));
      if (!created) process.exit(1);
      process.stdout.write(JSON.stringify({ tenant: created }));
    ' "$before_tenants_json" "$after_tenants_json" "$TENANT_SLUG")"
    if [[ -n "$create_json" ]]; then
      printf '%s' "$create_json"
      return 0
    fi
  fi

  if grep -Eq 'TENANT_QUOTA_EXCEEDED|CHILD_TENANT_LIMIT|quota|child-tenant limit' "$TENANT_CREATE_STDERR"; then
    cleanup_prior_test_tenants
    before_tenants_json="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"
    set +e
    node "$CLI_ROOT/dist/index.js" \
      --profile "$PROFILE" \
      tenant create \
      --name "$TENANT_NAME" \
      --slug "$TENANT_SLUG" \
      --parent "$PARENT_TENANT_ID" \
      --format text > /dev/null 2>>"$TENANT_CREATE_STDERR"
    create_exit=$?
    set -e
    if [[ $create_exit -eq 0 ]]; then
      after_tenants_json="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"
      create_json="$(node -e '
        const beforeData = JSON.parse(process.argv[1]);
        const afterData = JSON.parse(process.argv[2]);
        const slug = process.argv[3];
        const beforeIds = new Set((beforeData.tenants || []).map((tenant) => tenant.id));
        const created =
          (afterData.tenants || []).find((tenant) => tenant.slug === slug)
          || (afterData.tenants || []).find((tenant) => !beforeIds.has(tenant.id));
        if (!created) process.exit(1);
        process.stdout.write(JSON.stringify({ tenant: created }));
      ' "$before_tenants_json" "$after_tenants_json" "$TENANT_SLUG")"
      if [[ -n "$create_json" ]]; then
        printf '%s' "$create_json"
        return 0
      fi
    fi
  fi

  if [[ $create_exit -eq 0 ]]; then
    echo "Tenant create completed but the new tenant could not be resolved from tenant list." >&2
    return 1
  fi

  cat "$TENANT_CREATE_STDERR" >&2 || true
  return 1
}

cd "$CLI_ROOT"
npm run build >/dev/null
ensure_local_search_key_loaded

PARENT_TENANT_ID="${EAI_E2E_PARENT_TENANT_ID:-}"
if [[ -z "$PARENT_TENANT_ID" ]]; then
  TENANT_LIST_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant list --format json)"
  PARENT_TENANT_ID="$(json_field "$TENANT_LIST_JSON" "data.tenants.find((tenant) => tenant.active)?.id ?? data.tenants[0]?.id")"
fi

if [[ -z "$PARENT_TENANT_ID" ]]; then
  echo "Could not resolve a parent tenant for profile '$PROFILE'." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/src/eai.config"
cat > "$PROJECT_DIR/.env.local" <<EOF
BASE_URL_PUBLIC_API=$PUBLIC_API_URL
NEXT_PUBLIC_APP_NAME=local-e2e
EOF

cat > "$PROJECT_DIR/src/eai.config/object-types.ts" <<'EOF'
export const objectTypes = {
  'local-e2e': [
    {
      name: 'TenantPgNote',
      displayName: 'TenantPgNote',
      description: 'Local E2E PostgreSQL note',
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
          databaseAlias: 'resource-primary',
          tenantSchemaStrategy: 'per-tenant-database',
          schemaName: 'resources',
          tableName: 'tenant_resources',
        },
      },
    },
    {
      name: 'TenantDocumentNote',
      displayName: 'TenantDocumentNote',
      description: 'Local E2E DocumentDB note',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'resource-documentdb',
          databaseName: 'tenant-resources',
          collectionName: 'resources',
          partitionKey: 'tenantId',
        },
      },
    },
    {
      name: 'TenantBlobNote',
      displayName: 'TenantBlobNote',
      description: 'Local E2E Blob note',
      status: 'published',
      storageBackend: 'blob',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        blob: {
          storageAccountAlias: 'resource-blobs',
          containerName: 'tenant-files',
          blobPrefix: 'tenant',
        },
      },
    },
    {
      name: 'TenantSearchNote',
      displayName: 'TenantSearchNote',
      description: 'Local E2E Search note',
      status: 'published',
      storageBackend: 'search',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        search: {
          searchServiceAlias: 'resource-search',
          indexName: 'aicore-chunks-002',
        },
      },
    },
  ],
}
EOF

cd "$PROJECT_DIR"

CREATE_JSON="$(create_test_tenant)"
TENANT_ID="$(json_field "$CREATE_JSON" "data.tenant.doc?.id ?? data.tenant.id")"
assert_json "$CREATE_JSON" "typeof (data.tenant.doc?.id ?? data.tenant.id) === 'string' && (data.tenant.doc?.id ?? data.tenant.id).length > 0" "Created tenant id is missing"

node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" tenant select "$TENANT_ID" >/dev/null

PROVISION_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" provision storage --tenant-id "$TENANT_ID" --format json)"
assert_json "$PROVISION_JSON" "Array.isArray(data.results) && data.results.some((item) => item.objectType === 'tenant-postgresql-base' && item.status === 'provisioned')" "PostgreSQL base provisioning missing"
assert_json "$PROVISION_JSON" "Array.isArray(data.results) && data.results.some((item) => item.objectType === 'tenant-documentdb-base' && item.status === 'provisioned')" "DocumentDB base provisioning missing"
assert_json "$PROVISION_JSON" "Array.isArray(data.results) && data.results.some((item) => item.objectType === 'tenant-blob-base' && item.status === 'provisioned')" "Blob base provisioning missing"
assert_json "$PROVISION_JSON" "Array.isArray(data.results) && data.results.some((item) => item.objectType === 'tenant-search-base' && item.status === 'provisioned')" "Search base provisioning missing"
assert_json "$PROVISION_JSON" "Array.isArray(data.results) && data.results.some((item) => item.objectType === 'tenant-platform-metadata' && item.status === 'provisioned')" "Tenant metadata provisioning failed"

set +e
TYPE_SEED_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" types seed --tenant-key "$TENANT_KEY" --tenant-id "$TENANT_ID" --format json)"
TYPE_SEED_EXIT=$?
set -e
if [[ $TYPE_SEED_EXIT -ne 0 && -z "$TYPE_SEED_JSON" ]]; then
  exit "$TYPE_SEED_EXIT"
fi
assert_json "$TYPE_SEED_JSON" "Array.isArray(data.tenants) && data.tenants[0]?.failed === 0" "Type seeding reported failures"
PAYLOAD_TYPES_JSON="$(wait_for_published_object_types)"
SCHEMA_JSON="$(wait_for_schema_types)"
for TYPE_NAME in TenantPgNote TenantDocumentNote TenantBlobNote TenantSearchNote; do
  assert_json "$SCHEMA_JSON" "(data.objectTypes || []).some((type) => type.name === '$TYPE_NAME')" "Missing published schema for $TYPE_NAME"
done

PG_CREATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources create TenantPgNote --tenant-id "$TENANT_ID" --format json --data '{"title":"pg note","status":"draft"}')"
PG_ID="$(json_field "$PG_CREATE_JSON" "data.id")"
PG_GET_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources get TenantPgNote "$PG_ID" --tenant-id "$TENANT_ID" --format json)"
assert_json "$PG_GET_JSON" "data.data.title === 'pg note'" "PostgreSQL read returned unexpected payload"
PG_UPDATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources update TenantPgNote "$PG_ID" --tenant-id "$TENANT_ID" --format json --data '{"title":"pg note updated","status":"ready"}')"
assert_json "$PG_UPDATE_JSON" "data.data.title === 'pg note updated'" "PostgreSQL update returned unexpected payload"

DOC_CREATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources create TenantDocumentNote --tenant-id "$TENANT_ID" --format json --data '{"title":"doc note","status":"draft"}')"
DOCDB_ID="$(json_field "$DOC_CREATE_JSON" "data.id")"
DOC_GET_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources get TenantDocumentNote "$DOCDB_ID" --tenant-id "$TENANT_ID" --format json)"
assert_json "$DOC_GET_JSON" "data.data.title === 'doc note'" "DocumentDB read returned unexpected payload"
DOC_UPDATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources update TenantDocumentNote "$DOCDB_ID" --tenant-id "$TENANT_ID" --format json --data '{"title":"doc note updated","status":"ready"}')"
assert_json "$DOC_UPDATE_JSON" "data.data.title === 'doc note updated'" "DocumentDB update returned unexpected payload"

BLOB_CREATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources create TenantBlobNote --tenant-id "$TENANT_ID" --format json --data '{"title":"blob note","status":"draft"}')"
BLOB_ID="$(json_field "$BLOB_CREATE_JSON" "data.id")"
BLOB_GET_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources get TenantBlobNote "$BLOB_ID" --tenant-id "$TENANT_ID" --format json)"
assert_json "$BLOB_GET_JSON" "data.data.title === 'blob note'" "Blob read returned unexpected payload"
BLOB_UPDATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources update TenantBlobNote "$BLOB_ID" --tenant-id "$TENANT_ID" --format json --data '{"title":"blob note updated","status":"ready"}')"
assert_json "$BLOB_UPDATE_JSON" "data.data.title === 'blob note updated'" "Blob update returned unexpected payload"

SEARCH_CREATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources create TenantSearchNote --tenant-id "$TENANT_ID" --format json --data '{"title":"search note","status":"draft"}')"
SEARCH_ID="$(json_field "$SEARCH_CREATE_JSON" "data.id")"
SEARCH_GET_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources get TenantSearchNote "$SEARCH_ID" --tenant-id "$TENANT_ID" --format json)"
assert_json "$SEARCH_GET_JSON" "data.data.title === 'search note'" "Search read returned unexpected payload"
SEARCH_QUERY_JSON="$(retry_search "search note")"
assert_json "$SEARCH_QUERY_JSON" "(data.results || []).some((result) => result.id === '$SEARCH_ID')" "Search query did not return the created document"
SEARCH_UPDATE_JSON="$(node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources update TenantSearchNote "$SEARCH_ID" --tenant-id "$TENANT_ID" --format json --data '{"title":"search note updated","status":"ready"}')"
assert_json "$SEARCH_UPDATE_JSON" "data.data.title === 'search note updated'" "Search update returned unexpected payload"

node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantPgNote "$PG_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null
PG_ID=""
node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantDocumentNote "$DOCDB_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null
DOCDB_ID=""
node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantBlobNote "$BLOB_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null
BLOB_ID=""
node "$CLI_ROOT/dist/index.js" --profile "$PROFILE" resources delete TenantSearchNote "$SEARCH_ID" --tenant-id "$TENANT_ID" --force --format json >/dev/null
SEARCH_ID=""

echo "Local dedicated tenant lifecycle E2E passed for tenant $TENANT_ID"
