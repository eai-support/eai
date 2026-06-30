#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const DEFAULT_CLI = join(ROOT, 'dist', 'index.js');
const TRACEABILITY_DOC = join(ROOT, '.tech-docs', 'full-e2e-smoke-traceability.md');

const TRACEABILITY_BASE = [
  ['eai init', 'create', 'live', 'Scaffolds a disposable app workspace and creates the app binding in the test tenant.'],
  ['eai dev', 'read', 'help', 'Runtime server command is validated by help/contract checks; live release smoke does not start a long-running dev server.'],
  ['eai login', 'auth-create', 'external-auth', 'Browser PKCE is validated by the dedicated test profile; non-interactive password grant is intentionally not added.'],
  ['eai logout', 'auth-delete', 'manual', 'Not run in live smoke because it would destroy the authenticated test profile used by later checks.'],
  ['eai env pull', 'read', 'live-optional', 'Runs only when EAI_E2E_ENV_MUTATION=1 because tenant cloud config may contain operator-managed values.'],
  ['eai env list', 'read', 'live', 'Reads local project env after scaffold.'],
  ['eai env push', 'update', 'live-optional', 'Runs only when EAI_E2E_ENV_MUTATION=1 because it writes cloud config.'],
  ['eai types seed', 'create/update', 'live', 'Publishes PostgreSQL, DocumentDB, Blob, and Search smoke Object Types.'],
  ['eai types validate', 'read', 'live', 'Validates local Object Types before publishing.'],
  ['eai types diff', 'read', 'live', 'Compares local and remote Object Types after seed.'],
  ['eai types pull', 'read', 'live', 'Downloads remote Object Types into the disposable workspace.'],
  ['eai types define', 'create', 'help', 'Interactive builder is coming soon; help/contract only until it has a non-interactive path.'],
  ['eai tenant storage list', 'read', 'live', 'Lists published storage bindings for the test tenant.'],
  ['eai tenant storage verify', 'read', 'live', 'Verifies tenant storage readiness after sync.'],
  ['eai tenant list', 'read', 'live', 'Resolves the dedicated parent test tenant.'],
  ['eai tenant select', 'update-local', 'live', 'Selects the dedicated test tenant/profile context.'],
  ['eai tenant info', 'read', 'live', 'Reads selected test tenant details.'],
  ['eai tenant create', 'create', 'live-optional', 'Runs only when EAI_E2E_CREATE_CHILD_TENANT=1; default flow uses an existing dedicated test tenant.'],
  ['eai tenant bootstrap-admin', 'create/update', 'live-optional', 'Runs only for child-tenant smoke because it mutates membership.'],
  ['eai tenant delete', 'delete', 'live-optional', 'Runs only for child-tenant cleanup when the smoke created the child tenant.'],
  ['eai user invite', 'create/update', 'live-optional', 'Runs only when EAI_E2E_INVITE_TEST_USER is set.'],
  ['eai user provision-me', 'create/update', 'live', 'Ensures the authenticated test user is provisioned to the test tenant.'],
  ['eai resources list', 'read', 'live', 'Lists resources for every smoke Object Type.'],
  ['eai resources batch-create', 'create', 'live', 'Creates multiple PostgreSQL smoke resources.'],
  ['eai resources batch-update', 'update', 'live', 'Updates multiple PostgreSQL smoke resources.'],
  ['eai resources batch-delete', 'delete', 'live', 'Deletes multiple PostgreSQL smoke resources.'],
  ['eai resources aggregate', 'read', 'live', 'Aggregates smoke resources after CRUD.'],
  ['eai resources get', 'read', 'live', 'Reads single PostgreSQL and DocumentDB resources.'],
  ['eai resources create', 'create', 'live', 'Creates PostgreSQL, DocumentDB, Blob-backed, and Search-indexed resources.'],
  ['eai resources update', 'update', 'live', 'Updates created resources and exercises optimistic locking path.'],
  ['eai resources delete', 'delete', 'live', 'Deletes all smoke resources during cleanup.'],
  ['eai resources query', 'read', 'live', 'Runs cross-type query over smoke Object Types.'],
  ['eai resources storage status', 'read', 'live', 'Checks routing and provisioning status.'],
  ['eai resources storage doctor', 'read', 'live', 'Checks storage health/capabilities before search assertions.'],
  ['eai resources search', 'read', 'live', 'Runs fulltext search, and hybrid/vector when reported ready.'],
  ['eai resources file upload', 'create/update', 'live', 'Uploads a file to a Blob-backed resource property.'],
  ['eai resources file get', 'read', 'live', 'Downloads the uploaded Blob-backed resource file.'],
  ['eai resources file delete', 'delete', 'live', 'Deletes the Blob-backed resource file.'],
  ['eai resources schema', 'read', 'live', 'Verifies published Object Types are visible through resource schema.'],
  ['eai resources sync-schema', 'create/update', 'live', 'Reconciles storage resources from published Object Type metadata.'],
  ['eai resources doctor', 'read', 'live', 'Runs active tenant storage readiness diagnostics.'],
  ['eai app list', 'read', 'live', 'Lists apps before and after scaffold.'],
  ['eai app create', 'create', 'covered-by-init', 'The scaffold path calls the same app creation API; direct extra app creation is opt-in to avoid orphaned apps.'],
  ['eai app select', 'update-local', 'live', 'Writes the app key into the disposable workspace env.'],
  ['eai app provision', 'create/update', 'live', 'Prepares platform storage for the smoke app.'],
  ['eai chat send', 'create/read', 'live-optional', 'Runs only when EAI_E2E_WORKFLOW_KEY is configured and workflow status is available.'],
  ['eai chat stream', 'create/read', 'help', 'Interactive streaming is validated by help/contract; non-interactive chat send covers AI request path.'],
  ['eai workflow provision', 'create/update', 'live-optional', 'Runs when EAI_E2E_WORKFLOW_PROVISION=1 because workflow provisioning may require runtime/provider setup.'],
  ['eai workflow readiness', 'read', 'live', 'Checks tenant workflow readiness.'],
  ['eai workflow status', 'read', 'live-optional', 'Runs when EAI_E2E_WORKFLOW_KEY is configured.'],
  ['eai workflow request', 'create', 'live-optional', 'Runs only when explicitly enabled because it creates operator-facing requests.'],
  ['eai docs upload', 'create', 'live-optional', 'Runs when EAI_E2E_DOCS=1 because document classification/indexing can consume provider quota.'],
  ['eai docs classify', 'read/create', 'live-optional', 'Runs when EAI_E2E_DOCS=1 after document upload.'],
  ['eai docs index', 'create/update', 'live-optional', 'Runs when EAI_E2E_DOCS=1 after document upload.'],
  ['eai deploy setup', 'create-local', 'live', 'Generates deployment workflow in the disposable workspace.'],
  ['eai deploy trigger', 'create', 'manual', 'Not run by release smoke because it triggers a host deployment outside the CLI test tenant.'],
  ['eai deploy status', 'read', 'help', 'Validated by help/contract unless a deployment run id is provided.'],
  ['eai deploy env', 'read', 'live', 'Prints provider-neutral env/secret requirements.'],
  ['eai deploy doctor', 'read', 'live-optional', 'Runs when EAI_E2E_DEPLOYED_URL is configured.'],
  ['eai runtime validate', 'read', 'live', 'Validates eai.runtime.json/local runtime declarations in the scaffolded app.'],
  ['eai verify storage', 'read', 'live', 'Verifies storage status and doctor contracts.'],
  ['eai verify calls', 'read', 'live', 'Audits platform-facing CLI call contracts.'],
  ['eai doctor', 'read', 'live', 'Runs diagnostics in the smoke workspace.'],
  ['eai whoami', 'read', 'live', 'Confirms dedicated test identity and active tenant context.'],
  ['eai update', 'read/update', 'check-only', 'Runs `update --check`; installing over the release candidate is not safe inside release smoke.'],
  ['eai provision entra', 'create/update', 'live-optional', 'Runs only when EAI_E2E_PROVISION_ENTRA=1 because it creates/rotates app credentials.'],
  ['eai provision resourceapi-refresh', 'create/update', 'live-optional', 'Runs when passive ResourceAPI bundle/env is configured.'],
  ['eai provision storage', 'create/update', 'live', 'Provisions storage for the active test tenant.'],
  ['eai provision resourceapi-bundle', 'create-local', 'live', 'Creates a customer-hosted storage schema bundle in the disposable workspace.'],
  ['eai gofer refresh', 'read/update-local', 'live', 'Runs check mode by default; apply mode can be enabled in disposable workspace.'],
  ['eai template check', 'read', 'live', 'Checks app template drift in the scaffolded app.'],
  ['eai blocks list', 'read', 'live', 'Lists block catalog.'],
  ['eai blocks describe', 'read', 'live', 'Describes the first available block.'],
  ['eai blocks readiness', 'read', 'live', 'Checks block public/package-profile readiness.'],
  ['eai blocks schema', 'read', 'live', 'Prints public block manifest schema.'],
  ['eai blocks validate', 'read', 'live', 'Validates installed block catalog metadata.'],
  ['eai publicapi get', 'read', 'live', 'Calls an authorized V4 read path directly for coverage.'],
  ['eai publicapi post', 'create', 'covered-by-cli', 'Prefer first-class CLI commands for writes; direct PublicAPI write is reserved for explicit endpoint tests.'],
  ['eai publicapi patch', 'update', 'covered-by-cli', 'Prefer first-class CLI commands for writes; resource update covers the write path.'],
  ['eai publicapi put', 'update', 'covered-by-cli', 'Prefer first-class CLI commands for writes; no generic PUT smoke without a stable idempotent V4 endpoint.'],
  ['eai publicapi delete', 'delete', 'covered-by-cli', 'Prefer first-class CLI commands for deletes; resource/file delete covers delete paths.'],
  ['eai errors list', 'read', 'live', 'Lists public-safe error guidance.'],
  ['eai errors explain', 'read', 'live', 'Explains a representative error code.'],
  ['eai agent guide', 'read', 'live', 'Shows AI-agent operating guide in JSON.'],
];

