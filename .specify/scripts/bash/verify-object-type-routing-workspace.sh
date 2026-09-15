#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 64
fi

required_paths=(
  "front/eai-app-template/packages/platform-sdk/__tests__/object-types.test.ts"
  "front/eai-app-template/packages/platform-sdk/__tests__/resources.test.ts"
  "front/eai-app-template/packages/platform-sdk/src/resource-routing.ts"
  "front/eai-app-template/src/app/api/eai/[[...rest]]/route.test.ts"
  "front/eai-app-template/src/hooks/useResources.test.tsx"
  "front/eai-app-template/src/lib/platform/publicapi-url.test.ts"
  "front/eai-app-template/src/lib/platform/seed-object-types.test.ts"
  "front/eai-app-template/src/lib/platform/storage-provisioning.test.ts"
  "front/eai-app-template/src/lib/platform/verify-platform.test.ts"
  "front/eai-app-template/tests/generate-object-types-json.test.mjs"
  "ops/eai-cli/tests/unit/object-type-identifiers.test.ts"
  "ops/eai-cli/tests/integration/gofer.test.ts"
  "ops/eai-cli/tests/integration/init.test.ts"
  "ops/eai-cli/tests/integration/resources-command.test.ts"
  "ops/eai-cli/tests/integration/types.test.ts"
  "ops/gofer/tests/unit/scripts/v4-resource-contract-validator.test.ts"
  "ops/gofer/tests/integration/v4-resource-contract-validator.integration.test.ts"
  "ops/gofer/tests/integration/object-type-identifier-audit-schema.integration.test.ts"
  "ops/gofer/tests/integration/object-type-identifiers-validator.integration.test.ts"
  "ops/gofer/tests/integration/object-type-routing-phase-bundle.integration.test.ts"
  "ops/gofer/tests/integration/object-type-routing-workspace-validator.integration.test.ts"
  "ops/gofer/tests/unit/extension/ResourceSyncer.workspace-sync.test.ts"
  "ops/gofer/extension/resources/bash-scripts/verify-object-type-routing-workspace.sh"
  "front/Configurator/testing/__tests__/unit/collections/object-types-identifier-contract.test.ts"
  "front/Configurator/testing/__tests__/unit/collections/object-types-scope.test.ts"
  "front/Configurator/testing/__tests__/unit/collections/object-types-reserved-slugs.test.ts"
  "front/Configurator/testing/__tests__/unit/collections/object-types-api-error-status.test.ts"
  "front/Configurator/testing/__tests__/unit/api/tenant-starter-bootstrap-seeds.test.ts"
  "front/Configurator/testing/__tests__/integration/api/data-api-remote-proxy.test.ts"
  "front/Configurator/testing/__tests__/unit/app-api-remote-proxy-guardrail.test.ts"
  "front/Configurator/tests/unit/eai-product-catalog-seed.test.ts"
  "mid/PublicAPI/src/tests/unit/test_object_type_identifiers.py"
  "mid/PublicAPI/src/tests/unit/test_object_type_contract.py"
  "mid/PublicAPI/src/tests/unit/test_resources_proxy_router.py"
  "mid/PublicAPI/src/tests/unit/test_v4_openapi_sections.py"
  "mid/PublicAPI/src/tests/unit/test_region_aware_apim_workflows.py"
  "mid/PublicAPI/src/tests/unit/test_opa_auth_middleware.py"
  "mid/PublicAPI/src/tests/unit/test_v4_management_routes.py"
  "mid/PublicAPI/src/tests/unit/test_legacy_resource_routes.py"
  "mid/PublicAPI/src/tests/unit/test_telemetry.py"
  "mid/AdminAPI/src/services/object_type_identifiers.py"
  "mid/AdminAPI/tests/test_object_type_identifiers.py"
  "mid/AdminAPI/tests/test_platform_storage.py"
  "mid/AdminAPI/tests/test_v4_platform_manifest_models.py"
  "mid/ResourceAPI/tests/unit/test_object_type_identifiers.py"
  "mid/ResourceAPI/tests/unit/test_reserved_object_type_routes.py"
  "mid/ResourceAPI/tests/unit/test_object_type_models.py"
  "mid/ResourceAPI/tests/unit/test_object_type_cache.py"
  "mid/ResourceAPI/tests/unit/test_resource_service_routing.py"
  "mid/ResourceAPI/tests/unit/test_object_type_routing_boundary.py"
  "ops/tech-docs/.github/scripts/validate-object-type-routing-contract.mjs"
  "ops/tech-docs/.github/scripts/validate-object-type-routing-schemas.mjs"
  "ops/tech-docs/.github/scripts/sync-object-type-routing-runtime-assets.mjs"
  "ops/tech-docs/static/contracts/object-type-routing-v1.json"
  "ops/tech-docs/static/schemas/object-type-manifest-v1.schema.json"
  "ops/tech-docs/static/schemas/resource-action-v1.schema.json"
  "ops/cloud-monitor/tests/helpers/inventory-object-type-routing.test.ts"
  "ops/cloud-monitor/tests/helpers/object-type-routing-canary.test.ts"
  "ops/cloud-monitor/tests/helpers/publicapi-route-family-probes.test.ts"
  "ops/cloud-monitor/tests/helpers/cross-service-scope.test.ts"
  "ops/cloud-monitor/tests/cross-service/contracts/backend/object-type-routing.spec.ts"
  "ops/cloud-monitor/tests/cross-service/contracts/backend/v4-route-family-apim.spec.ts"
)

