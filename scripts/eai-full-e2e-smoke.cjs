#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
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
  ['eai user list', 'read', 'live', 'Verifies tenant membership visibility after invite/provision flows.'],
  ['eai user roles', 'read', 'live', 'Discovers assignable tenant roles before invite.'],
  ['eai user role set', 'create/update', 'live-optional', 'Runs only when EAI_E2E_INVITE_TEST_USER is set; email-based assignment uses the V4 invite/add flow.'],
  ['eai user provision-me', 'create/update', 'live', 'Ensures the authenticated test user is provisioned to the test tenant.'],
  ['eai resources list', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 because it depends on run-specific storage schema.'],
  ['eai resources batch-create', 'create', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 and is cleaned up by batch/per-resource delete.'],
  ['eai resources batch-import', 'create', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 against PostgreSQL-backed smoke Object Types for high-throughput ingest.'],
  ['eai resources batch-update', 'update', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 against smoke-created rows.'],
  ['eai resources batch-delete', 'delete', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 during cleanup.'],
  ['eai resources aggregate', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after ResourceAPI CRUD.'],
  ['eai resources get', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 against smoke-created resources.'],
  ['eai resources create', 'create', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 because it depends on run-specific storage schema.'],
  ['eai resources update', 'update', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 against smoke-created resources.'],
  ['eai resources delete', 'delete', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 during cleanup.'],
  ['eai resources query', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after ResourceAPI CRUD.'],
  ['eai resources storage status', 'read', 'live', 'Checks routing and provisioning status.'],
  ['eai resources storage doctor', 'read', 'live', 'Checks storage health/capabilities before search assertions.'],
  ['eai resources search', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after indexing a smoke resource.'],
  ['eai resources file upload', 'create/update', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 and is cleaned up by file/resource delete.'],
  ['eai resources file get', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after file upload.'],
  ['eai resources file delete', 'delete', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 during cleanup.'],
  ['eai resources schema', 'read', 'live', 'Verifies published Object Types are visible through resource schema.'],
  ['eai resources sync-schema', 'create/update', 'live-optional', 'Dry-run runs by default. Non-dry-run requires EAI_E2E_SYNC_SCHEMA_APPLY=1 until ResourceAPI physical cleanup exists.'],
  ['eai resources doctor', 'read', 'live', 'Runs active tenant storage readiness diagnostics.'],
  ['eai resources performance-status', 'read', 'live', 'Reads bounded resource performance and schema readiness through the platform API.'],
  ['eai resources indexes-plan', 'read', 'live-optional', 'Plans validated tenant-scoped index changes without applying storage mutations.'],
  ['eai resources indexes-apply', 'create/update', 'live-optional', 'Applies validated tenant-scoped indexes only after explicit confirmation and server authorization.'],
  ['eai resources cache-refresh', 'create/update', 'live-optional', 'Forces a signed, reasoned system-admin cache refresh; disabled in default smoke.'],
  ['eai app list', 'read', 'live', 'Lists apps before and after scaffold.'],
  ['eai app create', 'create', 'covered-by-init', 'The scaffold path calls the same app creation API; direct extra app creation is opt-in to avoid orphaned apps.'],
  ['eai app connect-existing', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids overwriting source metadata on a dedicated tenant app.'],
  ['eai app adopt-observed', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids marking app infrastructure observed without a managed redeploy path.'],
  ['eai app workflow-setup', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids issuing one-time source-unknown nonce state.'],
  ['eai app workflow-evidence', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids consuming source-unknown nonce state.'],
  ['eai app deploy-source-unknown', 'create/update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids recording deployment handoff state before TenantInfra execution exists.'],
  ['eai app deploy-source-unknown-status', 'read', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids depending on a pre-existing deployment handoff.'],
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
  ['eai update', 'read/update', 'check-only', 'Runs `update --check`; installing over the release candidate is not safe inside release smoke. Release preflight also runs update checks from the packed canonical and eai-cli alias install paths.'],
  ['eai provision entra', 'create/update/delete', 'live-optional', 'Runs only when EAI_E2E_PROVISION_ENTRA=1 because it creates/rotates/deletes app credentials.'],
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
    'eai types validate --tenant-id <tenant-id> --tenant-key <app-name>',
  ],
  'eai types diff': [
    'eai types diff --tenant-id <tenant-id> --tenant-key <app-name> --format json',
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
    'EAI_E2E_INVITE_TEST_USER=<email> eai user invite --email <email> --tenant <tenant-id> --role <role> --first-name <name> --last-name <name> --message <message> --redirect-uri <uri> --format json',
  ],
  'eai user list': [
    'eai user list --tenant <tenant-id> --search <email> --page 1 --limit 25 --sort email --format json',
  ],
  'eai user roles': [
    'eai user roles --tenant <tenant-id> --format json',
  ],
  'eai user role set': [
    'EAI_E2E_INVITE_TEST_USER=<email> eai user role set --email <email> --tenant <tenant-id> --role <role> --format json',
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
  'eai resources batch-import': [
    'eai resources batch-import <object-type> --tenant-id <tenant-id> --file batch-import.json --projection-mode deferred --format json',
    'eai resources batch-import <object-type> --tenant-id <tenant-id> --data [{"title":"batch smoke"}] --format json',
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
    'eai resources aggregate <object-type> --tenant-id <tenant-id> --group-by status --metrics {"total":{"function":"count"}} --where {"status":{"exists":true}} --limit 1000 --format json',
  ],
  'eai resources get': [
    'eai resources get <object-type> <resource-id> --tenant-id <tenant-id> --format json',
  ],
  'eai resources create': [
    'eai resources create <object-type> --tenant-id <tenant-id> --data {"title":"smoke"} --format json',
    'eai resources create <object-type> --tenant-id <tenant-id> --file resource.json --format json',
  ],
  'eai resources update': [
    'eai resources update <object-type> <resource-id> --tenant-id <tenant-id> --data {"title":"updated","status":"updated"} --version 1 --format json',
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
    'EAI_E2E_SYNC_SCHEMA_APPLY=1 eai resources sync-schema --tenant-id <tenant-id> --format json',
  ],
  'eai resources doctor': [
    'eai resources doctor --tenant-id <tenant-id> --format json',
  ],
  'eai resources performance-status': [
    'eai resources performance-status --tenant-id <tenant-id> --format json',
  ],
  'eai resources indexes-plan': [
    'eai resources indexes-plan --tenant-id <tenant-id> --format json',
  ],
  'eai resources indexes-apply': [
    'eai resources indexes-apply --tenant-id <tenant-id> --confirm --format json',
  ],
  'eai resources cache-refresh': [
    'eai resources cache-refresh --tenant-id <tenant-id> --reason <change-ticket> --confirm --format json',
  ],
  'eai app list': [
    'eai app list --tenant-id <tenant-id> --limit 50 --format json',
  ],
  'eai app create': [
    'eai app create <name> --tenant-id <tenant-id> --key <app-key> --template eai-app-template --source eai-cli --app-url https://example.invalid --status pending --format json',
    'eai app create <name> --tenant-id <tenant-id> --parent-tenant <tenant-id> --child-tenant <child-name> --child-tenant-slug <child-slug> --key <app-key> --format json',
  ],
  'eai app connect-existing': [
    'eai app connect-existing <app-key> --tenant-id <tenant-id> --repo <owner/repo> --repo-url https://github.com/<owner>/<repo> --branch main --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config src/eai.config/index.ts --runtime src/eai.runtime.ts --format json',
  ],
  'eai app adopt-observed': [
    'eai app adopt-observed <app-key> --tenant-id <tenant-id> --repo <owner/repo> --url https://app.example.test --environment production --branch main --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config src/eai.config/index.ts --runtime src/eai.runtime.ts --format json',
  ],
  'eai app workflow-setup': [
    'eai app workflow-setup <app-key> --tenant-id <tenant-id> --environment preview --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config-hash sha256:config --format json',
  ],
  'eai app workflow-evidence': [
    'eai app workflow-evidence <app-key> --tenant-id <tenant-id> --repo <owner/repo> --operation-id <operation-id> --nonce <nonce> --environment preview --branch main --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config-hash sha256:config --artifact-digest sha256:<artifact> --image-digest sha256:<image> --workflow-run-id <run-id> --github-oidc-token <token> --github-oidc-audience api://enterprise-ai-publicapi/source-unknown --format json',
  ],
  'eai app deploy-source-unknown': [
    'eai app deploy-source-unknown <app-key> --tenant-id <tenant-id> --operation-id <operation-id> --environment preview --repo <owner/repo> --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --workflow-run-id <run-id> --config-hash sha256:config --artifact-digest sha256:<artifact> --image-digest sha256:<image> --target-kind tenantinfra --release-channel preview --format json',
  ],
  'eai app deploy-source-unknown-status': [
    'eai app deploy-source-unknown-status <app-key> --tenant-id <tenant-id> --format json',
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
    'EAI_E2E_PROVISION_ENTRA=1 EAI_E2E_CLEANUP=1 eai provision entra --deauthorize --client-id <client-id> --force --debug',
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
  'eai types validate': {
    '--tenant-id': 'Optional tenant-aware storage binding validation is covered explicitly so app-owned table prefixes can be checked before publish.',
    '--tenant-key': 'Optional app/tenant binding validation is covered explicitly so scaffolded app-owned storage names can be checked before publish.',
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
  'eai tenant delete': {
    '--force-hard-purge': 'Permanent subtree purge; covered by command/API contract tests and intentionally excluded from release smoke cleanup.',
  },
  'eai user invite': {
    '--role-definition-id': 'Custom role definition assignment is contract-tested; release smoke uses canonical base roles for portability.',
  },
  'eai user role set': {
    '--member-id': 'Direct member-id role update is contract-tested; release smoke uses email-based assignment to cover existing and new user flows consistently.',
  },
  'eai resources list': {
    '--cursor': 'Cursor is data-dependent; pagination is covered through page/limit and cursor remains contract-documented.',
  },
  'eai resources indexes-plan': {
    '--object-type': 'Optional published Object Type scope; default smoke plans the tenant-wide validated set without applying changes.',
  },
  'eai resources indexes-apply': {
    '--object-type': 'Optional published Object Type scope; apply is confirmation-gated and disabled in default release smoke.',
  },
  'eai resources cache-refresh': {
    '--object-type': 'Optional Object Type scope; system-admin refresh is reasoned and disabled in default release smoke.',
  },
  'eai app provision': {
    '--rebuild-search': 'Potentially expensive search rebuild; left as explicit opt-in outside release smoke.',
    '--skip-validate': 'Negative validation bypass; not used in release smoke because the smoke should prove normal validation works.',
  },
  'eai app connect-existing': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
  },
  'eai app adopt-observed': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
    '--repo-url': 'Only needed when the canonical repo URL differs from GitHub owner/name; command integration tests cover the payload contract.',
    '--deployment-id': 'Observed deployment identifier is platform/runtime specific; mocked command coverage proves it is forwarded.',
    '--image-digest': 'Observed image digest is optional until managed redeploy evidence exists; mocked command coverage proves it is forwarded.',
    '--config-hash': 'Observed config hash is optional until managed redeploy evidence exists; mocked command coverage proves it is forwarded.',
    '--observed-at': 'Observation timestamp defaults to now; mocked command coverage pins it for deterministic evidence.',
  },
  'eai app workflow-setup': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
  },
  'eai app workflow-evidence': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
    '--branch': 'Default branch is main in the smoke example; branch/ref alternatives are covered by command integration tests.',
    '--workflow': 'Default workflow path is used in the smoke example; path forwarding is covered by command integration tests.',
    '--ref': 'Ref defaults from branch in the smoke example; explicit ref forwarding is covered by command integration tests.',
    '--workflow-run-attempt': 'Workflow run attempt is optional and platform-run specific; command integration tests cover forwarding.',
  },
  'eai app deploy-source-unknown': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
  },
  'eai app deploy-source-unknown-status': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
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
    '--deauthorize': 'Cleanup mode; covered when EAI_E2E_PROVISION_ENTRA=1 and EAI_E2E_CLEANUP is not 0.',
    '--client-id': 'Cleanup can target the smoke-created client id read back from .env.local.',
    '--keep-registration': 'Support/diagnostic mode; smoke deletes registrations so app cleanup is complete.',
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
  '--template-version': 'Schema provenance is covered by mocked source-unknown command tests; live smoke avoids overwriting source metadata.',
  '--base-template-sha': 'Schema provenance is covered by mocked source-unknown command tests; live smoke avoids overwriting source metadata.',
  '--approved-source-sha': 'Source-unknown provenance is covered by mocked command tests; live smoke does not bind arbitrary source approvals.',
  '--approved-release': 'Source-unknown provenance release binding is covered by mocked command tests; live smoke does not bind arbitrary source approvals.',
  '--schema-digest': 'Schema digest validation is covered by mocked source-unknown command tests; live smoke avoids source metadata mutation.',
  '--validator-digest': 'Validator digest validation is covered by mocked source-unknown command tests; live smoke avoids source metadata mutation.',
};

const DEFAULT_ARTIFACT_CLEANUP = {
  createsExternalArtifact: 'No',
  cleanupMechanism: 'Not required',
  cleanupVerified: 'Yes - read/check command',
};

const ARTIFACT_CLEANUP = {
  'eai init': {
    createsExternalArtifact: 'Yes - app binding and local workspace',
    cleanupMechanism: 'Disposable local workspace retained for evidence; no app delete command in default smoke',
    cleanupVerified: 'Partial - summary records workspace path',
  },
  'eai env push': {
    createsExternalArtifact: 'Yes - cloud env/config value',
    cleanupMechanism: 'Opt-in only; caller owns reverting the selected key',
    cleanupVerified: 'No - disabled by default',
  },
  'eai types seed': {
    createsExternalArtifact: 'Yes - Object Type metadata',
    cleanupMechanism: 'No Object Type delete/deprovision command yet; use dedicated smoke tenant',
    cleanupVerified: 'No - cleanup gap documented',
  },
  'eai tenant create': {
    createsExternalArtifact: 'Yes - child tenant',
    cleanupMechanism: 'eai tenant delete <child-tenant-id> --force',
    cleanupVerified: 'Yes when EAI_E2E_CREATE_CHILD_TENANT=1 and cleanup succeeds',
  },
  'eai tenant bootstrap-admin': {
    createsExternalArtifact: 'Yes - membership/role assignment',
    cleanupMechanism: 'Child tenant deletion when smoke created the child tenant',
    cleanupVerified: 'Yes when child-tenant cleanup is enabled',
  },
  'eai tenant delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created child tenant',
    cleanupVerified: 'Yes when command returns success',
  },
  'eai user invite': {
    createsExternalArtifact: 'Yes - user invite/membership',
    cleanupMechanism: 'Child tenant deletion when EAI_E2E_CREATE_CHILD_TENANT=1; otherwise opt-in caller owns membership cleanup',
    cleanupVerified: 'Yes when invite targets a smoke-created child tenant; otherwise no',
  },
  'eai user role set': {
    createsExternalArtifact: 'Yes - user invite/membership or role update',
    cleanupMechanism: 'Same cleanup model as eai user invite',
    cleanupVerified: 'Yes when targeting a smoke-created child tenant; otherwise no',
  },
  'eai user provision-me': {
    createsExternalArtifact: 'Yes - current-user membership if missing',
    cleanupMechanism: 'Dedicated test user/tenant retains membership',
    cleanupVerified: 'Partial - membership is re-read by later checks',
  },
  'eai resources batch-create': {
    createsExternalArtifact: 'Yes - ResourceAPI rows',
    cleanupMechanism: 'eai resources batch-delete and per-resource delete fallback',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources batch-import': {
    createsExternalArtifact: 'Yes - ResourceAPI rows, audit history, and async projection work',
    cleanupMechanism: 'eai resources batch-delete and per-resource delete fallback',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources batch-update': {
    createsExternalArtifact: 'Updates ResourceAPI rows',
    cleanupMechanism: 'Rows deleted after smoke',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources batch-delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created batch rows',
    cleanupVerified: 'Yes when command returns success',
  },
  'eai resources create': {
    createsExternalArtifact: 'Yes - ResourceAPI rows/files/search documents',
    cleanupMechanism: 'eai resources delete and eai resources file delete',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources update': {
    createsExternalArtifact: 'Updates ResourceAPI rows',
    cleanupMechanism: 'Rows deleted after smoke',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created resources',
    cleanupVerified: 'Yes when command returns success',
  },
  'eai resources file upload': {
    createsExternalArtifact: 'Yes - blob/file attachment',
    cleanupMechanism: 'eai resources file delete, then resource delete',
    cleanupVerified: 'Yes when cleanup is enabled',
  },
  'eai resources file delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created blob/file attachment',
    cleanupVerified: 'Yes when command returns success',
  },
  'eai resources sync-schema': {
    createsExternalArtifact: 'Yes when EAI_E2E_SYNC_SCHEMA_APPLY=1',
    cleanupMechanism: 'No ResourceAPI physical schema cleanup yet; non-dry-run is opt-in',
    cleanupVerified: 'No - destructive apply disabled by default',
  },
  'eai resources performance-status': {
    createsExternalArtifact: 'No - bounded status read',
    cleanupMechanism: 'Not required',
    cleanupVerified: 'Yes - read/check command',
  },
  'eai resources indexes-plan': {
    createsExternalArtifact: 'No - dry-run plan only',
    cleanupMechanism: 'Not required',
    cleanupVerified: 'Yes - no mutation applied',
  },
  'eai resources indexes-apply': {
    createsExternalArtifact: 'Yes - validated tenant-scoped storage indexes',
    cleanupMechanism: 'Re-run the validated plan or revert the declared Object Type index metadata',
    cleanupVerified: 'No - live mutation disabled in default smoke',
  },
  'eai resources cache-refresh': {
    createsExternalArtifact: 'Yes - cache invalidation operation',
    cleanupMechanism: 'No rollback required; refresh is idempotent and scoped',
    cleanupVerified: 'No - system-admin mutation disabled in default smoke',
  },
  'eai app create': {
    createsExternalArtifact: 'Yes - app record',
    cleanupMechanism: 'Covered by eai init path; no default app delete command',
    cleanupVerified: 'No - dedicated smoke tenant expected',
  },
  'eai app connect-existing': {
    createsExternalArtifact: 'Updates app source metadata',
    cleanupMechanism: 'No source registration unlink command yet; command is covered by mocked integration tests',
    cleanupVerified: 'No - live smoke does not mutate source metadata',
  },
  'eai app adopt-observed': {
    createsExternalArtifact: 'Updates app source metadata and observed deployment status',
    cleanupMechanism: 'No observed-adoption unlink command yet; command is covered by mocked integration tests',
    cleanupVerified: 'No - live smoke does not mutate observed source metadata',
  },
  'eai app workflow-setup': {
    createsExternalArtifact: 'Issues source-unknown workflow operation and nonce metadata',
    cleanupMechanism: 'Operation expires; command is covered by mocked integration tests',
    cleanupVerified: 'No - live smoke does not issue nonce state',
  },
  'eai app workflow-evidence': {
    createsExternalArtifact: 'Consumes source-unknown workflow operation and records evidence metadata',
    cleanupMechanism: 'No evidence delete command yet; command is covered by mocked integration tests',
    cleanupVerified: 'No - live smoke does not consume nonce state',
  },
  'eai app deploy-source-unknown': {
    createsExternalArtifact: 'Records source-unknown deployment handoff metadata',
    cleanupMechanism: 'No deployment handoff delete command yet; command is covered by mocked integration tests',
    cleanupVerified: 'No - live smoke does not record deployment handoff state',
  },
  'eai app deploy-source-unknown-status': {
    createsExternalArtifact: 'No - reads latest source-unknown deployment handoff metadata',
    cleanupMechanism: 'No cleanup required for read-only status',
    cleanupVerified: 'Yes - read-only',
  },
  'eai app provision': {
    createsExternalArtifact: 'Yes - app storage/provisioning metadata',
    cleanupMechanism: 'No app storage deprovision command yet; dedicated smoke tenant expected',
    cleanupVerified: 'No - cleanup gap documented',
  },
  'eai chat send': {
    createsExternalArtifact: 'Yes - chat/workflow conversation',
    cleanupMechanism: 'Optional workflow smoke only; no default cleanup',
    cleanupVerified: 'No - disabled by default',
  },
  'eai workflow provision': {
    createsExternalArtifact: 'Yes - workflow runtime/binding metadata',
    cleanupMechanism: 'Opt-in only; caller owns cleanup',
    cleanupVerified: 'No - disabled by default',
  },
  'eai workflow request': {
    createsExternalArtifact: 'Yes - workflow request',
    cleanupMechanism: 'Opt-in only; no default request cleanup',
    cleanupVerified: 'No - disabled by default',
  },
  'eai docs upload': {
    createsExternalArtifact: 'Yes - document asset',
    cleanupMechanism: 'Opt-in only; no default document cleanup command',
    cleanupVerified: 'No - disabled by default',
  },
  'eai docs classify': {
    createsExternalArtifact: 'May create classification result',
    cleanupMechanism: 'Tied to optional document artifact cleanup gap',
    cleanupVerified: 'No - disabled by default',
  },
  'eai docs index': {
    createsExternalArtifact: 'May create search/index artifact',
    cleanupMechanism: 'Tied to optional document artifact cleanup gap',
    cleanupVerified: 'No - disabled by default',
  },
  'eai deploy setup': {
    createsExternalArtifact: 'Creates local deployment workflow files',
    cleanupMechanism: 'Disposable workspace retained for evidence',
    cleanupVerified: 'Partial - workspace summary records path',
  },
  'eai deploy trigger': {
    createsExternalArtifact: 'Yes - host deployment run',
    cleanupMechanism: 'Manual only; not run by release smoke',
    cleanupVerified: 'No - disabled by default',
  },
  'eai provision entra': {
    createsExternalArtifact: 'Yes when EAI_E2E_PROVISION_ENTRA=1 - Entra app registration and tenant allowlist entry',
    cleanupMechanism: 'eai provision entra --deauthorize --client-id <client-id> --force',
    cleanupVerified: 'Yes when optional provisioning and cleanup both run successfully',
  },
  'eai provision resourceapi-refresh': {
    createsExternalArtifact: 'May update passive install registry/schema snapshot',
    cleanupMechanism: 'Dry-run by default; apply is opt-in',
    cleanupVerified: 'No for apply; disabled by default',
  },
  'eai provision storage': {
    createsExternalArtifact: 'Yes - tenant storage provisioning metadata/resources',
    cleanupMechanism: 'No tenant storage deprovision command yet; dedicated smoke tenant expected',
    cleanupVerified: 'No - cleanup gap documented',
  },
  'eai provision resourceapi-bundle': {
    createsExternalArtifact: 'Creates local bundle file only by default',
    cleanupMechanism: 'Disposable workspace retained for evidence',
    cleanupVerified: 'Partial - local workspace retained',
  },
  'eai gofer refresh': {
    createsExternalArtifact: 'May update local Gofer-managed assets',
    cleanupMechanism: 'Check mode by default in smoke',
    cleanupVerified: 'Yes - no mutation in default smoke',
  },
};

const TRACEABILITY = TRACEABILITY_BASE.map(([command, crud, coverage, notes]) => ({
  command,
  crud,
  coverage,
  notes,
  calls: SMOKE_CALLS[command] || [],
  optionDecisions: OPTION_DECISIONS[command] || {},
  ...((ARTIFACT_CLEANUP[command] || DEFAULT_ARTIFACT_CLEANUP)),
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
  EAI_E2E_INVITE_TEST_USER      Optional invite target email for membership/role smoke
  EAI_E2E_INVITE_ROLE           Optional invite role. Default: tenant-viewer
  EAI_E2E_INVITE_FIRST_NAME     Optional invite first name
  EAI_E2E_INVITE_LAST_NAME      Optional invite last name
  EAI_E2E_INVITE_MESSAGE        Optional invite message
  EAI_E2E_INVITE_REDIRECT_URI   Optional invite redirect URI
  EAI_E2E_NEGATIVE_TESTS        Run non-mutating negative path checks. Default: 0
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

| Command | Alias surface | CRUD / operation | Release coverage | Creates external/platform artifact? | Cleanup mechanism | Cleanup verified? | Smoke calls / options | Deferred options | Traceability note |
| ------- | ------------- | ---------------- | ---------------- | ----------------------------------- | ----------------- | ----------------- | --------------------- | ---------------- | ----------------- |
${rows.map((row) => {
  const entry = entryByCommand.get(row.command) || { aliases: [], options: [] };
  const coverage = optionCoverage(row, entry);
  return `| \`${row.command}\` | ${markdownList(entry.aliases.map((alias) => `\`${alias}\``))} | ${row.crud} | ${row.coverage} | ${markdownCell(row.createsExternalArtifact)} | ${markdownCell(row.cleanupMechanism)} | ${markdownCell(row.cleanupVerified)} | ${markdownList(row.calls.map((call) => `\`${call}\``))} | ${markdownList(coverage.deferred)} | ${row.notes} |`;
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
  const missingArtifactCleanup = TRACEABILITY
    .filter((row) => !row.createsExternalArtifact || !row.cleanupMechanism || !row.cleanupVerified)
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
  if (missingArtifactCleanup.length) failures.push(`Missing artifact cleanup traceability:\n  - ${missingArtifactCleanup.join('\n  - ')}`);
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
    || payload.tenant?.id
    || payload.resource?.id
    || payload.body?.id
    || payload.body?.tenant?.id
    || payload.doc?.id
    || payload.data?.id
    || payload.created?.id
    || '';
}

function createJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readEnvValue(projectRoot, key) {
  const envPath = join(projectRoot, '.env.local');
  if (!existsSync(envPath)) return '';
  const prefix = `${key}=`;
  const exportPrefix = `export ${key}=`;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
    if (line.startsWith(exportPrefix)) return line.slice(exportPrefix.length).trim();
  }
  return '';
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function expectEaiFailure(eai, args, label, options = {}) {
  const result = eai(args, { ...options, allowFailure: true });
  if (result.status === 0) {
    throw new Error(`Negative smoke unexpectedly succeeded: ${label}`);
  }
  return result;
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
  const applyStorageSchema = process.env.EAI_E2E_SYNC_SCHEMA_APPLY === '1';
  let provisionedEntraClientId = '';
  let childTenantId = '';

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
  const currentIdentity = parseJson(
    eai(['publicapi', 'get', '/v4/identity/me', '--tenant-id', parentTenantId, '--format', 'json'], { cwd: ROOT }).stdout,
    {},
  );
  const currentOid = currentIdentity.body?.oid || currentIdentity.oid || '';
  const currentEmail = currentIdentity.body?.email || currentIdentity.email || expectedUsername || '';

  if (process.env.EAI_E2E_CREATE_CHILD_TENANT === '1') {
    const childName = `EAI E2E Smoke ${runId}`;
    const childSlug = `eai-e2e-smoke-${runId}`.toLowerCase();
    const childRegion = process.env.EAI_E2E_CHILD_HOME_REGION || process.env.EAI_E2E_HOME_REGION || 'au';
    const childCreate = parseJson(eai([
      'tenant',
      'create',
      '--name',
      childName,
      '--slug',
      childSlug,
      '--parent',
      parentTenantId,
      '--domain',
      `${childSlug}.example.invalid`,
      '--usecase',
      'generic',
      '--industry',
      'test',
      '--starter-template',
      'eai-app-template',
      '--home-region',
      childRegion,
      '--format',
      'json',
    ], { cwd: ROOT }).stdout, {});
    childTenantId = extractId(childCreate) || childCreate.tenantId || childCreate.body?.tenantId || '';
    if (!childTenantId) {
      throw new Error('Child tenant smoke did not return a tenant id.');
    }
    if (currentOid) {
      eai([
        'tenant',
        'bootstrap-admin',
        '--parent',
        parentTenantId,
        '--child',
        childTenantId,
        '--user-oid',
        currentOid,
        ...(currentEmail ? ['--user-email', currentEmail] : []),
        '--format',
        'json',
      ], { cwd: ROOT });
    }
  }

  eai(['init', appName, '--skip-prompts', '--current-dir', '--company-tenant', parentTenantId]);
  eai(['user', 'provision-me', '--tenant', parentTenantId]);
  eai(['user', 'roles', '--tenant', parentTenantId, '--format', 'json']);
  eai([
    'user',
    'list',
    '--tenant',
    parentTenantId,
    '--search',
    currentEmail || expectedUsername || 'smoke@example.invalid',
    '--page',
    '1',
    '--limit',
    '25',
    '--sort',
    'email',
    '--format',
    'json',
  ]);
  if (process.env.EAI_E2E_INVITE_TEST_USER) {
    eai([
      'user',
      'invite',
      '--email',
      process.env.EAI_E2E_INVITE_TEST_USER,
      '--tenant',
      childTenantId || parentTenantId,
      '--role',
      process.env.EAI_E2E_INVITE_ROLE || 'tenant-viewer',
      ...(process.env.EAI_E2E_INVITE_FIRST_NAME ? ['--first-name', process.env.EAI_E2E_INVITE_FIRST_NAME] : []),
      ...(process.env.EAI_E2E_INVITE_LAST_NAME ? ['--last-name', process.env.EAI_E2E_INVITE_LAST_NAME] : []),
      ...(process.env.EAI_E2E_INVITE_MESSAGE ? ['--message', process.env.EAI_E2E_INVITE_MESSAGE] : []),
      ...(process.env.EAI_E2E_INVITE_REDIRECT_URI ? ['--redirect-uri', process.env.EAI_E2E_INVITE_REDIRECT_URI] : []),
      '--format',
      'json',
    ]);
    eai([
      'user',
      'role',
      'set',
      '--email',
      process.env.EAI_E2E_INVITE_TEST_USER,
      '--tenant',
      childTenantId || parentTenantId,
      '--role',
      process.env.EAI_E2E_INVITE_ROLE || 'tenant-viewer',
      '--format',
      'json',
    ]);
  }
  if (process.env.EAI_E2E_NEGATIVE_TESTS === '1') {
    expectEaiFailure(
      eai,
      ['user', 'invite', '--email', 'not-an-email', '--tenant', parentTenantId, '--role', 'tenant-viewer', '--format', 'json'],
      'invalid user invite email',
    );
    expectEaiFailure(
      eai,
      [
        'publicapi',
        'post',
        `/v4/platform/tenants/${parentTenantId}/members/invite`,
        '--tenant-id',
        parentTenantId,
        '--data',
        '{}',
        '--format',
        'json',
      ],
      'missing member invite payload fields',
    );
  }
  eai(['runtime', 'validate', '--format', 'json']);
  eai(['template', 'check', '--format', 'json']);
  eai(['gofer', 'refresh', '--check', '--format', 'json']);
  eai(['deploy', 'env', '--provider', 'generic', '--format', 'json']);
  eai(['deploy', 'setup']);
  eai(['env', 'list', '--format', 'json']);
  if (process.env.EAI_E2E_PROVISION_ENTRA === '1') {
    eai([
      'provision',
      'entra',
      '--force',
      '--redirect-uri',
      `http://localhost:3000/api/auth/callback/microsoft-entra-id`,
      '--debug',
    ]);
    provisionedEntraClientId = readEnvValue(projectRoot, 'ENTRA_CLIENT_ID');
    if (process.env.EAI_E2E_ROTATE_ENTRA_SECRET === '1') {
      eai(['provision', 'entra', '--rotate-secret', '--debug']);
    }
  }
  eai(['app', 'list', '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['app', 'select', appName, '--tenant-id', parentTenantId, '--format', 'json']);
  eai(['app', 'provision', appName, '--tenant-id', parentTenantId, '--select', '--format', 'json']);
  eai(['provision', 'storage', '--tenant-id', parentTenantId, '--format', 'json']);

  writeSmokeObjectTypes(projectRoot, appName, runId, parentTenantId);
  const bundleSchema = join(projectRoot, 'smoke-object-types.json');
  createJsonFile(bundleSchema, { objectTypes: smokeObjectTypes(appName, runId, parentTenantId) });
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
  eai(['resources', 'sync-schema', '--tenant-id', parentTenantId, '--backend', 'documentdb', '--dry-run', '--format', 'json']);
  if (applyStorageSchema) {
    eai(['resources', 'sync-schema', '--tenant-id', parentTenantId, '--format', 'json']);
  } else {
    console.log('[e2e] Skipping ResourceAPI schema apply and CRUD; set EAI_E2E_SYNC_SCHEMA_APPLY=1 for destructive storage smoke.');
  }
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

  let batchIds = [];
  if (applyStorageSchema) {
    const pgId = createResource(eai, parentTenantId, pgType, { title: 'postgres smoke', status: 'draft', count: 1 });
    createdResources.push([pgType, pgId]);
    eai(['resources', 'get', pgType, pgId, '--tenant-id', parentTenantId, '--format', 'json']);
    eai(['resources', 'update', pgType, pgId, '--tenant-id', parentTenantId, '--data', JSON.stringify({ title: 'postgres smoke updated', status: 'updated', count: 2 }), '--format', 'json']);

    const docId = createResource(eai, parentTenantId, docType, { title: 'documentdb smoke', status: 'draft' });
    createdResources.push([docType, docId]);
    eai(['resources', 'get', docType, docId, '--tenant-id', parentTenantId, '--format', 'json']);
    eai(['resources', 'update', docType, docId, '--tenant-id', parentTenantId, '--data', JSON.stringify({ title: 'documentdb smoke updated', status: 'updated' }), '--format', 'json']);

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
    batchIds = (batchCreate.results || batchCreate.resources || batchCreate.created || batchCreate.items || [])
      .map((item) => item.id || item.resource?.id)
      .filter(Boolean);
    const batchImportFile = join(projectRoot, 'batch-import.json');
    createJsonFile(batchImportFile, [
      { title: 'batch import smoke one', status: 'draft', count: 30 },
      { title: 'batch import smoke two', status: 'draft', count: 40 },
    ]);
    const batchImport = parseJson(eai(['resources', 'batch-import', pgType, '--tenant-id', parentTenantId, '--file', batchImportFile, '--projection-mode', 'deferred', '--format', 'json']).stdout, {});
    const batchImportIds = (batchImport.results || batchImport.resources || batchImport.created || batchImport.items || [])
      .map((item) => item.id || item.resource?.id)
      .filter(Boolean);
    batchIds.push(...batchImportIds);
    if (batchIds.length) {
      const batchUpdateFile = join(projectRoot, 'batch-update.json');
      createJsonFile(batchUpdateFile, batchIds.map((id, index) => ({
        id,
        version: 1,
        data: { title: `batch smoke ${index + 1} updated`, status: 'batch-updated', count: index === 0 ? 10 : 20 },
      })));
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
      JSON.stringify({ total: { function: 'count' } }),
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
  }

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
    const cleanupFailures = [];
    if (batchIds.length) {
      const batchDeleteFile = join(projectRoot, 'batch-delete.json');
      createJsonFile(batchDeleteFile, batchIds.map((id) => ({ id })));
      const batchDelete = eai(['resources', 'batch-delete', pgType, '--tenant-id', parentTenantId, '--file', batchDeleteFile, '--force', '--format', 'json'], { allowFailure: true });
      if (batchDelete.status !== 0) {
        cleanupFailures.push('eai resources batch-delete failed');
        for (const id of batchIds) {
          eai(['resources', 'delete', pgType, id, '--tenant-id', parentTenantId, '--force', '--format', 'json'], { allowFailure: true });
        }
      }
    }
    for (const [type, id] of createdResources.reverse()) {
      eai(['resources', 'delete', type, id, '--tenant-id', parentTenantId, '--force', '--format', 'json'], { allowFailure: true });
    }
    if (provisionedEntraClientId) {
      eai(['provision', 'entra', '--deauthorize', '--client-id', provisionedEntraClientId, '--force', '--debug'], { allowFailure: true });
    }
    if (childTenantId) {
      eai(['tenant', 'delete', childTenantId, '--force', '--format', 'json'], { cwd: ROOT, allowFailure: true });
    }
    if (cleanupFailures.length) {
      throw new Error(cleanupFailures.join('; '));
    }
  }

  writeFileSync(join(projectRoot, 'summary.json'), `${JSON.stringify({ runId, profile, parentTenantId, childTenantId, projectRoot, summary }, null, 2)}\n`, 'utf8');
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

function tenantStorageScope(tenantId) {
  const scope = String(tenantId || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(-12) || 'tenant';
  return /^[a-z]/.test(scope) ? scope : `t${scope}`;
}

function storageNamePrefix(parts, separator = '_') {
  const replacement = separator === '-' ? '-' : '_';
  return parts
    .map((part) => String(part || '').toLowerCase().replace(/-/g, separator))
    .join(separator)
    .replace(/[^a-z0-9_-]+/g, replacement)
    .replace(/^[_-]+|[_-]+$/g, '');
}

function writeSmokeObjectTypes(projectRoot, appName, runId, tenantId) {
  const typeFile = join(projectRoot, 'src', 'eai.config', 'object-types.ts');
  const definitions = smokeObjectTypes(appName, runId, tenantId);
  const content = `export const objectTypes = {
  '${appName}': ${JSON.stringify(definitions, null, 4)},
};
`;
  writeFileSync(typeFile, content, 'utf8');
}

function smokeObjectTypes(appName, runId, tenantId) {
  const tenantScope = tenantStorageScope(tenantId);
  const sqlPrefix = `${storageNamePrefix([tenantScope, appName], '_')}_`;
  const blobPrefix = `${storageNamePrefix([tenantScope, appName], '-')}-`;
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
        sql: {
          databaseAlias: 'tenant-postgres',
          tenantSchemaStrategy: 'per-tenant-schema',
          tableName: `${sqlPrefix}pg_${runId}`,
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
          collectionName: `${sqlPrefix}doc_${runId}`,
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
          collectionName: `${sqlPrefix}file_${runId}`,
          partitionKey: '/tenantId',
        },
        blob: {
          storageAccountAlias: 'tenant-blob',
          containerName: `${blobPrefix}file-${runId}`,
          pathPrefix: `${appName}/file/${runId}`,
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
        { name: 'body', type: 'text', required: true, indexed: true, searchable: true },
        { name: 'status', type: 'text', required: true, indexed: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: `${sqlPrefix}search_${runId}`,
          partitionKey: '/tenantId',
        },
        search: {
          searchServiceAlias: 'tenant-search',
          indexName: `${blobPrefix}search-${runId}`,
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