const SMOKE_CALLS = {
  'eai init': [
    'eai init <app-name> --skip-prompts --current-dir --company-tenant <tenant-id> --package-profile external',
  ],
  'eai dev': [
    'eai dev --port 3000 --no-turbo --skip-checks',
  ],
  'eai login': [
    'eai --profile <test> login --tenant-name <ciam-tenant> --tenant-id <ciam-tenant-id> --scope <scope> --callback-port 8787',
  ],
  'eai logout': [
    'eai --profile <test> logout',
  ],
  'eai env pull': [
    'EAI_E2E_ENV_MUTATION=1 eai env pull --env test --label <app-name> --include-secrets',
  ],
  'eai env list': [
    'eai env list --format json',
  ],
  'eai env push': [
    'EAI_E2E_ENV_MUTATION=1 eai env push --env test --label <app-name> --key NEXT_PUBLIC_EAI_TENANT_ID',
  ],
  'eai types seed': [
    'eai types seed --tenant-id <tenant-id> --tenant-key <app-name> --dry-run --format json',
    'eai types seed --tenant-id <tenant-id> --tenant-key <app-name> --format json',
  ],
  'eai types validate': [
    'eai types validate',
  ],
  'eai types diff': [
    'eai types diff --tenant-id <tenant-id> --tenant-key <app-name>',
  ],
  'eai types pull': [
    'eai types pull --tenant-id <tenant-id> --output src/eai.config/object-types.generated.ts',
  ],
  'eai types define': [
    'eai types define --help',
  ],
  'eai tenant storage list': [
    'eai tenant storage list --format json',
  ],
  'eai tenant storage verify': [
    'eai tenant storage verify --format json',
  ],
  'eai tenant list': [
    'eai tenant list --parent <tenant-id> --all --debug --format json',
  ],
  'eai tenant select': [
    'eai tenant select <tenant-id>',
  ],
  'eai tenant info': [
    'eai tenant info <tenant-id> --format json',
  ],
  'eai tenant create': [
    'EAI_E2E_CREATE_CHILD_TENANT=1 eai tenant create --name <child-name> --slug <child-slug> --parent <tenant-id> --domain smoke.example.invalid --usecase generic --industry test --starter-template eai-app-template --home-region <region> --format json',
  ],
  'eai tenant bootstrap-admin': [
    'EAI_E2E_CREATE_CHILD_TENANT=1 eai tenant bootstrap-admin --parent <tenant-id> --child <child-tenant-id> --user-oid <oid> --user-email <email> --format json',
  ],
  'eai tenant delete': [
    'EAI_E2E_CREATE_CHILD_TENANT=1 eai tenant delete <child-tenant-id> --force --format json',
  ],
  'eai user invite': [
    'EAI_E2E_INVITE_TEST_USER=<email> eai user invite --email <email> --tenant <tenant-id>',
  ],
  'eai user provision-me': [
    'eai user provision-me --tenant <tenant-id>',
  ],
  'eai resources list': [
    'eai resources list <object-type> --tenant-id <tenant-id> --page 1 --limit 20 --sort -created_at --where {"status":{"equals":"updated"}} --format json',
  ],
  'eai resources batch-create': [
    'eai resources batch-create <object-type> --tenant-id <tenant-id> --file batch-create.json --format json',
    'eai resources batch-create <object-type> --tenant-id <tenant-id> --data [{"title":"batch smoke"}] --format json',
  ],
  'eai resources batch-update': [
    'eai resources batch-update <object-type> --tenant-id <tenant-id> --file batch-update.json --format json',
    'eai resources batch-update <object-type> --tenant-id <tenant-id> --data [{"id":"<id>","version":1,"data":{"status":"updated"}}] --format json',
  ],
  'eai resources batch-delete': [
    'eai resources batch-delete <object-type> --tenant-id <tenant-id> --file batch-delete.json --force --format json',
    'eai resources batch-delete <object-type> --tenant-id <tenant-id> --ids <id1,id2> --force --format json',
    'eai resources batch-delete <object-type> --tenant-id <tenant-id> --data [{"id":"<id>"}] --force --format json',
  ],
  'eai resources aggregate': [
    'eai resources aggregate <object-type> --tenant-id <tenant-id> --group-by status --metrics {"total":{"op":"count"}} --where {"status":{"exists":true}} --limit 1000 --format json',
  ],
  'eai resources get': [
    'eai resources get <object-type> <resource-id> --tenant-id <tenant-id> --format json',
  ],
  'eai resources create': [
    'eai resources create <object-type> --tenant-id <tenant-id> --data {"title":"smoke"} --format json',
    'eai resources create <object-type> --tenant-id <tenant-id> --file resource.json --format json',
  ],
  'eai resources update': [
    'eai resources update <object-type> <resource-id> --tenant-id <tenant-id> --data {"status":"updated"} --version 1 --format json',
  ],
  'eai resources delete': [
    'eai resources delete <object-type> <resource-id> --tenant-id <tenant-id> --force --format json',
  ],
  'eai resources query': [
    'eai resources query --tenant-id <tenant-id> --types <type-a,type-b> --where {"status":{"exists":true}} --limit 20 --format json',
  ],
  'eai resources storage status': [
    'eai resources storage status --tenant-id <tenant-id> --format json',
  ],
  'eai resources storage doctor': [
    'eai resources storage doctor --tenant-id <tenant-id> --format json',
  ],
  'eai resources search': [
    'eai resources search <query> --tenant-id <tenant-id> --types <search-type> --mode fulltext --fulltext --limit 10 --format json',
    'eai resources search <query> --tenant-id <tenant-id> --types <search-type> --mode hybrid --hybrid --limit 10 --format json',
    'eai resources search <query> --tenant-id <tenant-id> --types <search-type> --mode vector --vector --limit 10 --format json',
  ],
  'eai resources file upload': [
    'eai resources file upload <object-type> <resource-id> attachment smoke-file.txt --tenant-id <tenant-id> --format json',
  ],
  'eai resources file get': [
    'eai resources file get <object-type> <resource-id> attachment --tenant-id <tenant-id> --output smoke-file-downloaded.txt',
  ],
  'eai resources file delete': [
    'eai resources file delete <object-type> <resource-id> attachment --tenant-id <tenant-id> --force --format json',
  ],
  'eai resources schema': [
    'eai resources schema --tenant-id <tenant-id> --format json',
  ],
  'eai resources sync-schema': [
    'eai resources sync-schema --tenant-id <tenant-id> --backend documentdb --dry-run --format json',
    'eai resources sync-schema --tenant-id <tenant-id> --format json',
  ],
  'eai resources doctor': [
    'eai resources doctor --tenant-id <tenant-id> --format json',
  ],
  'eai app list': [
    'eai app list --tenant-id <tenant-id> --limit 50 --format json',
  ],
  'eai app create': [
    'eai app create <name> --tenant-id <tenant-id> --key <app-key> --template eai-app-template --source eai-cli --app-url https://example.invalid --status pending --format json',
    'eai app create <name> --tenant-id <tenant-id> --parent-tenant <tenant-id> --child-tenant <child-name> --child-tenant-slug <child-slug> --key <app-key> --format json',
  ],
  'eai app select': [
    'eai app select <app-key> --tenant-id <tenant-id> --skip-validate --format json',
  ],
  'eai app provision': [
    'eai app provision <app-key> --tenant-id <tenant-id> --backend all --dry-run --format json',
    'eai app provision <app-key> --tenant-id <tenant-id> --backend all --select --format json',
  ],
  'eai chat send': [
    'EAI_E2E_WORKFLOW_KEY=<workflow-id> eai chat send --workflow <workflow-id> --stage chat --conversation-id <conversation-id>',
  ],
  'eai chat stream': [
    'eai chat stream --workflow <workflow-id> --stage chat --conversation-id <conversation-id> --help',
  ],
  'eai workflow provision': [
    'EAI_E2E_WORKFLOW_PROVISION=1 eai workflow provision <workflow-key> --app <app-key> --tenant <tenant-id> --display-name <name> --usecase generic --scope-key generic:<workflow-key> --stage chat:Chat --stage-env NEXT_PUBLIC_WORKFLOW_ID=chat --workflow-env-key NEXT_PUBLIC_WORKFLOW_ID --bind-ai-runtime --ai-provider azure-openai --ai-model gpt-4.1 --ai-profile-key <profile-key> --stage-prompt chat=Hello --status active --write-local-env --env test --label <app-name> --format json',
  ],
  'eai workflow readiness': [
    'eai workflow readiness --tenant <tenant-id> --format json',
  ],
  'eai workflow status': [
    'EAI_E2E_WORKFLOW_KEY=<workflow-id> eai workflow status <workflow-id> --tenant <tenant-id> --format json',
  ],
  'eai workflow request': [
    'EAI_E2E_WORKFLOW_REQUEST=1 eai workflow request <workflow-key> --tenant <tenant-id> --display-name <name> --reason smoke --format json',
  ],
  'eai docs upload': [
    'EAI_E2E_DOCS=1 eai docs upload smoke-document.txt',
  ],
  'eai docs classify': [
    'EAI_E2E_DOCS=1 eai docs classify smoke-document.txt',
  ],
  'eai docs index': [
    'EAI_E2E_DOCS=1 eai docs index <document-id>',
  ],
  'eai deploy setup': [
    'eai deploy setup --repo <owner/repo>',
  ],
  'eai deploy trigger': [
    'eai deploy trigger --repo <owner/repo> --branch main --workflow deploy-demo.yml --format json',
  ],
  'eai deploy status': [
    'eai deploy status <run-id> --repo <owner/repo> --format json',
  ],
  'eai deploy env': [
    'eai deploy env --provider generic --format json',
  ],
  'eai deploy doctor': [
    'EAI_E2E_DEPLOYED_URL=<url> eai deploy doctor --url <url> --format json',
  ],
  'eai runtime validate': [
    'eai runtime validate --format json',
  ],
  'eai verify storage': [
    'eai verify storage --tenant-id <tenant-id> --format json',
  ],
  'eai verify calls': [
    'eai verify calls --tenant-id <tenant-id> --resource-type <object-type> --resource-id <resource-id> --workflow <workflow-id> --stage chat --tenant-record <tenant-id> --user-email <email> --chat-message "Smoke test" --format json',
  ],
  'eai doctor': [
    'eai doctor --check-updates',
  ],
  'eai whoami': [
    'eai whoami',
  ],
  'eai update': [
    'eai update --check --no-project-refresh',
  ],
  'eai provision entra': [
    'EAI_E2E_PROVISION_ENTRA=1 eai provision entra --force --redirect-uri <callback-uri> --debug',
    'EAI_E2E_ROTATE_ENTRA_SECRET=1 eai provision entra --rotate-secret --debug',
  ],
  'eai provision resourceapi-refresh': [
    'EAI_E2E_RESOURCEAPI_REFRESH=1 eai provision resourceapi-refresh --admin-api-url <url> --tenant-id <tenant-id> --install-id <install-id> --apply --dry-run --backend all --rebuild-search --force-overwrite --reason smoke --change-ticket E2E-SMOKE --product <app-key> --schema-version 1 --format json',
  ],
  'eai provision storage': [
    'eai provision storage --tenant-id <tenant-id> --backend all --dry-run --format json',
    'eai provision storage --tenant-id <tenant-id> --backend all --format json',
  ],
  'eai provision resourceapi-bundle': [
    'eai provision resourceapi-bundle --schema smoke-object-types.json --tenant-id <tenant-id> --install-id <install-id> --backend all --product <app-key> --schema-version 1 --out resourceapi-bundle.json --format json',
    'EAI_E2E_RESOURCEAPI_BUNDLE_APPLY=1 eai provision resourceapi-bundle --schema smoke-object-types.json --tenant-id <tenant-id> --install-id <install-id> --admin-api-url <url> --apply --dry-run --backend all --rebuild-search --product <app-key> --schema-version 1 --format json',
  ],
  'eai gofer refresh': [
    'eai gofer refresh --check --format json',
  ],
  'eai template check': [
    'eai template check --format json',
  ],
  'eai blocks list': [
    'eai blocks list --format json --lane foundation --coupling external-safe --readiness public-ready --package-profile external --custom --group-by lane',
  ],
  'eai blocks describe': [
    'eai blocks describe <block-id> --format json',
  ],
  'eai blocks readiness': [
    'eai blocks readiness --format json --package-profile external',
  ],
  'eai blocks schema': [
    'eai blocks schema --format json',
  ],
  'eai blocks validate': [
    'eai blocks validate --file <manifest.json> --strict --format json',
  ],
  'eai publicapi get': [
    'eai publicapi get /v4/data/resources/object-types --tenant-id <tenant-id> --param limit=1 --include-headers --format json',
  ],
  'eai publicapi post': [
    'EAI_E2E_PUBLICAPI_POST_PATH=<path> eai publicapi post <path> --tenant-id <tenant-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai publicapi patch': [
    'EAI_E2E_PUBLICAPI_PATCH_PATH=<path> eai publicapi patch <path> --tenant-id <tenant-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai publicapi put': [
    'EAI_E2E_PUBLICAPI_PUT_PATH=<path> eai publicapi put <path> --tenant-id <tenant-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai publicapi delete': [
    'EAI_E2E_PUBLICAPI_DELETE_PATH=<path> eai publicapi delete <path> --tenant-id <tenant-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai errors list': [
    'eai errors list --format json',
  ],
  'eai errors explain': [
    'eai errors explain E101 --format json',
  ],
  'eai agent guide': [
    'eai agent guide --format json',
  ],
};

const OPTION_DECISIONS = {
  'eai init': {
    '--from': 'Template source override is exercised by existing init tests; release live smoke uses the default public template.',
    '--tenant': 'Deprecated alias for --company-tenant; kept as backward-compatible vocabulary and not used in new smoke calls.',
    '--parent-tenant': 'Covered by app create child-tenant flow; init live smoke keeps one direct company-tenant binding unless child tenant smoke is explicitly enabled.',
    '--child-tenant': 'Covered by app create child-tenant flow and opt-in child tenant smoke.',
    '--create-child-tenant': 'Interactive prompt path; non-interactive smoke uses explicit company tenant and app create covers child creation options.',
    '--no-gofer': 'Negative scaffold mode is covered by unit tests; release live smoke keeps Gofer assets installed so follow-up refresh can run.',
  },
  'eai dev': {
    '--turbo': 'Default dev server mode; release smoke documents it but does not start a long-running server.',
  },
  'eai types seed': {
    '--env': 'Compatibility label only; tenant-id and tenant-key are the authoritative V4 smoke selectors.',
  },
  'eai env list': {
    '--show-secrets': 'Intentionally not used in release smoke to avoid printing secrets.',
  },
  'eai tenant list': {
    '--raw-user': 'Debug payload mode can include identity metadata; not printed during release smoke.',
  },
  'eai tenant create': {
    '--allow-root': 'Administrative backfill escape hatch; intentionally excluded from normal e2e smoke.',
  },
  'eai resources list': {
    '--cursor': 'Cursor is data-dependent; pagination is covered through page/limit and cursor remains contract-documented.',
  },
  'eai app provision': {
    '--rebuild-search': 'Potentially expensive search rebuild; left as explicit opt-in outside release smoke.',
    '--skip-validate': 'Negative validation bypass; not used in release smoke because the smoke should prove normal validation works.',
  },
  'eai workflow provision': {
    '--vertical': 'Deprecated alias for --app; not used by new V4-native/app vocabulary smoke.',
    '--write-app-config': 'Writes cloud configuration; opt-in outside the default destructive smoke.',
  },
  'eai verify calls': {
    '--include-chat': 'Creates a chat conversation; optional workflow/chat smoke covers it when EAI_E2E_WORKFLOW_KEY is set.',
  },
  'eai doctor': {
    '--fix': 'Mutating repair mode; not used in release smoke unless a human asks for local repair.',
  },
  'eai provision entra': {
    '--rotate-secret': 'Secret rotation is destructive; covered only when EAI_E2E_ROTATE_ENTRA_SECRET=1 is set.',
  },
  'eai provision resourceapi-refresh': {
    '--no-verify': 'Negative verification bypass; not used because smoke should verify the storage status.',
    '--no-update-install-registry': 'Registry bypass is for support/backfill workflows, not release smoke.',
  },
  'eai provision storage': {
    '--rebuild-search': 'Potentially expensive rebuild; covered by explicit opt-in tests, not default release smoke.',
  },
  'eai gofer refresh': {
    '--force': 'Overwrite mode is covered by managed-asset conflict tests; live smoke uses check mode to avoid clobbering user files.',
  },
  'eai publicapi get': {
    '--data': 'GET body is supported by the generic client but not used for the stable read smoke.',
    '--file': 'GET body file is supported by the generic client but not used for the stable read smoke.',
  },
};

const COMMON_OPTION_DECISIONS = {
  '--json': 'Deprecated JSON shortcut; new smoke calls use --format json to keep one V4-native output vocabulary.',
};

const TRACEABILITY = TRACEABILITY_BASE.map(([command, crud, coverage, notes]) => ({
  command,
  crud,
  coverage,
  notes,
  calls: SMOKE_CALLS[command] || [],
  optionDecisions: OPTION_DECISIONS[command] || {},
}));

function parseArgs(argv) {
  const args = {
    mode: 'check',
    cli: process.env.EAI_E2E_CLI || DEFAULT_CLI,
    writeDoc: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.mode = 'check';
    else if (arg === '--plan') args.mode = 'plan';
    else if (arg === '--live') args.mode = 'live';
    else if (arg === '--write-doc') args.writeDoc = true;
    else if (arg === '--cli') args.cli = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/eai-full-e2e-smoke.cjs [--check|--plan|--live] [--cli <path>] [--write-doc]

Modes:
  --check      Validate traceability against eai --describe. Non-destructive.
  --plan       Print the command/CRUD traceability table. Non-destructive.
  --live       Run the dedicated-test-tenant smoke suite. Destructive.

Live mode environment:
  EAI_E2E_TEST_PROFILE          CLI profile to use. Default: test
  EAI_E2E_TEST_USERNAME         Expected dedicated test username/email
  EAI_E2E_PARENT_TENANT_ID      Dedicated parent test tenant. Default: active/first tenant
  EAI_E2E_AUTH_COMMAND          Optional secure auth bootstrap command if whoami fails
  EAI_E2E_TEST_PASSWORD         Optional secret for EAI_E2E_AUTH_COMMAND; never printed
  EAI_E2E_CLEANUP               Delete smoke resources after run. Default: 1
  EAI_E2E_CREATE_CHILD_TENANT   Create/delete a child tenant during smoke. Default: 0
`);
}

function cliInvocation(cliPath) {
  const absolute = resolve(cliPath);
  if (absolute.endsWith('.js')) {
    return { file: process.execPath, baseArgs: [absolute] };
  }
  return { file: absolute, baseArgs: [] };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command.file, [...command.baseArgs, ...args], {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    shell: false,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: eai ${args.join(' ')}\n${redact(`${stdout}\n${stderr}`).trim()}`);
  }
  return { status: result.status || 0, stdout, stderr };
}

function redact(value) {
  const secrets = [
    process.env.EAI_E2E_TEST_PASSWORD,
    process.env.EAI_E2E_AUTH_TOKEN,
    process.env.ENTRA_CLIENT_SECRET,
    process.env.EAI_SERVICE_CLIENT_SECRET,
    process.env.OBO_CLIENT_SECRET,
  ].filter(Boolean);

  let output = String(value);
  for (const secret of secrets) {
    output = output.split(secret).join('[redacted]');
  }
  return output.replace(/(client_secret|password|token)=([^&\s]+)/gi, '$1=[redacted]');
}

function describeCli(cliPath) {
  const command = cliInvocation(cliPath);
  const result = runCommand(command, ['--describe']);
  return JSON.parse(result.stdout);
}

function leafEntries(schema) {
  const leaves = [];
  function walk(command, prefix = []) {
    const name = command.command || command.name;
    const path = [...prefix, { name, aliases: command.aliases || [] }].filter((part) => part.name);
    if (!command.subcommands || command.subcommands.length === 0) {
      leaves.push({
        command: path.map((part) => part.name).join(' '),
        aliases: aliasPaths(path),
        options: command.options || [],
      });
      return;
    }
    for (const subcommand of command.subcommands) {
      walk(subcommand, path);
    }
  }
  walk(schema);
  return leaves.sort((a, b) => a.command.localeCompare(b.command));
}

function aliasPaths(path) {
  let paths = [[]];
  let hasAlias = false;
  for (const part of path) {
    const names = [part.name, ...(part.aliases || [])];
    if ((part.aliases || []).length) hasAlias = true;
    paths = paths.flatMap((current) => names.map((name) => [...current, name]));
  }
  if (!hasAlias) return [];
  const primary = path.map((part) => part.name).join(' ');
  return paths
    .map((parts) => parts.join(' '))
    .filter((candidate) => candidate !== primary);
}

function optionCoverage(row, schemaEntry) {
  const calls = row.calls || [];
  const options = schemaEntry.options || [];
  const exercised = [];
  const deferred = [];
  const missing = [];

  for (const option of options) {
    const name = option.name;
    const isExercised = calls.some((call) => call.includes(name));
    if (isExercised) {
      exercised.push(name);
      continue;
    }
    const decision = row.optionDecisions[name] || COMMON_OPTION_DECISIONS[name];
    if (decision) {
      deferred.push(`${name}: ${decision}`);
      continue;
    }
    missing.push(name);
  }

  return { exercised, deferred, missing };
}

function markdownList(values) {
  if (!values || values.length === 0) return '-';
  return values.map((value) => markdownCell(value)).join('<br>');
}

function markdownCell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function traceabilityMarkdown(schema) {
  const leaves = leafEntries(schema);
  const entryByCommand = new Map(leaves.map((entry) => [entry.command, entry]));
  const rows = TRACEABILITY
    .slice()
    .sort((a, b) => a.command.localeCompare(b.command));
  return `# EAI Full E2E Smoke Traceability

Generated from \`eai --describe\`. This table is the release-test contract for
the public CLI command surface. Live coverage is intentionally explicit so a new
command, alias, or option cannot be added without a coverage decision.

| Command | Alias surface | CRUD / operation | Release coverage | Smoke calls / options | Deferred options | Traceability note |
| ------- | ------------- | ---------------- | ---------------- | --------------------- | ---------------- | ----------------- |
${rows.map((row) => {
  const entry = entryByCommand.get(row.command) || { aliases: [], options: [] };
  const coverage = optionCoverage(row, entry);
  return `| \`${row.command}\` | ${markdownList(entry.aliases.map((alias) => `\`${alias}\``))} | ${row.crud} | ${row.coverage} | ${markdownList(row.calls.map((call) => `\`${call}\``))} | ${markdownList(coverage.deferred)} | ${row.notes} |`;
}).join('\n')}

## Coverage Summary

| Metric | Count |
| ------ | ----- |
| CLI leaf commands | ${leaves.length} |
| Traceability rows | ${rows.length} |
| Live rows | ${rows.filter((row) => row.coverage === 'live').length} |
| Optional live rows | ${rows.filter((row) => row.coverage === 'live-optional').length} |
| Help/check/manual rows | ${rows.filter((row) => !row.coverage.startsWith('live')).length} |
| Alias paths covered | ${leaves.reduce((count, entry) => count + entry.aliases.length, 0)} |
`;
}