coverage_maps=(
  "front/eai-app-template/.eai/test-coverage.json"
  "ops/eai-cli/.eai/test-coverage.json"
  "ops/gofer/.eai/test-coverage.json"
  "front/Configurator/.eai/test-coverage.json"
  "mid/PublicAPI/.eai/test-coverage.json"
  "mid/AdminAPI/.eai/test-coverage.json"
  "mid/ResourceAPI/.eai/test-coverage.json"
  "ops/tech-docs/.eai/test-coverage.json"
  "ops/cloud-monitor/.eai/test-coverage.json"
)

commands=(
  "eai-app-template|npm run test:object-types-generator && npm test -- --runInBand packages/platform-sdk/__tests__/object-types.test.ts packages/platform-sdk/__tests__/resources.test.ts 'src/app/api/eai/[[...rest]]/route.test.ts' src/hooks/useResources.test.tsx src/lib/platform/publicapi-url.test.ts src/lib/platform/seed-object-types.test.ts src/lib/platform/storage-provisioning.test.ts src/lib/platform/verify-platform.test.ts && npm run typecheck && npm run check:object-types && npm run build"
  "eai-cli|npm test -- --run tests/unit/object-type-identifiers.test.ts tests/integration/gofer.test.ts tests/integration/init.test.ts tests/integration/resources-command.test.ts tests/integration/types.test.ts && npm run typecheck && npm run lint && npm run build"
  "eai-gofer|npm test -- --run tests/unit/scripts/v4-resource-contract-validator.test.ts tests/integration/v4-resource-contract-validator.integration.test.ts tests/integration/object-type-identifier-audit-schema.integration.test.ts tests/integration/object-type-identifiers-validator.integration.test.ts tests/integration/object-type-routing-phase-bundle.integration.test.ts tests/integration/object-type-routing-workspace-validator.integration.test.ts tests/unit/extension/ResourceSyncer.workspace-sync.test.ts && npm run gofer:generate:check && npm run typecheck && npm run lint && npm run build && npm run gofer:validate-v4-resource-contract -- --workspace ../.. --json"
  "Configurator|npx jest --config testing/config/jest.config.js --runInBand --runTestsByPath testing/__tests__/unit/collections/object-types-identifier-contract.test.ts testing/__tests__/unit/collections/object-types-scope.test.ts testing/__tests__/unit/collections/object-types-reserved-slugs.test.ts testing/__tests__/unit/collections/object-types-api-error-status.test.ts testing/__tests__/unit/api/tenant-starter-bootstrap-seeds.test.ts testing/__tests__/integration/api/data-api-remote-proxy.test.ts testing/__tests__/unit/app-api-remote-proxy-guardrail.test.ts tests/unit/eai-product-catalog-seed.test.ts && npm run typecheck && npm run lint && npm run build"
  "PublicAPI|uv run pytest src/tests/unit/test_object_type_identifiers.py src/tests/unit/test_object_type_contract.py src/tests/unit/test_resources_proxy_router.py src/tests/unit/test_v4_openapi_sections.py src/tests/unit/test_region_aware_apim_workflows.py src/tests/unit/test_opa_auth_middleware.py src/tests/unit/test_v4_management_routes.py src/tests/unit/test_legacy_resource_routes.py src/tests/unit/test_telemetry.py && uv run ruff check src/app/core/telemetry.py src/app/middleware/entra_auth.py src/app/middleware/opa_auth.py src/app/models/object_type_contract.py src/app/routers/v4/__init__.py src/app/routers/v4/data_contracts.py src/app/routers/v4/data_resources.py src/app/routers/v4/metadata.py src/app/services/object_type_identifiers.py src/app/services/resource_proxy_paths.py src/main.py src/tests/unit/test_object_type_identifiers.py src/tests/unit/test_object_type_contract.py src/tests/unit/test_resources_proxy_router.py src/tests/unit/test_v4_openapi_sections.py && uv run mypy src/app/core/telemetry.py src/app/middleware/entra_auth.py src/app/middleware/opa_auth.py src/app/models/object_type_contract.py src/app/routers/v4/__init__.py src/app/routers/v4/data_contracts.py src/app/routers/v4/data_resources.py src/app/routers/v4/metadata.py src/app/services/object_type_identifiers.py src/app/services/resource_proxy_paths.py src/main.py && uv build"
  "AdminAPI|uv run pytest tests/test_object_type_identifiers.py tests/test_platform_storage.py tests/test_v4_platform_manifest_models.py && uv run ruff check src/api/routes/platform.py src/services/object_type_identifiers.py tests/test_object_type_identifiers.py tests/test_platform_storage.py tests/test_v4_platform_manifest_models.py && uv run python -m compileall -q src tests/test_object_type_identifiers.py tests/test_platform_storage.py tests/test_v4_platform_manifest_models.py"
  "ResourceAPI|uv run pytest tests/unit/test_object_type_identifiers.py tests/unit/test_reserved_object_type_routes.py tests/unit/test_object_type_models.py tests/unit/test_object_type_cache.py tests/unit/test_resource_service_routing.py tests/unit/test_object_type_routing_boundary.py && uv run ruff check src/services/object_type_identifiers.py src/routers/v4/resources.py src/routers/v4/query.py src/models/object_type.py src/services/object_type_cache.py tests/unit/test_object_type_identifiers.py tests/unit/test_reserved_object_type_routes.py tests/unit/test_object_type_models.py tests/unit/test_object_type_cache.py tests/unit/test_object_type_routing_boundary.py && uv run python -m compileall -q src tests/unit && uv build"
  "tech-docs|npm run contracts:check && node .github/scripts/validate-object-type-routing-contract.mjs && node .github/scripts/validate-object-type-routing-schemas.mjs && node .github/scripts/sync-object-type-routing-runtime-assets.mjs --check && npm run typecheck && npm run build"
  "cloud-monitor|node --import tsx --test tests/helpers/inventory-object-type-routing.test.ts tests/helpers/object-type-routing-canary.test.ts tests/helpers/publicapi-route-family-probes.test.ts tests/helpers/cross-service-scope.test.ts && npx playwright test --list tests/cross-service/contracts/backend/object-type-routing.spec.ts tests/cross-service/contracts/backend/v4-route-family-apim.spec.ts --project=services-dev && npm run guard:e2e-data && npm run guard:cross-service-scope && npm run guard:cross-service-contracts && npm run guard:cross-service-data-lifecycle && npm run typecheck && npm run lint && npm run build"
)