function checkTraceability(schema) {
  const leafSchemaEntries = leafEntries(schema);
  const leaves = leafSchemaEntries.map((entry) => entry.command);
  const entryByCommand = new Map(leafSchemaEntries.map((entry) => [entry.command, entry]));
  const traced = TRACEABILITY.map((row) => row.command).sort();
  const missing = leaves.filter((command) => !traced.includes(command));
  const stale = traced.filter((command) => !leaves.includes(command));
  const duplicateRows = traced.filter((command, index) => traced.indexOf(command) !== index);
  const missingCalls = TRACEABILITY
    .filter((row) => !row.calls || row.calls.length === 0)
    .map((row) => row.command);
  const missingOptionCoverage = [];
  const staleOptionDecisions = [];
  for (const row of TRACEABILITY) {
    const schemaEntry = entryByCommand.get(row.command);
    if (!schemaEntry) continue;
    const coverage = optionCoverage(row, schemaEntry);
    if (coverage.missing.length) {
      missingOptionCoverage.push(`${row.command}: ${coverage.missing.join(', ')}`);
    }
    const schemaOptions = new Set(schemaEntry.options.map((option) => option.name));
    for (const optionName of Object.keys(row.optionDecisions)) {
      if (!schemaOptions.has(optionName)) {
        staleOptionDecisions.push(`${row.command}: ${optionName}`);
      }
    }
  }
  const requiredLive = [
    'eai init',
    'eai user provision-me',
    'eai types seed',
    'eai resources create',
    'eai resources get',
    'eai resources update',
    'eai resources delete',
    'eai resources file upload',
    'eai resources file get',
    'eai resources file delete',
    'eai resources search',
    'eai resources sync-schema',
    'eai app provision',
    'eai provision storage',
  ];
  const notLive = requiredLive.filter((command) => {
    const row = TRACEABILITY.find((item) => item.command === command);
    return !row || row.coverage !== 'live';
  });

  const failures = [];
  if (missing.length) failures.push(`Missing traceability rows:\n  - ${missing.join('\n  - ')}`);
  if (stale.length) failures.push(`Stale traceability rows:\n  - ${stale.join('\n  - ')}`);
  if (duplicateRows.length) failures.push(`Duplicate traceability rows:\n  - ${[...new Set(duplicateRows)].join('\n  - ')}`);
  if (missingCalls.length) failures.push(`Missing smoke call examples:\n  - ${missingCalls.join('\n  - ')}`);
  if (missingOptionCoverage.length) failures.push(`Missing option coverage decisions:\n  - ${missingOptionCoverage.join('\n  - ')}`);
  if (staleOptionDecisions.length) failures.push(`Stale option coverage decisions:\n  - ${staleOptionDecisions.join('\n  - ')}`);
  if (notLive.length) failures.push(`Required live CRUD rows are not marked live:\n  - ${notLive.join('\n  - ')}`);

  if (failures.length) {
    throw new Error(failures.join('\n\n'));
  }

  return {
    leafCommands: leaves.length,
    traceabilityRows: traced.length,
    liveRows: TRACEABILITY.filter((row) => row.coverage === 'live').length,
    aliasPaths: leafSchemaEntries.reduce((count, entry) => count + entry.aliases.length, 0),
  };
}