repo_dir() {
  case "$1" in
    eai-app-template) echo "$WORKSPACE_ROOT/front/eai-app-template" ;;
    eai-cli) echo "$WORKSPACE_ROOT/ops/eai-cli" ;;
    eai-gofer) echo "$WORKSPACE_ROOT/ops/gofer" ;;
    Configurator) echo "$WORKSPACE_ROOT/front/Configurator" ;;
    PublicAPI) echo "$WORKSPACE_ROOT/mid/PublicAPI" ;;
    AdminAPI) echo "$WORKSPACE_ROOT/mid/AdminAPI" ;;
    ResourceAPI) echo "$WORKSPACE_ROOT/mid/ResourceAPI" ;;
    tech-docs) echo "$WORKSPACE_ROOT/ops/tech-docs" ;;
    cloud-monitor) echo "$WORKSPACE_ROOT/ops/cloud-monitor" ;;
    *) return 1 ;;
  esac
}

echo "Object Type routing verification workspace: $WORKSPACE_ROOT"
echo "Required paths (${#required_paths[@]}):"
for relative_path in "${required_paths[@]}"; do
  if [[ ! -e "$WORKSPACE_ROOT/$relative_path" ]]; then
    echo "MISSING $relative_path" >&2
    exit 2
  fi
  echo "PATH $relative_path"
done

echo "Coverage maps (${#coverage_maps[@]}):"
for relative_path in "${coverage_maps[@]}"; do
  if ! jq -e '[.. | objects | .id? // empty] | map(select(test("(canonical-object-type|object-type-routing)"))) | length > 0' \
    "$WORKSPACE_ROOT/$relative_path" >/dev/null; then
    echo "COVERAGE_MISSING $relative_path" >&2
    exit 2
  fi
  echo "COVERAGE $relative_path"
done

echo "Repository commands (${#commands[@]}):"
for entry in "${commands[@]}"; do
  name="${entry%%|*}"
  command="${entry#*|}"
  echo "COMMAND $name :: $command"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN_OK paths=${#required_paths[@]} coverage_maps=${#coverage_maps[@]} repositories=${#commands[@]}"
  exit 0
fi

for entry in "${commands[@]}"; do
  name="${entry%%|*}"
  command="${entry#*|}"
  directory="$(repo_dir "$name")"
  echo "BEGIN $name"
  (cd "$directory" && bash -o pipefail -c "$command")
  echo "PASS $name"
done

node "$WORKSPACE_ROOT/ops/gofer/.specify/scripts/node/validate-object-type-routing-workspace.mjs" \
  --workspace "$WORKSPACE_ROOT" \
  --output "$WORKSPACE_ROOT/.specify/specs/039-canonical-object-type-routing/evidence/contract-compatibility.json" \
  --json >/dev/null

node "$WORKSPACE_ROOT/ops/gofer/.specify/scripts/node/object-type-routing-phase-bundle.mjs" \
  verify-set \
  --manifest "$WORKSPACE_ROOT/.specify/specs/039-canonical-object-type-routing/evidence/phase-bundles/manifest.json" \
  --reconstruct \
  --json >/dev/null

for repo in "$WORKSPACE_ROOT/front/Configurator" "$WORKSPACE_ROOT/mid/ResourceAPI"; do
  if git -C "$repo" diff -U0 origin/main -- | grep -E '^\+.*(create_counter|create_histogram|Counter\(|Histogram\(|publish\(|emit\()' >/dev/null; then
    echo "Unexpected Configurator/ResourceAPI instrumentation addition in $repo" >&2
    exit 2
  fi
done

if [[ "$(git -C "$WORKSPACE_ROOT/mid/PublicAPI" diff -U0 origin/main -- src/app/core/telemetry.py | grep -c '^+.*eai.publicapi.object_type_routing.rejections' || true)" -ne 2 ]]; then
  echo "PublicAPI must contain the one counter name in initial and reset meter construction only." >&2
  exit 2
fi

echo "VERIFY_OBJECT_TYPE_ROUTING_WORKSPACE_OK repositories=9 coverage_maps=9"