function writeTraceabilityDoc(schema) {
  writeFileSync(TRACEABILITY_DOC, traceabilityMarkdown(schema), 'utf8');
}

function parseJson(output, fallback = {}) {
  try {
    return JSON.parse(output);
  } catch {
    return fallback;
  }
}

function firstTenantId(payload) {
  const tenants = payload.tenants || payload.docs || payload.resources || [];
  const active = tenants.find((tenant) => tenant.active || tenant.data?.active);
  const tenant = active || tenants[0] || {};
  return tenant.id || tenant.data?.id || tenant.tenantId || '';
}

function extractId(payload) {
  return payload.id
    || payload.resource?.id
    || payload.body?.id
    || payload.doc?.id
    || payload.data?.id
    || payload.created?.id
    || '';
}

function createJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function runLiveSmoke(cliPath) {
  const profile = process.env.EAI_E2E_TEST_PROFILE || 'test';
  const expectedUsername = process.env.EAI_E2E_TEST_USERNAME || '';
  const cleanup = process.env.EAI_E2E_CLEANUP !== '0';
  const runId = process.env.EAI_E2E_RUN_ID || new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const command = cliInvocation(cliPath);
  const outputRoot = resolve(process.env.EAI_E2E_OUTPUT_ROOT || join(ROOT, '.smoke', 'eai-full-e2e'));
  mkdirSync(outputRoot, { recursive: true });
  const projectRoot = mkdtempSync(join(outputRoot, `${runId}-`));
  const appName = `eai-e2e-smoke-${runId}`;
  const summary = [];
  const createdResources = [];

  function eai(args, options = {}) {
    const result = runCommand(command, ['--profile', profile, ...args], {
      cwd: options.cwd || projectRoot,
      allowFailure: options.allowFailure,
      env: options.env,
    });
    summary.push({ command: `eai --profile ${profile} ${args.join(' ')}`, status: result.status });
    return result;
  }

  console.log(`[e2e] CLI: ${basename(cliPath)}`);
  console.log(`[e2e] profile: ${profile}`);
  console.log(`[e2e] workspace: ${projectRoot}`);

  let whoami = eai(['whoami'], { allowFailure: true });
  if (whoami.status !== 0 && process.env.EAI_E2E_AUTH_COMMAND) {
    console.log('[e2e] whoami failed; running external auth bootstrap command');
    const auth = spawnSync(process.env.EAI_E2E_AUTH_COMMAND, {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      shell: true,
    });
    if (auth.status !== 0) {
      throw new Error(`External auth bootstrap failed:\n${redact(`${auth.stdout || ''}\n${auth.stderr || ''}`)}`);
    }
    whoami = eai(['whoami']);
  }
  if (whoami.status !== 0) {
    throw new Error(`The test profile is not authenticated. Run "eai --profile ${profile} login" as the dedicated test user, or set EAI_E2E_AUTH_COMMAND.`);
  }
  if (expectedUsername && !`${whoami.stdout}\n${whoami.stderr}`.toLowerCase().includes(expectedUsername.toLowerCase())) {
    throw new Error(`Authenticated user does not match EAI_E2E_TEST_USERNAME (${expectedUsername}).`);
  }

  eai(['update', '--check', '--no-project-refresh'], { cwd: ROOT });
  eai(['agent', 'guide', '--format', 'json'], { cwd: ROOT });
  eai(['errors', 'list', '--format', 'json'], { cwd: ROOT });
  eai(['errors', 'explain', 'E101', '--format', 'json'], { cwd: ROOT });
  eai(['blocks', 'list', '--format', 'json'], { cwd: ROOT });
  eai(['blocks', 'readiness', '--format', 'json'], { cwd: ROOT });
  eai(['blocks', 'schema', '--format', 'json'], { cwd: ROOT });
  eai(['blocks', 'validate', '--format', 'json'], { cwd: ROOT });

  const blockList = parseJson(eai(['blocks', 'list', '--format', 'json'], { cwd: ROOT }).stdout, {});
  const firstBlock = blockList.blocks?.[0]?.id || blockList.items?.[0]?.id;
  if (firstBlock) {
    eai(['blocks', 'describe', firstBlock, '--format', 'json'], { cwd: ROOT });
  }

  const tenantList = parseJson(eai(['tenant', 'list', '--format', 'json'], { cwd: ROOT }).stdout, {});
  const parentTenantId = process.env.EAI_E2E_PARENT_TENANT_ID || firstTenantId(tenantList);
  if (!parentTenantId) {
    throw new Error('Could not resolve a dedicated parent test tenant. Set EAI_E2E_PARENT_TENANT_ID.');
  }
  eai(['tenant', 'select', parentTenantId], { cwd: ROOT });
  eai(['tenant', 'info', parentTenantId, '--format', 'json'], { cwd: ROOT });
  eai(['user', 'provision-me', '--tenant', parentTenantId], { cwd: ROOT });

  eai(['init', appName, '--skip-prompts', '--current-dir', '--company-tenant', parentTenantId]);
  eai(['runtime', 'validate', '--format', 'json']);
  eai(['template', 'check', '--format', 'json']);
  eai(['gofer', 'refresh', '--check', '--format', 'json']);
  eai(['deploy', 'env', '--provider', 'generic', '--format', 'json']);
  eai(['deploy', 'setup']);
  eai(['env', 'list', '--format', 'json']);
  eai(['app', 'list', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['app', 'select', appName, '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['app', 'provision', appName, '--tenant-id', parentTenantId, '--select', '--format', 'json']);
  eai(['provision', 'storage', '--tenant-id', parentTenantId, '--format', 'json']);

  writeSmokeObjectTypes(projectRoot, appName, runId);
  const bundleSchema = join(projectRoot, 'smoke-object-types.json');
  createJsonFile(bundleSchema, { objectTypes: smokeObjectTypes(appName, runId) });
  eai([
    'provision',
    'resourceapi-bundle',
    '--schema',
    bundleSchema,
    '--tenant-id',
    parentTenantId,
    '--install-id',
    `eai-smoke-${runId}`,
    '--product',
    appName,
    '--out',
    join(projectRoot, 'resourceapi-bundle.json'),
    '--format',
    'json',
  ]);

  eai(['types', 'validate']);
  eai(['types', 'seed', '--tenant-id', parentTenantId, '--tenant-key', appName, '--format', 'json']);
  eai(['resources', 'sync-schema', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['types', 'diff', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['types', 'pull', '--tenant-id', parentTenantId, '--output', join(projectRoot, 'src', 'eai.config', 'object-types.generated.ts')]);
  eai(['resources', 'schema', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'storage', 'status', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'storage', 'doctor', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'doctor', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['tenant', 'storage', 'list', '--format', 'json']);
  eai(['tenant', 'storage', 'verify', '--format', 'json']);
  eai(['verify', '--tenant-id', parentTenantId]);
  eai(['verify', 'storage', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['verify', 'calls', '--format', 'json']);
  eai(['doctor']);
  eai(['workflow', 'readiness', '--tenant', parentTenantId, '--format', 'json']);

  const pgType = `EaiSmokePg${runId}`;
  const docType = `EaiSmokeDoc${runId}`;
  const fileType = `EaiSmokeFile${runId}`;
  const searchType = `EaiSmokeSearch${runId}`;

  const pgId = createResource(eai, parentTenantId, pgType, { title: 'postgres smoke', status: 'draft', count: 1 });
  createdResources.push([pgType, pgId]);
  eai(['resources', 'get', pgType, pgId, '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'update', pgType, pgId, '--tenant-id', parentTenantId, '--data', JSON.stringify({ status: 'updated', count: 2 }), '--format', 'json']);

  const docId = createResource(eai, parentTenantId, docType, { title: 'documentdb smoke', status: 'draft' });
  createdResources.push([docType, docId]);
  eai(['resources', 'get', docType, docId, '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'update', docType, docId, '--tenant-id', parentTenantId, '--data', JSON.stringify({ status: 'updated' }), '--format', 'json']);

  const fileId = createResource(eai, parentTenantId, fileType, { title: 'file smoke', status: 'draft' });
  createdResources.push([fileType, fileId]);
  const uploadFile = join(projectRoot, 'smoke-file.txt');
  writeFileSync(uploadFile, `EAI file smoke ${runId}\n`, 'utf8');
  const downloadFile = join(projectRoot, 'smoke-file-downloaded.txt');
  eai(['resources', 'file', 'upload', fileType, fileId, 'attachment', uploadFile, '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['resources', 'file', 'get', fileType, fileId, 'attachment', '--tenant-id', parentTenantId, '--output', downloadFile]);
  eai(['resources', 'file', 'delete', fileType, fileId, 'attachment', '--tenant-id', parentTenantId, '--force', '--format', 'json']);

  const searchId = createResource(eai, parentTenantId, searchType, {
    title: `search smoke ${runId}`,
    body: `unique-search-term-${runId}`,
    status: 'published',
  });
  createdResources.push([searchType, searchId]);

  const batchFile = join(projectRoot, 'batch-create.json');
  createJsonFile(batchFile, [
    { title: 'batch smoke one', status: 'draft', count: 10 },
    { title: 'batch smoke two', status: 'draft', count: 20 },
  ]);
  const batchCreate = parseJson(eai(['resources', 'batch-create', pgType, '--tenant-id', parentTenantId, '--file', batchFile, '--format', 'json']).stdout, {});
  const batchIds = (batchCreate.resources || batchCreate.created || batchCreate.items || [])
    .map((item) => item.id || item.resource?.id)
    .filter(Boolean);
  for (const id of batchIds) createdResources.push([pgType, id]);
  if (batchIds.length) {
    const batchUpdateFile = join(projectRoot, 'batch-update.json');
    createJsonFile(batchUpdateFile, batchIds.map((id) => ({ id, version: 1, data: { status: 'batch-updated' } })));
    eai(['resources', 'batch-update', pgType, '--tenant-id', parentTenantId, '--file', batchUpdateFile, '--format', 'json']);
  }

  eai(['resources', 'list', pgType, '--tenant-id', parentTenantId, '--format', 'json']);
  eai([
    'resources',
    'aggregate',
    pgType,
    '--tenant-id',
    parentTenantId,
    '--group-by',
    'status',
    '--metrics',
    JSON.stringify({ total: { op: 'count' } }),
    '--format',
    'json',
  ]);
  eai(['resources', 'query', '--tenant-id', parentTenantId, '--types', `${pgType},${docType},${fileType},${searchType}`, '--limit', '20', '--format', 'json']);
  retryEai(
    eai,
    ['resources', 'search', `unique-search-term-${runId}`, '--tenant-id', parentTenantId, '--types', searchType, '--fulltext', '--format', 'json'],
    (result) => {
      const payload = parseJson(result.stdout, {});
      return Array.isArray(payload.results) && payload.results.length > 0;
    },
    'resource search did not return the indexed smoke resource',
  );
  eai(['publicapi', 'get', `/v4/data/resources/object-types?where[tenant][equals]=${encodeURIComponent(parentTenantId)}&limit=1`, '--tenant-id', parentTenantId, '--format', 'json']);

  if (process.env.EAI_E2E_DEPLOYED_URL) {
    eai(['deploy', 'doctor', '--url', process.env.EAI_E2E_DEPLOYED_URL, '--format', 'json']);
  }
  if (process.env.EAI_E2E_WORKFLOW_KEY) {
    eai(['workflow', 'status', '--tenant', parentTenantId, process.env.EAI_E2E_WORKFLOW_KEY, '--format', 'json'], { allowFailure: true });
    eai(['chat', 'send', '--workflow', process.env.EAI_E2E_WORKFLOW_KEY, '--message', `Smoke ${runId}`, '--format', 'json'], { allowFailure: true });
  }
  if (process.env.EAI_E2E_DOCS === '1') {
    const docFile = join(projectRoot, 'smoke-document.txt');
    writeFileSync(docFile, `EAI document smoke ${runId}\n`, 'utf8');
    const uploaded = parseJson(eai(['docs', 'upload', docFile]).stdout, {});
    const docId = extractId(uploaded);
    if (docId) {
      eai(['docs', 'classify', docFile], { allowFailure: true });
      eai(['docs', 'index', docId], { allowFailure: true });
    }
  }

  if (cleanup) {
    for (const [type, id] of createdResources.reverse()) {
      eai(['resources', 'delete', type, id, '--tenant-id', parentTenantId, '--force', '--format', 'json'], { allowFailure: true });
    }
    if (batchIds.length) {
      const batchDeleteFile = join(projectRoot, 'batch-delete.json');
      createJsonFile(batchDeleteFile, batchIds.map((id) => ({ id })));
      eai(['resources', 'batch-delete', pgType, '--tenant-id', parentTenantId, '--file', batchDeleteFile, '--force', '--format', 'json'], { allowFailure: true });
    }
  }

  writeFileSync(join(projectRoot, 'summary.json'), `${JSON.stringify({ runId, profile, parentTenantId, projectRoot, summary }, null, 2)}\n`, 'utf8');
  console.log(`[e2e] Full smoke passed. Summary: ${join(projectRoot, 'summary.json')}`);
}

function retryEai(eai, args, isSuccess, failureMessage, attempts = 10, delayMs = 2000) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = eai(args, { allowFailure: true });
    if (last.status === 0 && isSuccess(last)) {
      return last;
    }
    if (attempt < attempts) {
      sleep(delayMs);
    }
  }
  throw new Error(`${failureMessage}\n${redact(`${last?.stdout || ''}\n${last?.stderr || ''}`)}`);
}

function createResource(eai, tenantId, type, data) {
  const payload = parseJson(eai(['resources', 'create', type, '--tenant-id', tenantId, '--data', JSON.stringify(data), '--format', 'json']).stdout, {});
  const id = extractId(payload);
  if (!id) {
    throw new Error(`Could not extract id for created ${type}`);
  }
  return id;
}

function writeSmokeObjectTypes(projectRoot, appName, runId) {
  const typeFile = join(projectRoot, 'src', 'eai.config', 'object-types.ts');
  const definitions = smokeObjectTypes(appName, runId);
  const content = `export const objectTypes = {
  '${appName}': ${JSON.stringify(definitions, null, 4)},
};
`;
  writeFileSync(typeFile, content, 'utf8');
}

function smokeObjectTypes(appName, runId) {
  const prefix = appName.replace(/-/g, '_');
  return [
    {
      name: `EaiSmokePg${runId}`,
      displayName: `EAI Smoke PostgreSQL ${runId}`,
      description: 'Full e2e smoke PostgreSQL Object Type.',
      status: 'published',
      storageBackend: 'postgresql',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true, indexed: true },
        { name: 'count', type: 'number', required: false, indexed: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        postgresql: {
          connectionAlias: 'tenant-postgres',
          schemaName: 'resources',
          tableName: `${prefix}_pg_${runId}`,
        },
      },
    },
    {
      name: `EaiSmokeDoc${runId}`,
      displayName: `EAI Smoke DocumentDB ${runId}`,
      description: 'Full e2e smoke DocumentDB Object Type.',
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
          collectionName: `${prefix}_doc_${runId}`,
          partitionKey: '/tenantId',
        },
      },
    },
    {
      name: `EaiSmokeFile${runId}`,
      displayName: `EAI Smoke Blob File ${runId}`,
      description: 'Full e2e smoke Blob-backed Object Type.',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true },
        { name: 'attachment', type: 'file', required: false },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: `${prefix}_file_${runId}`,
          partitionKey: '/tenantId',
        },
        blob: {
          containerAlias: 'tenant-files',
          pathPrefix: `${prefix}/file/${runId}`,
        },
      },
    },
    {
      name: `EaiSmokeSearch${runId}`,
      displayName: `EAI Smoke Search ${runId}`,
      description: 'Full e2e smoke AI Search indexed Object Type.',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true, searchable: true },
        { name: 'body', type: 'longText', required: true, indexed: true, searchable: true },
        { name: 'status', type: 'text', required: true, indexed: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: `${prefix}_search_${runId}`,
          partitionKey: '/tenantId',
        },
        search: {
          indexAlias: 'tenant-search',
          indexName: `${prefix}-search-${runId}`,
          keyField: 'id',
          contentFields: ['title', 'body'],
        },
      },
    },
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.cli)) {
    throw new Error(`CLI entrypoint not found: ${args.cli}. Run npm run build first or pass --cli.`);
  }
  const schema = describeCli(args.cli);

  if (args.mode === 'check') {
    const result = checkTraceability(schema);
    if (args.writeDoc) writeTraceabilityDoc(schema);
    console.log(`✓ Full e2e traceability covers ${result.leafCommands} CLI leaf commands (${result.liveRows} live rows).`);
    return;
  }

  if (args.mode === 'plan') {
    const markdown = traceabilityMarkdown(schema);
    if (args.writeDoc) writeTraceabilityDoc(schema);
    console.log(markdown);
    return;
  }

  checkTraceability(schema);
  if (args.writeDoc) writeTraceabilityDoc(schema);
  runLiveSmoke(args.cli);
}

try {
  main();
} catch (error) {
  console.error(`✗ ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
}
