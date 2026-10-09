#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('node:child_process');
const { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { basename, dirname, join, relative, resolve, sep } = require('node:path');
const ts = require('typescript');

const ROOT = resolve(__dirname, '..');
const DEFAULT_CLI = join(ROOT, 'dist', 'index.js');
const TRACEABILITY_DOC = join(ROOT, '.tech-docs', 'full-e2e-smoke-traceability.md');

const TRACEABILITY_BASE = [
  ['eai init', 'create-local', 'live', 'Scaffolds a disposable workspace bound to the exact app already created in the fresh child.'],
  ['eai start', 'read/launch-local', 'live', 'Detects supported local AI workspaces in release smoke; provider launch remains user-confirmed.'],
  ['eai create', 'create', 'help', 'Guided first-run wrapper is covered by focused onboarding tests and help/contract checks; release live smoke uses the non-interactive eai init path to avoid browser auth.'],
  ['eai dev', 'read', 'help', 'Runtime server command is validated by help/contract checks; live release smoke does not start a long-running dev server.'],
  ['eai login', 'auth-create', 'external-auth', 'Browser PKCE is validated by the dedicated test profile; non-interactive password grant is intentionally not added.'],
  ['eai logout', 'auth-delete', 'manual', 'Not run in live smoke because it would destroy the authenticated test profile used by later checks.'],
  ['eai env pull', 'read', 'covered-by-cli', 'Controlled command tests; live runner blocks env mutations until an isolated config fixture and teardown exist.'],
  ['eai env list', 'read', 'live', 'Reads local project env after scaffold.'],
  ['eai env push', 'update', 'covered-by-cli', 'Controlled command tests; live runner blocks env mutations until an isolated config fixture and teardown exist.'],
  ['eai types seed', 'create/update', 'live', 'Publishes PostgreSQL, DocumentDB, Blob, and Search smoke Object Types.'],
  ['eai types validate', 'read', 'live', 'Validates local Object Types before publishing.'],
  ['eai types diff', 'read', 'live', 'Compares local and remote Object Types after seed.'],
  ['eai types pull', 'read', 'live', 'Downloads remote Object Types into the disposable workspace.'],
  ['eai types define', 'create', 'unsupported', 'Explicit unsupported error is covered by owning CLI tests; it exits nonzero before authentication or network access.'],
  ['eai workspace storage list', 'read', 'live', 'Lists published storage bindings for the test workspace.'],
  ['eai workspace storage verify', 'read', 'live', 'Verifies workspace storage readiness after sync.'],
  ['eai workspace list', 'read', 'live', 'Resolves the dedicated parent test workspace.'],
  ['eai workspace select', 'update-local', 'live', 'Selects the dedicated test workspace/profile context.'],
  ['eai workspace info', 'read', 'live', 'Reads selected test workspace details.'],
  ['eai workspace create', 'create', 'live', 'Always creates a fresh child under the explicit QA parent; never adopts the active or first tenant.'],
  ['eai workspace bootstrap-admin', 'create/update', 'live', 'Bootstraps the exact QA actor in the run-created child.'],
  ['eai workspace delete', 'delete', 'live', 'Always cleans up the run-created child in finally, requiring hard-purge receipt and complete authorized parent child-inventory absence.'],
  ['eai user invite', 'create/update', 'live-optional', 'Runs only when EAI_E2E_INVITE_TEST_USER is set.'],
  ['eai user list', 'read', 'live', 'Verifies workspace membership visibility after invite/provision flows.'],
  ['eai user roles', 'read', 'live', 'Discovers assignable workspace roles before invite.'],
  ['eai user role set', 'create/update', 'live-optional', 'Runs only when EAI_E2E_INVITE_TEST_USER is set; email-based assignment uses the V4 invite/add flow.'],
  ['eai user provision-me', 'create/update', 'live', 'Ensures the authenticated test user is provisioned to the test workspace.'],
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
  ['eai resources query', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1; queries compatible backend placements separately and verifies exact run-created rows and persisted data.'],
  ['eai resources storage status', 'read', 'live', 'Checks routing and provisioning status.'],
  ['eai resources storage doctor', 'read', 'live', 'Checks storage health/capabilities before search assertions.'],
  ['eai resources search', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after indexing a smoke resource.'],
  ['eai resources file upload', 'create/update', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 and is cleaned up by file/resource delete.'],
  ['eai resources file get', 'read', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 after file upload.'],
  ['eai resources file delete', 'delete', 'live-optional', 'Runs when EAI_E2E_SYNC_SCHEMA_APPLY=1 during cleanup.'],
  ['eai resources schema', 'read', 'live', 'Verifies published Object Types are visible through resource schema.'],
  ['eai resources sync-schema', 'create/update', 'live-optional', 'Dry-run always runs; EAI_E2E_SYNC_SCHEMA_APPLY=1 applies only within the disposable child, whose hard-purge receipt is required.'],
  ['eai resources doctor', 'read', 'live', 'Runs active tenant storage readiness diagnostics.'],
  ['eai resources performance-status', 'read', 'live', 'Reads bounded resource performance and schema readiness through the platform API.'],
  ['eai resources indexes-plan', 'read', 'live', 'Plans indexes for the exact run-published Object Type slugs.'],
  ['eai resources indexes-apply', 'create/update', 'unsupported', 'PublicAPI exposes dry-run index planning only; the CLI rejects apply before auth or HTTP.'],
  ['eai resources cache-refresh', 'create/update', 'covered-by-cli', 'Controlled command tests; platform-admin cache refresh is not executed by this runner.'],
  ['eai app list', 'read', 'live', 'Lists apps before and after scaffold.'],
  ['eai app auth status', 'read', 'live-optional', 'Reads app-client authorization when the smoke provisions an Entra registration.'],
  ['eai app create', 'create', 'live', 'Creates an app only in the run-created child; records exact creation flags and enrollment ID before scaffolding.'],
  ['eai app delete', 'delete', 'live', 'Finally requires an exact verified app deletion receipt and absence from the child app list.'],
  ['eai app connect-existing', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids overwriting source metadata on a dedicated tenant app.'],
  ['eai app adopt-observed', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids marking app infrastructure observed without a managed redeploy path.'],
  ['eai app workflow-setup', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids issuing one-time source-unknown nonce state.'],
  ['eai app workflow-evidence', 'update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids consuming source-unknown nonce state.'],
  ['eai app deploy-source-unknown', 'create/update', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids recording deployment handoff state before TenantInfra execution exists.'],
  ['eai app deploy-source-unknown-status', 'read', 'covered-by-cli', 'Command contract is covered by integration tests; live smoke avoids depending on a pre-existing deployment handoff.'],
  ['eai app select', 'update-local', 'live', 'Writes the app key into the disposable workspace env.'],
  ['eai app provision', 'create/update', 'live', 'Prepares platform storage for the smoke app.'],
  ['eai classifier delete', 'delete', 'covered-by-cli', 'Permanently removes only a disabled unpublished draft after exact classifier-key confirmation; command integration tests mock the API boundary.'],
  ['eai classifier disable', 'update', 'covered-by-cli', 'Reversibly disables classifier mutation, targeting, and runtime use while retaining immutable history; command integration tests mock the API boundary.'],
  ['eai classifier enable', 'update', 'covered-by-cli', 'Re-enables a disabled classifier at its prior draft or published lifecycle state; command integration tests mock the API boundary.'],
  ['eai classifier list', 'read', 'covered-by-cli', 'Lists tenant classifier drafts through the tenant-scoped ResourceAPI client.'],
  ['eai classifier save', 'create/update', 'covered-by-cli', 'Validates portable JSON and saves the mutable tenant-owned draft; command integration tests mock the API boundary.'],
  ['eai classifier publish', 'create/update', 'covered-by-cli', 'Publishes an immutable reusable version; command integration tests mock provider materialization.'],
  ['eai classifier target', 'create/update', 'covered-by-cli', 'Associates an exact published classifier version with an app workflow; command integration tests mock the API boundary.'],
  ['eai chat send', 'create/read', 'live-optional', 'EAI_E2E_CHAT=1 requires a run-provisioned workflow, EAI_E2E_AI_PROVIDER and EAI_E2E_AI_MODEL in the isolated runtime.'],
  ['eai chat stream', 'create/read', 'help', 'Interactive streaming is validated by help/contract; non-interactive chat send covers AI request path.'],
  ['eai workflow provision', 'create/update', 'live-optional', 'Runs when EAI_E2E_WORKFLOW_PROVISION=1 because workflow provisioning may require runtime/provider setup.'],
  ['eai workflow readiness', 'read', 'live', 'Checks workspace workflow readiness.'],
  ['eai workflow status', 'read', 'live-optional', 'Runs for the exact workflow created by EAI_E2E_WORKFLOW_PROVISION=1; failures are not ignored.'],
  ['eai workflow request', 'create', 'covered-by-cli', 'Controlled command tests; operator request creation has no verified run-owned teardown.'],
  ['eai docs upload', 'create', 'covered-by-cli', 'Controlled command tests only; optional lifecycle submits once through classify.'],
  ['eai docs classify', 'read/create', 'covered-by-cli', 'Controlled lifecycle helper tests use EAI_E2E_DOCS_TENANT_ID, EAI_E2E_DOCS_VERTICAL_KEY, EAI_E2E_DOCS_WORKFLOW_KEY, EAI_E2E_DOCS_FILE and EAI_E2E_DOCS_EXPECTED_TYPE. Full runner blocks EAI_E2E_DOCS=1 until a published business-document fixture can be created and verified in its isolated child.'],
  ['eai docs index', 'create/update', 'covered-by-cli', 'Controlled command tests only; indexing is not executed or claimed by the classification smoke.'],
  ['eai deploy app', 'create/update/read', 'live-optional', 'EAI_E2E_DEPLOY=1 publishes only the run-created app through EAI-managed source, requires exact successful deployment evidence and operation-bound doctor; actor proof or review pending is blocked.'],
  ['eai deploy source move', 'read/browser-handoff', 'manual', 'The CLI checks the exact active EAI-managed source and deployment, then opens the Portal for actor-bound native transfer. Controlled command tests cover the handoff; the local SOT journey owns live transfer, rebind and cleanup evidence.'],
  ['eai deploy source validate', 'read-local', 'live-optional', 'EAI_E2E_DEPLOY=1 validates local app source before managed publication; controlled fixtures cover supported edits and rejected platform edits.'],
  ['eai deploy setup', 'create-local', 'live', 'Generates deployment workflow in the disposable workspace.'],
  ['eai deploy trigger', 'create', 'manual', 'Not run by release smoke because it triggers a host deployment outside the CLI test tenant.'],
  ['eai deploy status', 'read', 'help', 'Validated by help/contract unless a deployment run id is provided.'],
  ['eai deploy env', 'read', 'live', 'Prints provider-neutral env/secret requirements.'],
  ['eai deploy doctor', 'read', 'live-optional', 'EAI_E2E_DEPLOY=1 runs doctor against this run\'s exact completed operation, never an arbitrary configured URL.'],
  ['eai runtime validate', 'read', 'live', 'Validates eai.runtime.json/local runtime declarations in the scaffolded app.'],
  ['eai verify', 'read', 'live', 'Runs the action-bearing verify parent command with the exact isolated runtime; failed checks must exit nonzero.'],
  ['eai verify storage', 'read', 'live', 'Verifies storage status and doctor contracts.'],
  ['eai verify calls', 'read', 'live', 'Audits platform-facing CLI call contracts.'],
  ['eai doctor', 'read', 'live', 'Runs diagnostics in the smoke workspace.'],
  ['eai whoami', 'read', 'live', 'Confirms dedicated test identity and active workspace context.'],
  ['eai update', 'read/update', 'check-only', 'Runs `update --check`; installing over the release candidate is not safe inside release smoke. Release preflight also runs update checks from the packed canonical and eai-cli alias install paths.'],
  ['eai provision entra', 'create/update/delete', 'live-optional', 'Runs only when EAI_E2E_PROVISION_ENTRA=1 because it creates/rotates/deletes app credentials.'],
  ['eai provision resourceapi-refresh', 'create/update', 'covered-by-cli', 'Controlled command tests; full runner blocks refresh until passive-install mutation teardown is owned.'],
  ['eai provision storage', 'create/update', 'live', 'Provisions storage for the active test workspace.'],
  ['eai provision resourceapi-bundle', 'create-local', 'live', 'Creates a customer-hosted storage schema bundle in the disposable workspace.'],
  ['eai gofer refresh', 'read/update-local', 'live', 'Runs check mode by default; apply mode can be enabled in disposable workspace.'],
  ['eai template check', 'read', 'live', 'Checks app template drift in the scaffolded app.'],
  ['eai blocks list', 'read', 'live', 'Lists block catalog.'],
  ['eai blocks describe', 'read', 'live', 'Describes the first available block.'],
  ['eai blocks readiness', 'read', 'live', 'Checks block public/package-profile readiness.'],
  ['eai blocks schema', 'read', 'live', 'Prints public block manifest schema.'],
  ['eai blocks validate', 'read', 'live', 'Validates installed block catalog metadata.'],
  ['eai publicapi get', 'read', 'live', 'Calls an authorized V4 read path directly for coverage.'],
  ['eai publicapi post', 'read/evaluate', 'live', 'Calls the read-only child-tenant capability evaluator before creation; arbitrary PublicAPI writes remain controlled-test coverage.'],
  ['eai publicapi patch', 'update', 'covered-by-cli', 'Prefer first-class CLI commands for writes; resource update covers the write path.'],
  ['eai publicapi put', 'update', 'covered-by-cli', 'Prefer first-class CLI commands for writes; no generic PUT smoke without a stable idempotent V4 endpoint.'],
  ['eai publicapi delete', 'delete', 'live-optional', 'EAI_E2E_PROVISION_ENTRA=1 verifies an idempotent registration deletion receipt scoped to the run-created runtime.'],
  ['eai errors list', 'read', 'live', 'Lists public-safe error guidance.'],
  ['eai errors explain', 'read', 'live', 'Explains a representative error code.'],
  ['eai support', 'create-draft', 'covered-by-cli', 'Owned local fixture tests verify redaction, human consent, saved-session auth, plain-link fallback and fragment handoff; deployed smoke never sends a customer report.'],
  ['eai agent guide', 'read', 'live', 'Shows AI-agent operating guide in JSON.'],
];

const SMOKE_CALLS = {
  'eai init': [
    'eai init <app-name> --app-key <run-created-app-key> --skip-prompts --current-dir --company-workspace <run-created-child-id> --package-profile external',
  ],
  'eai start': [
    'eai start --check --format json',
  ],
  'eai create': [
    'eai create <app-name> --help',
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
    'eai types seed --tenant-id <workspace-id> --tenant-key <app-name> --dry-run --format json',
    'eai types seed --tenant-id <workspace-id> --tenant-key <app-name> --format json',
  ],
  'eai types validate': [
    'eai types validate',
    'eai types validate --tenant-id <workspace-id> --tenant-key <app-name>',
  ],
  'eai types diff': [
    'eai types diff --tenant-id <workspace-id> --tenant-key <app-name> --format json',
  ],
  'eai types pull': [
    'eai types pull --tenant-id <workspace-id> --output src/eai.config/object-types.generated.ts',
  ],
  'eai types define': [
    'eai types define --help',
    'eai types define --format json',
  ],
  'eai workspace storage list': [
    'eai workspace storage list --format json',
  ],
  'eai workspace storage verify': [
    'eai workspace storage verify --format json',
  ],
  'eai workspace list': [
    'eai workspace list --parent <workspace-id> --all --debug --format json',
  ],
  'eai workspace select': [
    'eai workspace select <workspace-id>',
  ],
  'eai workspace info': [
    'eai workspace info <workspace-id> --format json',
  ],
  'eai workspace create': [
    'EAI_E2E_CREATE_CHILD_TENANT=1 eai workspace create --name <child-name> --slug <child-slug> --parent <workspace-id> --domain smoke.example.invalid --usecase generic --industry test --starter-template eai-app-template --home-region <region> --format json',
  ],
  'eai workspace bootstrap-admin': [
    'EAI_E2E_CREATE_CHILD_TENANT=1 eai workspace bootstrap-admin --parent <workspace-id> --child <child-tenant-id> --user-oid <oid> --user-email <email> --format json',
  ],
  'eai workspace delete': [
    'eai workspace delete <run-created-child-id> --parent <surviving-parent-id> --force --force-hard-purge --format json',
  ],
  'eai user invite': [
    'EAI_E2E_INVITE_TEST_USER=<email> eai user invite --email <email> --workspace <workspace-id> --role <role> --first-name <name> --last-name <name> --message <message> --redirect-uri <uri> --format json',
  ],
  'eai user list': [
    'eai user list --workspace <workspace-id> --search <email> --page 1 --limit 25 --sort email --format json',
  ],
  'eai user roles': [
    'eai user roles --workspace <workspace-id> --format json',
  ],
  'eai user role set': [
    'EAI_E2E_INVITE_TEST_USER=<email> eai user role set --email <email> --workspace <workspace-id> --role <role> --first-name <name> --last-name <name> --message <message> --redirect-uri <uri> --format json',
  ],
  'eai user provision-me': [
    'eai user provision-me --workspace <workspace-id> --format json',
  ],
  'eai resources list': [
    'eai resources list <object-type> --tenant-id <workspace-id> --page 1 --limit 20 --sort -created_at --where {"status":{"equals":"updated"}} --format json',
  ],
  'eai resources batch-create': [
    'eai resources batch-create <object-type> --tenant-id <workspace-id> --file batch-create.json --format json',
    'eai resources batch-create <object-type> --tenant-id <workspace-id> --data [{"title":"batch smoke"}] --format json',
  ],
  'eai resources batch-import': [
    'eai resources batch-import <object-type> --tenant-id <workspace-id> --file batch-import.json --projection-mode deferred --format json',
    'eai resources batch-import <object-type> --tenant-id <workspace-id> --data [{"title":"batch smoke"}] --format json',
  ],
  'eai resources batch-update': [
    'eai resources batch-update <object-type> --tenant-id <workspace-id> --file batch-update.json --format json',
    'eai resources batch-update <object-type> --tenant-id <workspace-id> --data [{"id":"<id>","version":1,"data":{"status":"updated"}}] --format json',
  ],
  'eai resources batch-delete': [
    'eai resources batch-delete <object-type> --tenant-id <workspace-id> --file batch-delete.json --force --format json',
    'eai resources batch-delete <object-type> --tenant-id <workspace-id> --ids <id1,id2> --force --format json',
    'eai resources batch-delete <object-type> --tenant-id <workspace-id> --data [{"id":"<id>"}] --force --format json',
  ],
  'eai resources aggregate': [
    'eai resources aggregate <object-type> --tenant-id <workspace-id> --group-by status --metrics {"total":{"function":"count"}} --where {"status":{"exists":true}} --limit 1000 --format json',
  ],
  'eai resources get': [
    'eai resources get <object-type> <resource-id> --tenant-id <workspace-id> --format json',
  ],
  'eai resources create': [
    'eai resources create <object-type> --tenant-id <workspace-id> --data {"title":"smoke"} --format json',
    'eai resources create <object-type> --tenant-id <workspace-id> --file resource.json --format json',
  ],
  'eai resources update': [
    'eai resources update <object-type> <resource-id> --tenant-id <workspace-id> --data {"title":"updated","status":"updated"} --version 1 --format json',
  ],
  'eai resources delete': [
    'eai resources delete <object-type> <resource-id> --tenant-id <workspace-id> --force --format json',
  ],
  'eai resources query': [
    'eai resources query --tenant-id <workspace-id> --types <type-a,type-b> --where {"status":{"exists":true}} --limit 20 --format json',
  ],
  'eai resources storage status': [
    'eai resources storage status --tenant-id <workspace-id> --format json',
  ],
  'eai resources storage doctor': [
    'eai resources storage doctor --tenant-id <workspace-id> --format json',
  ],
  'eai resources search': [
    'eai resources search <query> --tenant-id <workspace-id> --types <search-type> --mode fulltext --fulltext --limit 10 --format json',
    'eai resources search <query> --tenant-id <workspace-id> --types <search-type> --mode hybrid --hybrid --limit 10 --format json',
    'eai resources search <query> --tenant-id <workspace-id> --types <search-type> --mode vector --vector --limit 10 --format json',
  ],
  'eai resources file upload': [
    'eai resources file upload <object-type> <resource-id> attachment smoke-file.txt --tenant-id <workspace-id> --format json',
  ],
  'eai resources file get': [
    'eai resources file get <object-type> <resource-id> attachment --tenant-id <workspace-id> --output smoke-file-downloaded.txt',
  ],
  'eai resources file delete': [
    'eai resources file delete <object-type> <resource-id> attachment --tenant-id <workspace-id> --force --format json',
  ],
  'eai resources schema': [
    'eai resources schema --tenant-id <workspace-id> --format json',
  ],
  'eai resources sync-schema': [
    'eai resources sync-schema --tenant-id <workspace-id> --backend documentdb --dry-run --format json',
    'EAI_E2E_SYNC_SCHEMA_APPLY=1 eai resources sync-schema --tenant-id <workspace-id> --format json',
  ],
  'eai resources doctor': [
    'eai resources doctor --tenant-id <workspace-id> --format json',
  ],
  'eai resources performance-status': [
    'eai resources performance-status --tenant-id <workspace-id> --format json',
  ],
  'eai resources indexes-plan': [
    'eai resources indexes-plan --tenant-id <workspace-id> --object-type <published-slug> --format json',
  ],
  'eai resources indexes-apply': [
    'eai resources indexes-apply --tenant-id <workspace-id> --confirm --format json',
  ],
  'eai resources cache-refresh': [
    'eai resources cache-refresh --tenant-id <workspace-id> --reason <change-ticket> --confirm --format json',
  ],
  'eai app list': [
    'eai app list --tenant-id <workspace-id> --limit 50 --format json',
  ],
  'eai app auth status': [
    'EAI_E2E_PROVISION_ENTRA=1 eai app auth status <app-key> --tenant-id <workspace-id> --client-id <entra-client-id> --format json',
  ],
  'eai app create': [
    'eai app create <name> --tenant-id <workspace-id> --key <app-key> --template eai-app-template --source eai-cli --app-url https://example.invalid --status pending --format json',
    'eai app create <name> --tenant-id <workspace-id> --parent-tenant <workspace-id> --child-tenant <child-name> --child-tenant-slug <child-slug> --key <app-key> --format json',
  ],
  'eai app delete': [
    'eai app delete <app-key> --tenant-id <workspace-id> --confirm <app-key> --non-interactive --format json',
  ],
  'eai app connect-existing': [
    'eai app connect-existing <app-key> --tenant-id <workspace-id> --repo <owner/repo> --repo-url https://github.com/<owner>/<repo> --branch main --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config src/eai.config/index.ts --runtime src/eai.runtime.ts --format json',
  ],
  'eai app adopt-observed': [
    'eai app adopt-observed <app-key> --tenant-id <workspace-id> --repo <owner/repo> --url https://app.example.test --environment production --branch main --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config src/eai.config/index.ts --runtime src/eai.runtime.ts --format json',
  ],
  'eai app workflow-setup': [
    'eai app workflow-setup <app-key> --tenant-id <workspace-id> --environment preview --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --config-hash sha256:config --format json',
  ],
  'eai app workflow-evidence': [
    'eai app workflow-evidence <app-key> --tenant-id <workspace-id> --evidence-file <canonical-workflow-evidence.json> --github-oidc-token <token> --github-oidc-audience api://enterprise-ai-publicapi/source-unknown --format json',
  ],
  'eai app deploy-source-unknown': [
    'eai app deploy-source-unknown <app-key> --tenant-id <workspace-id> --operation-id <operation-id> --environment preview --repo <owner/repo> --workflow .github/workflows/eai-app.yml --ref refs/heads/main --commit <sha> --workflow-run-id <run-id> --config-hash sha256:config --artifact-digest sha256:<artifact> --image-digest sha256:<image> --target-kind tenantinfra --release-channel preview --format json',
  ],
  'eai app deploy-source-unknown-status': [
    'eai app deploy-source-unknown-status <app-key> --tenant-id <workspace-id> --format json',
  ],
  'eai app select': [
    'eai app select <app-key> --tenant-id <workspace-id> --skip-validate --format json',
  ],
  'eai app provision': [
    'eai app provision <app-key> --tenant-id <workspace-id> --backend all --dry-run --format json',
    'eai app provision <app-key> --tenant-id <workspace-id> --backend all --select --format json',
  ],
  'eai classifier delete': [
    'eai classifier delete <classifier-key> --confirm <classifier-key> --tenant-id <workspace-id> --format json',
  ],
  'eai classifier disable': [
    'eai classifier disable <classifier-key> --tenant-id <workspace-id> --format json',
  ],
  'eai classifier enable': [
    'eai classifier enable <classifier-key> --tenant-id <workspace-id> --format json',
  ],
  'eai classifier list': [
    'eai classifier list --tenant-id <workspace-id> --format json',
  ],
  'eai classifier save': [
    'eai classifier save --file classifier.json --tenant-id <workspace-id> --format json',
  ],
  'eai classifier publish': [
    'eai classifier publish <classifier-key> --tenant-id <workspace-id> --format json',
  ],
  'eai classifier target': [
    'eai classifier target <classifier-key> --app <app-key> --workflow <workflow-key> --version <version> --document-lifecycle business-document-v1 --tenant-id <workspace-id> --format json',
  ],
  'eai chat send': [
    'EAI_E2E_CHAT=1 eai chat send "Reply READY." --workflow <run-created-workflow-key> --stage chat --conversation-id <run-created-conversation-id>',
  ],
  'eai chat stream': [
    'eai chat stream --workflow <workflow-id> --stage chat --conversation-id <conversation-id> --help',
  ],
  'eai workflow provision': [
    'EAI_E2E_WORKFLOW_PROVISION=1 eai workflow provision <workflow-key> --app <app-key> --workspace <workspace-id> --display-name <name> --usecase generic --scope-key generic:<workflow-key> --stage chat:Chat --stage-env NEXT_PUBLIC_WORKFLOW_ID=chat --workflow-env-key NEXT_PUBLIC_WORKFLOW_ID --bind-ai-runtime --ai-provider azure-openai --ai-model gpt-4.1 --ai-profile-key <profile-key> --stage-prompt chat=Hello --status active --write-local-env --env test --label <app-name> --format json',
  ],
  'eai workflow readiness': [
    'eai workflow readiness --workspace <workspace-id> --format json',
  ],
  'eai workflow status': [
    'EAI_E2E_WORKFLOW_KEY=<workflow-id> eai workflow status <workflow-id> --workspace <workspace-id> --format json',
  ],
  'eai workflow request': [
    'EAI_E2E_WORKFLOW_REQUEST=1 eai workflow request <workflow-key> --workspace <workspace-id> --display-name <name> --reason smoke --format json',
  ],
  'eai docs upload': [],
  'eai docs classify': [
    'EAI_E2E_DOCS=1 eai docs classify <EAI_E2E_DOCS_FILE> --tenant-id <EAI_E2E_DOCS_TENANT_ID> --storage-target resourceapi --vertical-key <EAI_E2E_DOCS_VERTICAL_KEY> --workflow-key <EAI_E2E_DOCS_WORKFLOW_KEY> --format json',
  ],
  'eai docs index': [],
  'eai deploy app': [
    'eai deploy app <app-key> --target eai --tenant-id <tenant-id> --target-tenant-id <runtime-tenant-id> --source customer-owned --repo <owner/repo> --installation-id <installation-id> --branch main --workflow .github/workflows/eai-app.yml --environment preview --commit <40-char-sha> --wait --timeout 1200 --format json',
    'eai deploy app <app-key> --target eai --tenant-id <tenant-id> --target-tenant-id <runtime-tenant-id> --source eai-managed --github-link-session <verified-session-id> --environment preview --wait --format json',
    'eai deploy app <app-key> --target eai --tenant-id <tenant-id> --target-tenant-id <runtime-tenant-id> --source eai-managed --environment preview --resume <managed-operation-id> --wait --format json',
    'eai deploy app <app-key> --target eai --tenant-id <tenant-id> --target-tenant-id <target-tenant-id> --resume <operation-id> --wait --format json',
    'eai deploy app <app-key> --target eai --tenant-id <tenant-id> --target-tenant-id <target-tenant-id> --retry <operation-id> --no-wait --format json',
  ],
  'eai deploy source move': [
    'eai deploy source move <app-key> --tenant-id <tenant-id> --target-tenant-id <runtime-tenant-id> --environment preview --source-operation <cli-managed-operation-id> --no-open --format json',
  ],
  'eai deploy source validate': [
    'eai deploy source validate --project-dir <generated-app-directory> --format json',
    'eai deploy source validate --format text',
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
    'eai deploy doctor --operation-id <operation-id> --app-key <app-key> --tenant-id <tenant-id> --target-tenant-id <runtime-tenant-id> --evidence-out .eai/deploy-doctor.json --format json',
  ],
  'eai runtime validate': [
    'eai runtime validate --format json',
  ],
  'eai verify storage': [
    'eai verify storage --tenant-id <workspace-id> --format json',
  ],
  'eai verify': [
    'eai verify --tenant-id <run-created-runtime-id>',
  ],
  'eai verify calls': [
    'eai verify calls --tenant-id <workspace-id> --resource-type <object-type> --resource-id <resource-id> --workflow <workflow-id> --stage chat --tenant-record <workspace-id> --user-email <email> --chat-message "Smoke test" --format json',
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
    'EAI_E2E_RESOURCEAPI_REFRESH=1 eai provision resourceapi-refresh --tenant-id <workspace-id> --install-id <install-id> --apply --dry-run --backend all --rebuild-search --force-overwrite --reason smoke --change-ticket E2E-SMOKE --product <app-key> --schema-version 1 --format json',
  ],
  'eai provision storage': [
    'eai provision storage --tenant-id <workspace-id> --backend all --dry-run --format json',
    'eai provision storage --tenant-id <workspace-id> --backend all --format json',
  ],
  'eai provision resourceapi-bundle': [
    'eai provision resourceapi-bundle --schema smoke-object-types.json --tenant-id <workspace-id> --install-id <install-id> --backend all --product <app-key> --schema-version 1 --out resourceapi-bundle.json --format json',
    'EAI_E2E_RESOURCEAPI_BUNDLE_APPLY=1 eai provision resourceapi-bundle --schema smoke-object-types.json --tenant-id <workspace-id> --install-id <install-id> --apply --dry-run --backend all --rebuild-search --product <app-key> --schema-version 1 --format json',
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
    'EAI_E2E_DOCS=1 eai publicapi get /v4/data/documents/jobs/<job-id> --tenant-id <EAI_E2E_DOCS_TENANT_ID> --format json',
    'EAI_E2E_DOCS=1 eai publicapi get /v4/data/documents/records/<document-id>?storage_target=resourceapi&job_id=<job-id> --tenant-id <EAI_E2E_DOCS_TENANT_ID> --format json',
    'eai publicapi get /v4/data/resources/object-types --tenant-id <workspace-id> --param limit=1 --include-headers --format json',
  ],
  'eai publicapi post': [
    'eai publicapi post /v4/platform/capabilities/evaluate --tenant-id <qa-parent-id> --data {"tenant_id":"<qa-parent-id>","target_capability":"child-tenants","requested_operation":"create"} --format json',
  ],
  'eai publicapi patch': [
    'EAI_E2E_PUBLICAPI_PATCH_PATH=<path> eai publicapi patch <path> --tenant-id <workspace-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai publicapi put': [
    'EAI_E2E_PUBLICAPI_PUT_PATH=<path> eai publicapi put <path> --tenant-id <workspace-id> --data {} --file body.json --param dryRun=true --include-headers --format json',
  ],
  'eai publicapi delete': [
    'EAI_E2E_PROVISION_ENTRA=1 eai publicapi delete /v4/platform/provisioning/entra-apps/<run-created-client-id> --tenant-id <run-created-runtime-id> --data {"tenant_id":"<run-created-runtime-id>","delete_registration":true} --format json',
  ],
  'eai errors list': [
    'eai errors list --format json',
  ],
  'eai errors explain': [
    'eai errors explain E101 --format json',
  ],
  'eai support': [
    'eai support --format json --source harness --tool codex --tool-version <version> --command "eai types validate" --exit-code 1 --error-code E001 --description "Unresolved CLI command failure" --no-open',
  ],
  'eai agent guide': [
    'eai agent guide --format json',
  ],
};

const DOCUMENT_CONTEXT_OPTION_DECISIONS = {
  '--tenant-id': 'Explicit tenant forwarding is covered by docs command/API tests; live Curate acceptance requires an approved customer project and identity.',
  '--storage-target': 'ResourceAPI multipart routing and rejection of legacy context are covered by docs-classify.test.ts; not a deployed Curate lifecycle pass.',
  '--business-request-id': 'Queued upload context is contract-tested; default release smoke has no approved Curate business request to mutate.',
  '--planning-application-id': 'Queued upload context is contract-tested; live acceptance requires a provisioned tenant-owned project and cleanup policy.',
  '--vertical-key': 'Published classifier binding is contract-tested with workflow-key; customer provider execution remains an explicit live acceptance step.',
  '--workflow-key': 'Paired classifier keys and incomplete-context rejection are contract-tested; default smoke does not select a customer classifier.',
  '--format': 'Structured success and error JSON are covered by docs command tests; HTTP acceptance is not lifecycle completion.',
};

const OPTION_DECISIONS = {
  'eai support': {
    '--yes': 'Creates a draft only after explicit human approval; local fixture tests cover the consented POST and refusal, and deployed smoke never supplies consent.',
  },
  'eai template check': {
    '--ai-plan': 'Read-only AI adoption-plan output is covered by template integration tests; release smoke avoids cloning the public template.',
    '--preserve-ui': 'Presentation preservation is asserted by template integration tests and remains enabled for AI plans.',
  },
  'eai docs upload': DOCUMENT_CONTEXT_OPTION_DECISIONS,
  'eai docs classify': DOCUMENT_CONTEXT_OPTION_DECISIONS,
  'eai start': {
    '--surface': 'Explicit provider selection is covered by command integration tests; release smoke keeps detection read-only.',
    '--isolation-check': 'Local isolation readiness is covered by focused contract tests; release smoke does not create a task worktree or launch a quota-consuming host.',
    '--install': 'Opening an external provider installation page requires a user click and is not performed by automated release smoke.',
    '--dry-run': 'Provider launch-plan output is covered by integration tests; release smoke uses the stronger read-only detection contract.',
    '--no-remember': 'Preference suppression is covered by the local preference unit contract; release smoke does not launch or persist a provider.',
    '--contract-version': 'Compatibility negotiation is covered by start integration tests: released Setup 0.3.19 receives default v1, while current Setup explicitly requests v2.',
  },
  'eai init': {
    '--tool': 'All five AI tool instruction generators are verified by fresh local init integration fixtures; live smoke uses the default tool.',
    '--binding-receipt': 'Optional protected POSIX acknowledgement is covered by init-app-binding unit tests, init/API integration tests and native Installer receipt tests; default live smoke does not opt into private creation-ownership evidence.',
    '--binding-receipt-nonce': 'Paired canonical UUIDv4, fresh no-overwrite reservation, exact request actor/gateway and stale/race rejection are owned by init-app-binding and native Installer tests; mapped Installer qualification remains a separate authorized journey.',
    '--from': 'Template source override is exercised by existing init tests; release live smoke uses the default public template.',
    '--trust-template-scripts': 'Security opt-in for reviewed custom templates; integration tests prove custom scripts are blocked by default and allowed only after explicit trust.',
    '--tenant': 'Deprecated compatibility alias for --company-workspace; release smoke uses the workspace flag.',
    '--company-workspace,': 'Binds the app to the selected EAI workspace; release smoke uses the dedicated workspace ID.',
    '--parent-tenant': 'Compatibility flag covered by the workspace hierarchy flow; live smoke keeps one direct workspace binding unless child-workspace smoke is explicitly enabled.',
    '--child-tenant': 'Compatibility flag covered by app create child-workspace flow and opt-in child-workspace smoke.',
    '--create-child-tenant': 'Compatibility flag for the interactive child-workspace prompt; app create covers child-workspace options.',
    '--no-gofer': 'Negative scaffold mode is covered by unit tests; release live smoke keeps Gofer assets installed so follow-up refresh can run.',
    '--no-splash': 'Interactive branding opt-out; smoke runs remain non-interactive and do not require the terminal wordmark.',
    '--display-name': 'Guided eai create collects the display name and forwards it to the non-interactive init path; release smoke uses the default humanized name.',
    '--description': 'Guided eai create collects the business description and forwards it to the non-interactive init path; release smoke uses the default description.',
    '--app-key': 'Live smoke scaffolds only the exact app explicitly created by this run in the fresh child.',
    '--no-install': 'Dependency installation is covered by init integration tests; release smoke keeps the generated workspace setup bounded and uses the default install behavior.',
  },
  'eai create': {
    '--from': 'Template source override is covered by the underlying init command; guided release smoke uses help only to avoid cloning or browser auth.',
    '--trust-template-scripts': 'Security opt-in forwarded to init only for a reviewed custom template; the normal guided flow uses the trusted canonical template.',
    '--skip-prompts': 'Automation escape hatch forwards directly to the legacy init command and is covered by init integration tests.',
    '--skip-onboarding': 'Compatibility escape hatch intentionally delegates to the legacy init prompt flow; focused create tests cover argument forwarding.',
    '--current-dir': 'Current-folder scaffold mode is covered by init integration tests; guided setup asks this question interactively.',
    '--tenant': 'Deprecated compatibility alias for --company-workspace; retained for existing automation.',
    '--company-workspace,': 'Guided setup resolves the active signup workspace and forwards its ID; direct override is retained for automation.',
    '--parent-tenant': 'Compatibility flag for child-workspace hierarchy; guided setup defaults to the selected signup workspace.',
    '--child-tenant': 'Compatibility flag for child-workspace creation; guided setup keeps the standard workspace boundary by default.',
    '--create-child-tenant': 'Compatibility flag for interactive child-workspace creation; the opt-in path is covered by init integration tests.',
    '--no-gofer': 'Bare scaffold mode is covered by init integration tests; guided setup installs Gofer by default.',
    '--package-profile': 'Package profile is forwarded to init; release smoke uses the external default.',
    '--tool': 'AI-tool selection is covered by the guided onboarding contract; all four supported tool surfaces are installed as Gofer assets.',
    '--app-key': 'Existing-app binding is forwarded to init and covered by the create argument contract; guided release smoke keeps the default create-new-app path to avoid changing tenant state.',
    '--no-splash': 'Interactive branding opt-out; smoke runs remain non-interactive and do not require the terminal wordmark.',
    '--no-install': 'Dependency installation is covered by init integration tests; guided release smoke uses help only to avoid cloning or browser auth.',
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
  'eai workspace list': {
    '--raw-user': 'Debug payload mode can include identity metadata; not printed during release smoke.',
  },
  'eai workspace create': {
    '--allow-root': 'Administrative backfill escape hatch; intentionally excluded from normal e2e smoke.',
  },
  'eai workspace delete': {
    '--force-hard-purge': 'Only parent-authorized deletion of an exact run-created leaf is exercised; generic system-admin subtree purge remains controlled-test coverage.',
  },
  'eai user invite': {
    '--workspace,': 'Preferred workspace selector; invite behavior is covered by user integration tests and optional dedicated-workspace smoke.',
    '--role-definition-id': 'Custom role definition assignment is contract-tested; release smoke uses canonical base roles for portability.',
  },
  'eai user list': {
    '--workspace,': 'Preferred workspace selector; workspace membership visibility is covered by integration tests and dedicated-workspace smoke.',
  },
  'eai user roles': {
    '--workspace,': 'Preferred workspace selector; role discovery is covered by integration tests and dedicated-workspace smoke.',
  },
  'eai user role set': {
    '--workspace,': 'Preferred workspace selector; direct membership role updates are contract-tested.',
    '--member-id': 'Direct member-id role update is contract-tested; release smoke uses email-based assignment to cover existing and new user flows consistently.',
  },
  'eai resources list': {
    '--cursor': 'Cursor is data-dependent; pagination is covered through page/limit and cursor remains contract-documented.',
  },
  'eai resources indexes-plan': {
    '--object-type': 'Required explicit published Object Type slugs (1–1,000); the live smoke plans only its exact run-published set without applying changes.',
  },
  'eai resources indexes-apply': {
    '--object-type': 'Retained for compatibility; index apply is unsupported and no selection is sent to the backend.',
  },
  'eai resources cache-refresh': {
    '--object-type': 'Optional Object Type scope; system-admin refresh is reasoned and disabled in default release smoke.',
  },
  'eai app provision': {
    '--rebuild-search': 'Potentially expensive search rebuild; left as explicit opt-in outside release smoke.',
    '--skip-validate': 'Negative validation bypass; not used in release smoke because the smoke should prove normal validation works.',
  },
  'eai app auth status': {
    '--skip-validate': 'Live status supplies the exact newly acknowledged runtime/client directly; enrollment selection is separately asserted.',
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
    '--handover-from-no-code': 'Explicit no-code handover creates one-time operation state; mocked command coverage verifies exact source bindings and the opt-in payload without changing app ownership.',
  },
  'eai app workflow-evidence': {
    '--skip-validate': 'Only skips app lookup; canonical workflow validation proof remains required and is covered by command integration tests.',
    '--repo': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--operation-id': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--nonce': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--commit': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--config-hash': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--artifact-digest': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--image-digest': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--environment': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--branch': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--workflow': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--ref': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--template-version': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--base-template-sha': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--approved-source-sha': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--approved-release': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--schema-digest': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--validator-digest': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--workflow-run-id': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
    '--workflow-run-attempt': 'Deprecated construction flag; migrate to unchanged canonical collector JSON via --evidence-file.',
  },
  'eai app deploy-source-unknown': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
  },
  'eai app deploy-source-unknown-status': {
    '--skip-validate': 'Negative validation bypass; command integration tests cover the route while release smoke keeps app validation enabled.',
  },
  'eai user provision-me': {
    '--workspace,': 'Preferred workspace selector; current-user membership provisioning is covered by the dedicated-workspace smoke.',
  },
  'eai workflow provision': {
    '--workspace,': 'Preferred workspace selector; optional workflow provisioning smoke uses a dedicated test workspace.',
    '--vertical': 'Deprecated alias for --app; not used by new V4-native/app vocabulary smoke.',
    '--write-app-config': 'Writes cloud configuration; opt-in outside the default destructive smoke.',
  },
  'eai workflow readiness': {
    '--workspace,': 'Preferred workspace selector; readiness checks use the dedicated test workspace.',
  },
  'eai workflow status': {
    '--workspace,': 'Preferred workspace selector; optional status checks use a dedicated test workspace.',
  },
  'eai workflow request': {
    '--workspace,': 'Preferred workspace selector covered by controlled command tests; live request creation is blocked without verified teardown.',
  },
  'eai verify calls': {
    '--include-chat': 'Creates a chat conversation; controlled command tests cover this option. The run-owned workflow/chat lane makes its own first-class request.',
  },
  'eai doctor': {
    '--fix': 'Mutating repair mode; not used in release smoke unless a human asks for local repair.',
  },
  'eai provision entra': {
    '--company-tenant': 'Optional live sign-in always names this run\'s exact company child.',
    '--app-key': 'Optional live sign-in always names this run\'s newly acknowledged app.',
    '--tenant-id': 'Optional live sign-in supplies this run\'s exact runtime equality guard; it cannot override enrollment or membership.',
    '--create-local-secret': 'Optional live sign-in explicitly admits a local secret for its new isolated app; controlled credential tests cover retries and no-duplicate recovery.',
    '--reissue-local-secret': 'Explicit additional issuance after an uncertain response is controlled with private journal and exact app authority; never automatic in native Retry.',
    '--rotate-secret': 'Secret rotation is destructive; covered only when EAI_E2E_ROTATE_ENTRA_SECRET=1 is set.',
    '--deauthorize': 'Mandatory finally cleanup for the optional Entra lane; it cannot be disabled.',
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
  'eai publicapi delete': {
    '--file': 'Entra cleanup uses an inline fixed tenant-bound body, not arbitrary file input.',
    '--param': 'Entra cleanup supplies its tenant scope in the path, header and fixed body.',
    '--include-headers': 'Entra cleanup verification uses the exact server absence receipt; it saves no raw response headers.',
  },
  'eai publicapi post': {
    '--file': 'The read-only evaluator uses an inline fixed request; body-file writes remain controlled-test coverage.',
    '--param': 'The read-only evaluator has no query parameters; generic query encoding is contract-tested.',
    '--include-headers': 'Header projection is contract-tested; live evidence saves no raw headers.',
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
    cleanupMechanism: 'Bind only the acknowledged new app; finally app delete, leaf tenant hard-purge; private local workspace retained for evidence',
    cleanupVerified: 'Requires exact app receipt, absent enrollment, leaf hard-purge receipts and complete authorized parent child-inventory absence',
  },
  'eai env push': {
    createsExternalArtifact: 'Yes - cloud env/config value',
    cleanupMechanism: 'Opt-in only; caller owns reverting the selected key',
    cleanupVerified: 'No - disabled by default',
  },
  'eai types seed': {
    createsExternalArtifact: 'Yes - Object Type metadata',
    cleanupMechanism: 'Parent-authorized hard purge of only the run-created tenant after app cleanup',
    cleanupVerified: 'Requires exact physical purge receipt and complete authorized parent child-inventory absence',
  },
  'eai workspace create': {
    createsExternalArtifact: 'Yes - child tenant',
    cleanupMechanism: 'Finally delete only acknowledged leaves with --parent --force-hard-purge; runtime leaf before company child',
    cleanupVerified: 'Requires exact parent/child hard-purge receipt and complete authorized parent child-inventory absence',
  },
  'eai workspace bootstrap-admin': {
    createsExternalArtifact: 'Yes - membership/role assignment',
    cleanupMechanism: 'Child tenant deletion when smoke created the child tenant',
    cleanupVerified: 'Requires parent-bound child hard-purge receipt and complete authorized parent child-inventory absence',
  },
  'eai workspace delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created child tenant',
    cleanupVerified: 'Requires exact parent/child hard-purge receipt and complete authorized parent child-inventory absence',
  },
  'eai user invite': {
    createsExternalArtifact: 'Yes - user invite/membership',
    cleanupMechanism: 'Only an exact existing QA identity may gain child membership; hard-purge cascades child membership',
    cleanupVerified: 'Requires existing_user_reused identity and child hard-purge receipt; unexpected global identity remains an explicit leftover',
  },
  'eai user role set': {
    createsExternalArtifact: 'Yes - user invite/membership or role update',
    cleanupMechanism: 'Same cleanup model as eai user invite',
    cleanupVerified: 'Requires the same existing QA identity and child hard-purge receipt',
  },
  'eai user provision-me': {
    createsExternalArtifact: 'Yes - current-user membership if missing',
    cleanupMechanism: 'Only the disposable runtime receives membership; leaf hard-purge cascades it',
    cleanupVerified: 'Requires actor membership readback and parent-bound hard-purge receipt',
  },
  'eai resources batch-create': {
    createsExternalArtifact: 'Yes - ResourceAPI rows',
    cleanupMechanism: 'eai resources batch-delete and per-resource delete fallback',
    cleanupVerified: 'Requires explicit per-row ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources batch-import': {
    createsExternalArtifact: 'Yes - ResourceAPI rows, audit history, and async projection work',
    cleanupMechanism: 'eai resources batch-delete and per-resource delete fallback',
    cleanupVerified: 'Requires explicit per-row ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources batch-update': {
    createsExternalArtifact: 'Updates ResourceAPI rows',
    cleanupMechanism: 'Rows deleted after smoke',
    cleanupVerified: 'Requires explicit per-row ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources batch-delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created batch rows',
    cleanupVerified: 'Requires exact batch counts and per-row GET 404; partial results fail with individual fallback',
  },
  'eai resources create': {
    createsExternalArtifact: 'Yes - ResourceAPI rows/files/search documents',
    cleanupMechanism: 'eai resources delete and eai resources file delete',
    cleanupVerified: 'Requires explicit ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources update': {
    createsExternalArtifact: 'Updates ResourceAPI rows',
    cleanupMechanism: 'Rows deleted after smoke',
    cleanupVerified: 'Requires explicit ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created resources',
    cleanupVerified: 'Requires explicit ResourceAPI GET 404 after finally cleanup',
  },
  'eai resources file upload': {
    createsExternalArtifact: 'Yes - blob/file attachment',
    cleanupMechanism: 'eai resources file delete, then resource delete',
    cleanupVerified: 'Requires exact file GET 404, followed by resource GET 404',
  },
  'eai resources file delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Deletes smoke-created blob/file attachment',
    cleanupVerified: 'Requires explicit file GET 404; a successful delete response alone is insufficient',
  },
  'eai resources sync-schema': {
    createsExternalArtifact: 'Yes when EAI_E2E_SYNC_SCHEMA_APPLY=1',
    cleanupMechanism: 'Finally run-created leaf tenant physical hard purge after row/file/app cleanup',
    cleanupVerified: 'Requires exact hard-purge receipt and complete authorized parent child-inventory absence; schema apply is opt-in',
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
    createsExternalArtifact: 'No - unsupported before auth or HTTP',
    cleanupMechanism: 'Not required',
    cleanupVerified: 'Controlled tests verify no request or mutation occurs',
  },
  'eai resources cache-refresh': {
    createsExternalArtifact: 'Yes - cache invalidation operation',
    cleanupMechanism: 'No rollback required; refresh is idempotent and scoped',
    cleanupVerified: 'No - system-admin mutation disabled in default smoke',
  },
  'eai app create': {
    createsExternalArtifact: 'Yes - app record',
    cleanupMechanism: 'eai app delete <app-key> with exact non-interactive confirmation',
    cleanupVerified: 'Requires app deletion receipt and absence of exact enrollment from child app list',
  },
  'eai app delete': {
    createsExternalArtifact: 'No - destructive cleanup command',
    cleanupMechanism: 'Deletes and verifies the exact app-owned platform scope',
    cleanupVerified: 'Yes when the verified deletion receipt is returned',
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
    cleanupMechanism: 'Exact app deletion followed by parent-bound disposable tenant hard purge',
    cleanupVerified: 'Requires verified app receipt, absent enrollment and tenant hard-purge and complete parent child-inventory absence',
  },
  'eai classifier delete': {
    createsExternalArtifact: 'No - permanently removes one mutable classifier draft',
    cleanupMechanism: 'Exact classifier-key confirmation plus disabled and unpublished lifecycle guards; command integration tests mock the API boundary',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai classifier disable': {
    createsExternalArtifact: 'Yes - updates classifier lifecycle and blocks its targets',
    cleanupMechanism: 'eai classifier enable reverses the lifecycle state; command integration tests mock both API boundaries',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai classifier enable': {
    createsExternalArtifact: 'Yes - restores the classifier lifecycle state',
    cleanupMechanism: 'eai classifier disable reverses the lifecycle state; command integration tests mock both API boundaries',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai classifier save': {
    createsExternalArtifact: 'Yes - mutable tenant classifier draft',
    cleanupMechanism: 'Command integration coverage mocks the API; live release smoke does not create a draft',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai classifier publish': {
    createsExternalArtifact: 'Yes - immutable version and provider materialization',
    cleanupMechanism: 'Command integration coverage mocks the API; immutable publications are intentionally not deleted',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai classifier target': {
    createsExternalArtifact: 'Yes - app workflow binding to an immutable classifier version',
    cleanupMechanism: 'Command integration coverage mocks the API; live release smoke does not mutate workflow bindings',
    cleanupVerified: 'No - live mutation is disabled in the default smoke',
  },
  'eai chat send': {
    createsExternalArtifact: 'Yes - chat/workflow conversation',
    cleanupMechanism: 'Run-provisioned workflow/conversation belongs only to disposable runtime; tenant hard purge',
    cleanupVerified: 'Requires exact runtime hard-purge receipt and complete authorized parent child-inventory absence',
  },
  'eai workflow provision': {
    createsExternalArtifact: 'Yes - workflow runtime/binding metadata',
    cleanupMechanism: 'Run-owned workflow only; tenant physical hard purge in finally',
    cleanupVerified: 'Requires exact runtime hard-purge receipt and complete authorized parent child-inventory absence',
  },
  'eai workflow request': {
    createsExternalArtifact: 'Yes - workflow request',
    cleanupMechanism: 'Controlled command tests only; requested live lane is blocked before writes',
    cleanupVerified: 'Not exercised; no run-owned teardown contract',
  },
  'eai docs upload': {
    createsExternalArtifact: 'No - not executed',
    cleanupMechanism: 'Not required; controlled command tests only',
    cleanupVerified: 'Not applicable',
  },
  'eai docs classify': {
    createsExternalArtifact: 'Yes - document, file and analysis',
    cleanupMechanism: 'Finally: tenant-bound publicapi delete records/{id}?storage_target=resourceapi&job_id={jobId}; only submission-returned IDs; independent of EAI_E2E_CLEANUP',
    cleanupVerified: 'Requires complete analysis cleanup receipt and GET 404; failures report remaining IDs/job and preserve original error',
  },
  'eai docs index': {
    createsExternalArtifact: 'No - not executed',
    cleanupMechanism: 'Not required; indexing is not covered by this lifecycle',
    cleanupVerified: 'Not applicable',
  },
  'eai publicapi delete': {
    createsExternalArtifact: 'No - cleanup command',
    cleanupMechanism: 'Idempotent repeat of first-class Entra deauthorization for its structured server receipt',
    cleanupVerified: 'Requires exact runtime/client receipt proving authorization and registration absent',
  },
  'eai deploy app': {
    createsExternalArtifact: 'Yes - GitHub Actions run and EAI-managed TenantInfra deployment',
    cleanupMechanism: 'Exact app deletion receipt must verify manifest-owned deployment resources; leaf tenant cleanup follows',
    cleanupVerified: 'Requires app receipt and absent enrollment; pending review never becomes deployment success',
  },
  'eai deploy source move': {
    createsExternalArtifact: 'No - CLI verifies source and returns a Portal handoff; a later customer-authorized Portal action can transfer the repository',
    cleanupMechanism: 'Not required for the CLI handoff; the local SOT journey verifies any subsequent backup retention and cleanup',
    cleanupVerified: 'Not applicable to the handoff; a successful native transfer requires separate same-repository and hosted-rebind evidence',
  },
  'eai deploy source validate': {
    createsExternalArtifact: 'No - local source check only',
    cleanupMechanism: 'Not required; reads files without writing a receipt',
    cleanupVerified: 'Controlled source fixtures assert no receipt write and preserve rejected file bytes',
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
    cleanupVerified: 'Requires first-class deauthorization and idempotent exact client/runtime server absence receipt',
  },
  'eai provision resourceapi-refresh': {
    createsExternalArtifact: 'May update passive install registry/schema snapshot',
    cleanupMechanism: 'Controlled command tests only; requested live lane is blocked before writes',
    cleanupVerified: 'Not exercised; no run-owned teardown contract',
  },
  'eai provision storage': {
    createsExternalArtifact: 'Yes - tenant storage provisioning metadata/resources',
    cleanupMechanism: 'Provision only run-created runtime; parent-bound leaf hard-purge in finally',
    cleanupVerified: 'Requires exact runtime hard-purge receipt and complete authorized parent child-inventory absence',
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
    else if (arg === '--local') args.mode = 'local';
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
  console.log(`Usage: node scripts/eai-full-e2e-smoke.cjs [--check|--plan|--local|--live] [--cli <path>] [--write-doc]

Modes:
  --check      Validate traceability against eai --describe. Non-destructive.
  --plan       Print the command/CRUD traceability table. Non-destructive.
  --local      Execute local contracts in disposable fixtures and isolated home.
  --live       Run the dedicated-test-tenant smoke suite. Destructive.

Local mode has no protected-backend writes or browser login. Set
EAI_E2E_LOCAL_UPDATE=1 for read-only public release-channel update checks.

Live mode environment:
  EAI_E2E_TEST_PROFILE          Required explicit, already authenticated QA profile
  EAI_E2E_TEST_USERNAME         Required exact expected QA username/email
  EAI_E2E_PARENT_TENANT_ID      Required explicit dedicated QA parent tenant
  EAI_E2E_CLEANUP_PREFLIGHT     Required fresh deployed child-delete route observation
  EAI_E2E_EXPECTED_PUBLIC_API  DEV AU (default) or canonical TEST AU/CA/EU URL
  EAI_E2E_TEST_USER_OID         Optional additional exact QA actor assertion
  EAI_E2E_OUTPUT_ROOT           Optional private artifact parent (default: system temp)
  EAI_E2E_CLEANUP               Always enabled; 0 is rejected
  EAI_E2E_CREATE_CHILD_TENANT   Always enabled; 0 is rejected
  EAI_E2E_SYNC_SCHEMA_APPLY     Set 1 for isolated physical schema / CRUD / files / search
  EAI_E2E_BUILD                 Build the scaffolded app. Default: 1
  EAI_E2E_INVITE_TEST_USER      Optional EXISTING QA user email for child membership smoke
  EAI_E2E_INVITE_TEST_USER_OID  Required with invite; identity must exist in the QA parent
  EAI_E2E_INVITE_ROLE           Optional invite role. Default: tenant-viewer
  EAI_E2E_NEGATIVE_TESTS        Run non-mutating negative path checks. Default: 0
  EAI_E2E_WORKFLOW_PROVISION   Set 1 to provision a run-owned workflow
  EAI_E2E_CHAT                 Set 1 with workflow, AI_PROVIDER and AI_MODEL fixtures
  EAI_E2E_AI_PROVIDER          Integration key installed for the child runtime
  EAI_E2E_AI_MODEL             Model available through that integration
  EAI_E2E_DEPLOY               Set 1 for exact EAI-managed app deployment and doctor
  EAI_E2E_DEPLOY_TIMEOUT       Exact-operation wait, seconds. Default: 900 (max 1800)

Live results contain actual commands, assertions and cleanup receipts. Unexecuted
surfaces remain not-run; this runner does not certify installer/provider UI.
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
    env: options.replaceEnv ? options.env : { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout,
    maxBuffer: 8 * 1024 * 1024,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: eai ${args.join(' ')}\n${redact(`${stdout}\n${stderr}`).trim()}`);
  }
  return { status: result.status ?? 1, stdout, stderr };
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
  return output
    .replace(/(client_secret|password|token|ticket)=([^&\s"'<>\\]+)/gi, '$1=[redacted]')
    .replace(/(["']?(?:access_token|refresh_token|id_token|client_secret|clientSecret|password)["']?\s*[:=]\s*)["'][^"']*["']/gi, '$1"[redacted]"')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]');
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
    if (command.hasAction && prefix.length > 0 && command.subcommands?.length) {
      leaves.push({ command: path.map((part) => part.name).join(' '), aliases: aliasPaths(path), options: command.options || [] });
    }
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

Generated from \`eai --describe\`. This table records planned coverage decisions
for all public executable command entries, including action-bearing parents.
Examples describe command contracts; they do not prove execution or every option.
Only a candidate-bound \`eai.cli-lifecycle-smoke.v2\` summary proves which commands
actually ran, their assertions, and verified cleanup. A selected lifecycle can pass
while \`coverageComplete\` remains false; blocked, skipped, and missing checks never pass.

Live mode requires an explicit eligible QA parent and identity. Every mutation
uses a fresh child and its acknowledged app/runtime, with independent finally
cleanup. Native installer/provider journeys and public package releases need
their separate qualification. See [CLI backend lifecycle smoke](cli-backend-lifecycle-smoke.md)
for prerequisites, supported lanes, cleanup observations and evidence.

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
| Executable CLI entries (leaves and action-bearing parents) | ${leaves.length} |
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
    .filter((row) => row.coverage !== 'covered-by-cli' && (!row.calls || row.calls.length === 0))
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

function entraDeletionReceiptVerified(body, clientId, tenantId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const field = (record, camelKey, snakeKey) => {
    const camel = record[camelKey], snake = record[snakeKey];
    return camel !== undefined && snake !== undefined && camel !== snake ? undefined : camel ?? snake;
  };
  const authorization = field(body, 'tenantDeauthorization', 'tenant_deauthorization');
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  const removed = authorization.removed;
  const alreadyAbsent = field(authorization, 'alreadyAbsent', 'already_absent');
  const found = field(body, 'appRegistrationFound', 'app_registration_found');
  const deleted = field(body, 'appRegistrationDeleted', 'app_registration_deleted');
  const registrationAbsent = field(body, 'appRegistrationAlreadyAbsent', 'app_registration_already_absent');
  const verified = field(body, 'appRegistrationAbsenceVerified', 'app_registration_absence_verified');
  return field(body, 'clientId', 'client_id') === clientId && field(body, 'tenantId', 'tenant_id') === tenantId
    && typeof removed === 'boolean' && typeof alreadyAbsent === 'boolean' && removed !== alreadyAbsent
    && typeof found === 'boolean' && typeof deleted === 'boolean' && typeof registrationAbsent === 'boolean'
    && deleted !== registrationAbsent && (!deleted || found) && verified === true;
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

function documentSmokeConfig(env) {
  if (env.EAI_E2E_DOCS !== '1') return null;
  const required = ['TENANT_ID', 'VERTICAL_KEY', 'WORKFLOW_KEY', 'FILE', 'EXPECTED_TYPE'];
  const missing = required.filter((key) => !env[`EAI_E2E_DOCS_${key}`]?.trim());
  if (missing.length) throw new Error(`EAI_E2E_DOCS requires ${missing.map((key) => `EAI_E2E_DOCS_${key}`).join(', ')}`);
  const waitMs = Number(env.EAI_E2E_DOCS_WAIT_MS || 180000);
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 600000) {
    throw new Error('EAI_E2E_DOCS_WAIT_MS must be an integer from 1 to 600000');
  }
  const file = resolve(env.EAI_E2E_DOCS_FILE);
  if (!existsSync(file)) throw new Error(`EAI_E2E_DOCS_FILE does not exist: ${file}`);
  return { tenantId: env.EAI_E2E_DOCS_TENANT_ID, verticalKey: env.EAI_E2E_DOCS_VERTICAL_KEY,
    workflowKey: env.EAI_E2E_DOCS_WORKFLOW_KEY, expectedType: env.EAI_E2E_DOCS_EXPECTED_TYPE, file, waitMs };
}

function runOptionalDocumentSmoke(eai, env = process.env, { now = Date.now, wait = sleep } = {}) {
  const config = documentSmokeConfig(env);
  if (!config) return { skipped: true };
  const scope = ['--tenant-id', config.tenantId, '--format', 'json'];
  const ids = new Set();
  let jobId;
  let originalError;
  const leftovers = [];
  const deadline = now() + config.waitMs;
  function request(args, cleanup = false) {
    const timeout = cleanup ? 30000 : Math.max(1, deadline - now());
    const result = eai(args, { allowFailure: true, timeout });
    const envelope = JSON.parse(result.stdout);
    return { result, envelope };
  }
  function body(args, cleanup = false) {
    const { result, envelope } = request(args, cleanup);
    if (result.status !== 0 || envelope.ok !== true || envelope.body?.success === false) {
      throw new Error(`Document smoke request failed: ${JSON.stringify(envelope)}`);
    }
    if (!envelope.body || typeof envelope.body !== 'object') throw new Error('Missing document response body');
    return envelope.body;
  }
  function recordPath(id) {
    return `/v4/data/documents/records/${encodeURIComponent(id)}?storage_target=resourceapi${jobId ? `&job_id=${encodeURIComponent(jobId)}` : ''}`;
  }
  const validId = (id) => typeof id === 'string' && id.trim().length > 0;
  try {
    const queued = body(['docs', 'classify', config.file, ...scope, '--storage-target', 'resourceapi',
      '--vertical-key', config.verticalKey, '--workflow-key', config.workflowKey]);
    jobId = queued.jobId || queued.job_id;
    if (!validId(jobId)) jobId = undefined;
    for (const doc of queued.documents || []) {
      const id = doc.documentId || doc.document_id;
      if (validId(id)) ids.add(id);
    }
    if (!jobId || ids.size !== 1 || queued.documents?.length !== 1) {
      throw new Error('Submission must return an explicit job ID and exactly one document ID; IDs will not be inferred');
    }
    const [id] = ids;
    let completed = false;
    while (now() < deadline) {
      const job = body(['publicapi', 'get', `/v4/data/documents/jobs/${encodeURIComponent(jobId)}`, ...scope]);
      if ((job.jobId || job.job_id) !== jobId || (job.tenantId || job.tenant_id) !== config.tenantId
        || job.documents?.length !== 1 || (job.documents[0].documentId || job.documents[0].document_id) !== id) {
        throw new Error('Document job identity or tenant mismatch');
      }
      const doc = job.documents[0];
      if (['failed', 'completed_with_errors'].includes(job.status)
        || [doc.storage, doc.classification, doc.rag].some((stage) => stage?.status === 'failed')) {
        throw new Error(`Document job failed: ${JSON.stringify(job)}`);
      }
      if (job.status === 'completed') {
        if (doc.storage?.status !== 'completed' || doc.classification?.status !== 'completed'
          || (doc.classification.detectedType || doc.classification.detected_type) !== config.expectedType) {
          throw new Error('Completed job is missing the expected storage/classification result');
        }
        completed = true;
        break;
      }
      wait(Math.min(2000, Math.max(0, deadline - now())));
    }
    if (!completed || now() >= deadline) throw new Error(`Document job ${jobId} timed out after ${config.waitMs}ms`);
    const record = body(['publicapi', 'get', recordPath(id), ...scope]);
    if (record.documentId !== id || record.storageTarget !== 'resourceapi' || record.processingStatus !== 'complete'
      || record.classification?.documentType !== config.expectedType || !validId(record.resourceId)) {
      throw new Error('Persisted document is missing the expected identity or completed classification result');
    }
  } catch (error) {
    originalError = error;
  } finally {
    for (const id of ids) {
      try {
        const receipt = body(['publicapi', 'delete', recordPath(id), ...scope], true);
        if (receipt.success !== true || receipt.documentId !== id || receipt.storageTarget !== 'resourceapi'
          || receipt.analysisCleanupComplete !== true) throw new Error('Incomplete document cleanup receipt');
        const { result, envelope } = request(['publicapi', 'get', recordPath(id), ...scope], true);
        if (result.status === 0 || envelope.ok !== false || envelope.status !== 404) {
          throw new Error('Deleted document is not confirmed absent');
        }
      } catch (error) {
        leftovers.push({ documentId: id, jobId, error: error.message });
      }
    }
    if (!ids.size) leftovers.push({ jobId, error: 'Submission returned no usable document ID; possible records cannot be safely identified or deleted' });
  }
  if (originalError || leftovers.length) {
    const error = originalError || new Error('Document cleanup failed');
    if (leftovers.length) error.message += `\nDocument leftovers: ${JSON.stringify(leftovers)}`;
    throw error;
  }
  return { jobId, documentIds: [...ids], cleanupVerified: true };
}

class SmokeBlocked extends Error {}

function executedCommand(args) {
  const normalized = args[0] === 'tenant' ? ['workspace', ...args.slice(1)] : args;
  return TRACEABILITY.map(row => row.command)
    .filter(name => normalized.slice(0, name.split(' ').length - 1).join(' ') === name.slice(4))
    .sort((a, b) => b.length - a.length)[0] || 'eai ' + normalized[0];
}

function coverageEvidence(commands) {
  return TRACEABILITY.map(row => {
    const executions = commands.filter(entry => entry.command === row.command);
    return { command: row.command, plannedCoverage: row.coverage, executions: executions.length,
      status: row.coverage === 'unsupported' ? 'unsupported'
        : !executions.length ? 'not-run' : executions.some(entry => entry.status === 'failed') ? 'failed'
        : executions.some(entry => entry.status === 'blocked') ? 'blocked'
          : executions.every(entry => entry.status === 'passed' && entry.coverageComplete !== false) ? 'passed' : 'incomplete',
      reason: executions.length ? undefined : row.notes };
  });
}

function candidateEvidence(cliPath) {
  const binary = realpathSync(resolve(cliPath));
  const packageRoot = dirname(dirname(binary));
  const runtimeFiles = [];
  function inventory(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('CLI candidate distribution must not contain linked files.');
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) inventory(join(path, name));
    else if (stat.isFile()) runtimeFiles.push(path);
    else throw new Error('CLI candidate distribution contains an unsupported file.');
  }
  for (const name of ['dist', 'resources', 'package.json']) inventory(join(packageRoot, name));
  runtimeFiles.sort((a, b) => relative(packageRoot, a).localeCompare(relative(packageRoot, b), 'en'));
  const runtimeHash = createHash('sha256');
  for (const file of runtimeFiles) {
    const path = relative(packageRoot, file).split(sep).join('/');
    const bytes = readFileSync(file);
    runtimeHash.update(String(Buffer.byteLength(path)) + ':' + path + ':' + bytes.length + ':');
    runtimeHash.update(bytes);
  }
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const localCandidate = realpathSync(packageRoot) === realpathSync(ROOT);
  const head = localCandidate ? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 }) : null;
  const dirty = localCandidate ? spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 }) : null;
  return {
    gitSha: localCandidate ? (head.status === 0 ? head.stdout.trim() : null) : (/^[a-f0-9]{40}$/.test(pkg.gitHead || '') ? pkg.gitHead : null),
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    runtimeSha256: runtimeHash.digest('hex'),
    runtimeFileCount: runtimeFiles.length,
    version: pkg.version,
    dirty: localCandidate && dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null,
  };
}

/** Execute the built candidate's local surfaces without accessing a real token home. */
function runLocalSmoke(cliPath, dependencies = {}) {
  const env = dependencies.env || process.env;
  const execute = dependencies.execute || runCommand;
  const log = dependencies.log || console.log;
  const outputRoot = resolve(env.EAI_E2E_OUTPUT_ROOT || tmpdir());
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const runRoot = mkdtempSync(join(outputRoot, 'eai-local-qualification-'));
  const projectRoot = join(runRoot, 'app'), isolatedHome = join(runRoot, 'isolated-home'), templateRoot = join(runRoot, 'template');
  const summaryPath = join(runRoot, 'summary.json');
  const command = cliInvocation(cliPath);
  const report = { schemaVersion: 'eai.cli-lifecycle-smoke.v2', qualification: 'local-fixtures',
    candidate: candidateEvidence(cliPath), status: 'running', coverageComplete: false, commands: [], assertions: [],
    created: {}, cleanup: [], leftovers: [], cleanupVerified: false, cleanupStatus: 'not-needed', localCleanupVerified: false };
  const checkpoint = () => writeFileSync(summaryPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  // Override child-process HOME only. Never load, copy or change the operator's auth files.
  const childEnv = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([key]) =>
    !/^(EAI_|ENTRA_|AUTH_|OBO_|BASE_URL_|ROUTING_|TENANT_|WORKFLOW_|NEXT_PUBLIC_|AZURE_|GIT_)/.test(key)));
  Object.assign(childEnv, { HOME: isolatedHome, USERPROFILE: isolatedHome, XDG_CONFIG_HOME: join(isolatedHome, '.config'),
    AZURE_CONFIG_DIR: join(isolatedHome, '.azure'), GH_CONFIG_DIR: join(isolatedHome, '.gh'),
    EAI_PROFILE: 'default', EAI_AUTH_TENANT_NAME: 'local-fixture', EAI_AUTH_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    EAI_AUTH_SCOPE: 'api://local-fixture/access', EAI_CLI_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    BASE_URL_PUBLIC_API: 'https://dev-api.au.myenterprise.ai/public', EAI_GOFER_REFRESH_SOURCE: 'bundled',
    EAI_GOFER_REFRESH_BUNDLED_ONLY: '1', NO_UPDATE_NOTIFIER: '1', CI: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
  function verify(name, condition) {
    report.assertions.push({ name, phase: 'local', status: condition ? 'passed' : 'failed' }); checkpoint();
    if (!condition) throw new Error('Local qualification assertion failed: ' + name + '.');
  }
  function invoke(args, validate = () => {}, options = {}) {
    const entry = { command: executedCommand(args), phase: 'local', status: 'running', options: args.filter(arg => arg.startsWith('--')) };
    report.commands.push(entry); checkpoint();
    const started = Date.now();
    try {
      const originalFiles = options.allowAppWrites ? null : appDigest();
      const result = execute(command, ['--profile', 'default', ...args], { cwd: projectRoot, env: childEnv, replaceEnv: true, allowFailure: true, timeout: 60000 });
      entry.exitCode = result.status;
      entry.durationMs = Date.now() - started;
      if (options.expectedFailure ? result.status === 0 : result.status !== 0) throw new Error('Unexpected command exit.');
      validate(result);
      if (originalFiles) verify('read-only-files-' + args.slice(0, 2).join('-'), appDigest() === originalFiles);
      entry.status = options.incomplete ? 'incomplete' : 'passed';
      if (options.incomplete) { entry.coverageComplete = false; entry.reason = options.incomplete; }
      checkpoint(); return result;
    } catch (error) {
      entry.status = 'failed'; entry.reason = 'Local contract or subprocess failed; raw output is omitted.'; checkpoint(); return null;
    }
  }
  function json(args, validate = () => {}, options = {}) {
    return invoke(args, result => {
      const body = JSON.parse(result.stdout);
      verify('successful-local-json-' + args.slice(0, 2).join('-'), body && typeof body === 'object'
        && body.ok !== false && body.success !== false && body.valid !== false && !['fail', 'failed'].includes(body.status));
      validate(body);
    }, options);
  }
  function localGit(args, cwd) {
    const result = spawnSync('git', args, { cwd, env: childEnv, encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) throw new Error('Disposable local Git fixture setup failed.');
    return result.stdout.trim();
  }
  function appDigest() {
    const hash = createHash('sha256');
    function visit(path) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Local fixture unexpectedly contains a link.');
      if (stat.isDirectory()) for (const item of readdirSync(path).sort()) { if (item !== '.git') visit(join(path, item)); }
      else { const name = relative(projectRoot, path); const bytes = readFileSync(path); hash.update(name.length + ':' + name + ':' + bytes.length + ':'); hash.update(bytes); }
    }
    visit(projectRoot); return hash.digest('hex');
  }
  try {
    for (const path of [projectRoot, isolatedHome, templateRoot, join(isolatedHome, '.eai')]) mkdirSync(path, { mode: 0o700 });
    createJsonFile(join(projectRoot, 'package.json'), { name: 'eai-local-qualification-fixture', version: '0.0.0', type: 'module' });
    createJsonFile(join(projectRoot, 'eai.runtime.json'), { schemaVersion: 1,
      environment: { required: ['BASE_URL_PUBLIC_API', 'TENANT_KEYS'], tenantKeyPattern: { keysEnv: 'TENANT_KEYS', tenantIdEnv: 'TENANT_{KEY}_ID', workflowIdEnv: 'WORKFLOW_{KEY}_ID' } },
      secrets: { required: ['AUTH_SECRET'], optional: [] }, auth: { callbackPath: '/api/auth/callback/microsoft-entra-id' },
      endpoints: { health: '/health', authProviders: '/api/auth/providers', runtimeConfig: '/api/eai/config', bffBasePath: '/api/eai', public: [],
        smokeTests: [{ name: 'health', method: 'GET', path: '/health', expectedStatus: 200 }] } });
    writeFileSync(join(projectRoot, '.env.example'), 'TENANT_KEYS=fixture\nTENANT_FIXTURE_ID=local-fixture\nWORKFLOW_FIXTURE_ID=local-workflow\n');
    writeFileSync(join(projectRoot, '.env.local'), 'EAI_PROFILE=default\nNEXT_PUBLIC_APP_NAME=local-qualification\nAUTH_SECRET=synthetic-local-fixture-value\n', { mode: 0o600 });
    mkdirSync(join(projectRoot, 'src', 'eai.config'), { recursive: true });
    // This offline fixture has no scaffolded producer module or app build.
    writeFileSync(join(projectRoot, 'src', 'eai.config', 'object-types.ts'),
      'export const objectTypes = ' + JSON.stringify({ 'eai-local-qualification':
        smokeObjectTypes('eai-local-qualification', '202610090001', 'local-fixture') }, null, 4) + ';\n');
    writeFileSync(join(templateRoot, 'fixture-component.tsx'), 'export const Fixture = () => null;\n');
    localGit(['init', '-q'], templateRoot); localGit(['add', '.'], templateRoot);
    localGit(['-c', 'user.name=CLI Local Qualification', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Disposable template fixture'], templateRoot);
    createJsonFile(join(projectRoot, '.eai-manifest.json'), { schemaVersion: 1, packages: { profile: 'external' },
      template: { repo: templateRoot, commit: localGit(['rev-parse', 'HEAD'], templateRoot) } });
    localGit(['init', '-q'], projectRoot);
    const before = appDigest();
    json(['agent', 'guide', '--format', 'json']);
    json(['errors', 'list', '--format', 'json']); json(['errors', 'explain', 'E101', '--format', 'json']);
    json(['blocks', 'list', '--format', 'json'], body => verify('built-in-block-discovery', body.blocks?.some(block => block.id === 'core.button')));
    json(['blocks', 'describe', 'core.button', '--format', 'json'], body => verify('exact-block-description', body.id === 'core.button'));
    json(['blocks', 'readiness', '--package-profile', 'external', '--format', 'json']);
    json(['blocks', 'schema', '--format', 'json']); json(['blocks', 'validate', '--format', 'json']);
    json(['runtime', 'validate', '--format', 'json'], body => verify('runtime-contract-pass', body.status === 'pass'));
    json(['env', 'list', '--format', 'json'], body => verify('local-secret-values-masked', ['[hidden]', '[redacted]'].includes(body.variables?.AUTH_SECRET)
      && !JSON.stringify(body).includes('synthetic-local-fixture-value')));
    invoke(['types', 'validate']);
    json(['template', 'check', '--format', 'json'], body => verify('template-file-drift-observed', body.items?.some(item => item.relativePath === 'fixture-component.tsx')));
    json(['gofer', 'refresh', '--check', '--format', 'json'], body => verify('gofer-check-mode', body.mode === 'check'));
    json(['deploy', 'env', '--provider', 'generic', '--format', 'json']);
    json(['start', '--check', '--format', 'json']);
    verify('read-only-contracts-preserve-app-files', appDigest() === before);
    invoke(['deploy', 'setup'], () => verify('deployment-workflow-created-locally', existsSync(join(projectRoot, '.github', 'workflows', 'deploy-demo.yml'))), { allowAppWrites: true });
    json(['gofer', 'refresh', '--format', 'json'], body => verify('gofer-apply-mode', body.mode === 'apply'), { allowAppWrites: true });
    json(['gofer', 'refresh', '--check', '--format', 'json'], body => verify('gofer-refresh-converged', body.mode === 'check' && body.items?.length === 0));
    const syntheticTokens = join(isolatedHome, '.eai', 'tokens.json');
    writeFileSync(syntheticTokens, 'synthetic-disposable-token-file', { mode: 0o600 });
    invoke(['logout'], () => verify('isolated-logout-token-file-absent', !existsSync(syntheticTokens)));
    invoke(['login', '--callback-port', '0'], result => verify('invalid-login-callback-rejected', /Invalid callback port/.test(result.stdout + result.stderr)),
      { expectedFailure: true, incomplete: 'Invalid callback rejection only; real browser PKCE authentication is not exercised.' });
    if (env.EAI_E2E_LOCAL_UPDATE === '1') invoke(['update', '--check', '--no-project-refresh']);
    report.status = report.commands.some(entry => entry.status === 'failed') ? 'failed' : 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = 'Local fixture setup or assertion failed; raw output is omitted.';
  } finally {
    const cleanup = { artifact: 'local-fixtures', status: 'running' }; report.cleanup.push(cleanup);
    try {
      for (const path of [projectRoot, isolatedHome, templateRoot]) rmSync(path, { recursive: true, force: true });
      report.localCleanupVerified = [projectRoot, isolatedHome, templateRoot].every(path => !existsSync(path));
      cleanup.status = report.localCleanupVerified ? 'passed' : 'failed';
    } catch { cleanup.status = 'failed'; }
    if (cleanup.status !== 'passed') { report.status = 'failed'; report.leftovers.push({ artifact: 'local-fixtures', reason: 'Disposable fixture cleanup was not verified.' }); }
    report.coverage = coverageEvidence(report.commands); report.coverageComplete = report.coverage.every(entry => entry.status === 'passed'); checkpoint();
  }
  log('[e2e] Local qualification ' + report.status + '. Summary: ' + summaryPath);
  if (report.status !== 'passed') {
    const error = new Error('Local CLI qualification failed. Summary: ' + summaryPath); error.report = report; error.summaryPath = summaryPath; throw error;
  }
  return { ...report, summaryPath };
}

/** Injectable caller: controlled tests exercise failure paths without network or credentials. */
function runLiveSmoke(cliPath, dependencies = {}) {
  const env = dependencies.env || process.env;
  // Child processes use the owned scaffold and selected profile, never ambient app routing/auth overrides.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(EAI_|NEXT_PUBLIC_|ENTRA_|AUTH_|OBO_|BASE_URL_|ROUTING_|TENANT_|WORKFLOW_|PUBLICAPI_)/.test(key)));
  const execute = dependencies.execute || runCommand;
  const now = dependencies.now || Date.now;
  const wait = dependencies.wait || sleep;
  const log = dependencies.log || console.log;
  const profile = env.EAI_E2E_TEST_PROFILE || '';
  const parentTenantId = env.EAI_E2E_PARENT_TENANT_ID || '';
  const expectedUsername = env.EAI_E2E_TEST_USERNAME || '';
  const expectedApi = env.EAI_E2E_EXPECTED_PUBLIC_API || 'https://dev-api.au.myenterprise.ai/public';
  const runId = env.EAI_E2E_RUN_ID || new Date(now()).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const nonce = (dependencies.uuid || randomUUID)().replace(/-/g, '').slice(0, 8);
  const appName = ('eai-e2e-' + runId + '-' + nonce).toLowerCase();
  const command = cliInvocation(cliPath);
  const outputRoot = resolve(env.EAI_E2E_OUTPUT_ROOT || tmpdir());
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const runRoot = mkdtempSync(join(outputRoot, 'eai-full-e2e-'));
  const projectRoot = join(runRoot, 'app');
  const controlRoot = join(runRoot, 'control');
  mkdirSync(projectRoot, { mode: 0o700 });
  mkdirSync(controlRoot, { mode: 0o700 });
  const summaryPath = join(runRoot, 'summary.json');
  const report = { schemaVersion: 'eai.cli-lifecycle-smoke.v2', runId, profile, parentTenantId, candidate: candidateEvidence(cliPath),
    environment: expectedApi.includes('://dev-api.') ? 'DEV' : 'TEST',
    expectedPublicApi: expectedApi, status: 'running', coverageComplete: false,
    commands: [], assertions: [], cleanup: [], leftovers: [],
    created: { childTenantId: '', runtimeTenantId: '', appKey: '', enrollmentId: '',
      entraClientId: '', resources: [], workflowIds: [], directoryUsers: [] } };
  let phase = 'preflight';
  let originalError;
  let childAttempted = false;
  let childOwned = false;
  let appAttempted = false;
  let appOwned = false;
  let runtimeOwned = false;
  let entraAttempted = false;
  const batchIds = [];
  const child = () => report.created.childTenantId;
  const runtime = () => report.created.runtimeTenantId;
  const checkpoint = () => writeFileSync(summaryPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

  function assertion(name, condition, message, blocked = false) {
    report.assertions.push({ name, phase, status: condition ? 'passed' : blocked ? 'blocked' : 'failed' });
    const last = report.commands.at(-1);
    if (last) {
      (last.assertions ||= []).push(name);
      if (!condition) last.status = blocked ? 'blocked' : 'failed';
    }
    checkpoint();
    if (!condition) throw blocked ? new SmokeBlocked(message) : new Error(message);
  }
  function eai(args, options = {}) {
    const selector = ['--tenant-id', '--tenant', '--workspace'].find(flag => args.includes(flag));
    const entry = { command: executedCommand(args), phase, status: 'running',
      scopeTenantId: options.scopeTenantId || (selector ? args[args.indexOf(selector) + 1] : undefined),
      // Save option names only. Arguments, command output and env can contain secrets.
      options: args.filter(arg => arg.startsWith('--')) };
    report.commands.push(entry); checkpoint();
    const started = now();
    try {
      const result = execute(command, ['--profile', profile, ...args], { cwd: options.cwd || projectRoot,
        allowFailure: true, replaceEnv: true, env: { ...childEnv, EAI_PROFILE: profile, BASE_URL_PUBLIC_API: expectedApi,
          EAI_TENANT_ID: (options.cwd || projectRoot) === projectRoot ? runtime() || undefined : undefined,
          EAI_PARENT_TENANT_ID: (options.cwd || projectRoot) === projectRoot ? child() || undefined : undefined,
          EAI_APP_KEY: (options.cwd || projectRoot) === projectRoot ? report.created.appKey || undefined : undefined },
        timeout: options.timeout || 60000 });
      entry.exitCode = result.status;
      entry.durationMs = Math.max(0, now() - started);
      options.observe?.(result); // Record returned IDs before any status/contract assertion can throw.
      entry.status = result.status === 0 ? 'passed' : 'failed'; checkpoint();
      if (result.status !== 0 && !options.allowFailure) {
        const body = parseJson(result.stdout, {});
        const code = body.error?.code || body.serverCode || body.code;
        const safeCode = typeof code === 'string' && /^[A-Z0-9_:-]{1,100}$/.test(code) ? '; ' + code : '';
        throw new Error(entry.command + ' failed (exit ' + result.status + safeCode + ').');
      }
      return result;
    } catch (error) {
      entry.status = error instanceof SmokeBlocked ? 'blocked' : 'failed'; checkpoint(); throw error;
    }
  }
  function json(args, options = {}) {
    const result = eai(args, options);
    let payload;
    try { payload = JSON.parse(result.stdout); } catch {
      assertion('valid-json-output', false, executedCommand(args) + ' did not return JSON.');
    }
    assertion('successful-json-contract', payload && typeof payload === 'object'
      && payload.ok !== false && payload.success !== false && !['fail', 'failed'].includes(payload.status)
      && !(Number(payload.failed) > 0) && !(Number(payload.summary?.fail) > 0) && !(Number(payload.summary?.failed) > 0),
    executedCommand(args) + ' returned an unsuccessful result.');
    const entry = report.commands.at(-1);
    if (payload.summary && typeof payload.summary === 'object') {
      entry.result = Object.fromEntries(Object.entries(payload.summary)
        .filter(([, value]) => typeof value === 'number' || typeof value === 'boolean'));
      if (payload.summary.coverageComplete === false) entry.coverageComplete = false;
    }
    return payload;
  }
  function appNpm(script, timeout) {
    const entry = { command: 'npm run ' + script, phase, scopeTenantId: runtime(), status: 'running' };
    report.commands.push(entry); checkpoint();
    const started = now();
    try {
      const result = execute({ file: process.platform === 'win32' ? 'npm.cmd' : 'npm', baseArgs: [] }, ['run', script],
        { cwd: projectRoot, allowFailure: true, replaceEnv: true, env: { ...childEnv, EAI_PROFILE: profile, BASE_URL_PUBLIC_API: expectedApi,
          EAI_TENANT_ID: runtime(), EAI_PARENT_TENANT_ID: child(), EAI_APP_KEY: appName,
          EAI_OBJECT_TYPES_INPUT_PATH: join(projectRoot, 'src', 'eai.config', 'object-types.ts'),
          EAI_OBJECT_TYPES_OUTPUT_PATH: join(projectRoot, 'src', 'eai.config', 'object-types.json'),
          EAI_OBJECT_TYPES_PROVISIONING_OUTPUT_PATH: join(projectRoot, 'src', 'eai.config', 'object-types.provisioning.json') }, timeout });
      entry.exitCode = result.status; entry.status = result.status === 0 ? 'passed' : 'failed';
      entry.durationMs = Math.max(0, now() - started); checkpoint();
      return result;
    } catch (error) {
      entry.status = 'failed'; entry.durationMs = Math.max(0, now() - started); checkpoint();
      throw error;
    }
  }
  function publicGet(path, scope, options = {}) {
    return json(['publicapi', 'get', path, '--tenant-id', scope, '--format', 'json'], options).body;
  }
  function absent(path, scope) {
    const result = eai(['publicapi', 'get', path, '--tenant-id', scope, '--format', 'json'], { allowFailure: true, cwd: controlRoot });
    const body = parseJson(result.stdout, {});
    assertion('explicit-404-after-delete', result.status !== 0 && body.ok === false && body.status === 404,
      'Deletion absence was not proven for ' + path + '.');
    report.commands.at(-1).status = 'passed'; checkpoint();
  }
  function cleanupStep(artifact, action, recordLeftover = true) {
    const receipt = { artifact, status: 'running' };
    report.cleanup.push(receipt); checkpoint();
    try { receipt.evidence = action(); receipt.status = 'passed'; } catch (error) {
      receipt.status = 'failed'; receipt.reason = redact(error.message);
      if (recordLeftover) report.leftovers.push({ artifact, reason: receipt.reason });
    }
    checkpoint();
  }
  function recordResource(type, id) {
    if (typeof id !== 'string' || !id || report.created.resources.some(row => row.type === type && row.id === id)) return;
    report.created.resources.push({ type, id }); checkpoint();
  }

  try {
    for (const key of ['EAI_E2E_TEST_PROFILE', 'EAI_E2E_TEST_USERNAME', 'EAI_E2E_PARENT_TENANT_ID'])
      assertion('prerequisite-' + key, Boolean(env[key]?.trim()), 'Live mode requires ' + key + '.', true);
    assertion('cleanup-preflight-file', Boolean(env.EAI_E2E_CLEANUP_PREFLIGHT) && existsSync(env.EAI_E2E_CLEANUP_PREFLIGHT),
      'EAI_E2E_CLEANUP_PREFLIGHT must name a fresh deployed child-delete route observation.', true);
    const allowedApis = ['https://dev-api.au.myenterprise.ai/public',
      ...['au', 'ca', 'eu'].map(region => 'https://test-api.' + region + '.myenterprise.ai/public')];
    assertion('non-production-api-scope', allowedApis.includes(expectedApi.replace(/\/$/, '')),
      'Live smoke permits canonical DEV AU or TEST AU/CA/EU PublicAPI URLs only.', true);
    assertion('mandatory-isolation-and-cleanup', env.EAI_E2E_CREATE_CHILD_TENANT !== '0' && env.EAI_E2E_CLEANUP !== '0',
      'Live mode always creates and cleans a child tenant; isolation or cleanup cannot be disabled.', true);
    assertion('valid-run-id', /^[0-9]{1,14}$/.test(runId), 'EAI_E2E_RUN_ID must contain 1-14 digits.', true);
    for (const key of ['EAI_E2E_ENV_MUTATION', 'EAI_E2E_WORKFLOW_REQUEST', 'EAI_E2E_RESOURCEAPI_REFRESH',
      'EAI_E2E_RESOURCEAPI_BUNDLE_APPLY', 'EAI_E2E_DOCS', 'EAI_E2E_CACHE_REFRESH'])
      assertion('supported-' + key, env[key] !== '1', key + ' needs a run-owned fixture and verified teardown; this runner does not execute that lane.', true);
    assertion('supported-EAI_E2E_INDEXES_APPLY', env.EAI_E2E_INDEXES_APPLY !== '1',
      'Index apply is unsupported: PublicAPI exposes dry-run index planning only.', true);
    assertion('run-owned-workflow-required', !env.EAI_E2E_WORKFLOW_KEY,
      'Use EAI_E2E_WORKFLOW_PROVISION=1; existing workflow keys are not run-owned fixtures.', true);
    assertion('operation-bound-doctor-required', !env.EAI_E2E_DEPLOYED_URL,
      'Use EAI_E2E_DEPLOY=1; doctor must bind to this run\'s exact operation.', true);
    if (env.EAI_E2E_INVITE_TEST_USER)
      assertion('invite-fixture-oid', Boolean(env.EAI_E2E_INVITE_TEST_USER_OID), 'EAI_E2E_INVITE_TEST_USER_OID is required for an existing QA identity.', true);
    if (env.EAI_E2E_CHAT === '1')
      assertion('chat-runtime-fixture', env.EAI_E2E_WORKFLOW_PROVISION === '1' && Boolean(env.EAI_E2E_AI_PROVIDER) && Boolean(env.EAI_E2E_AI_MODEL),
        'Chat requires EAI_E2E_WORKFLOW_PROVISION=1, EAI_E2E_AI_PROVIDER and EAI_E2E_AI_MODEL.', true);
    assertion('entra-rotation-prerequisite', env.EAI_E2E_ROTATE_ENTRA_SECRET !== '1' || env.EAI_E2E_PROVISION_ENTRA === '1',
      'Entra secret rotation requires EAI_E2E_PROVISION_ENTRA=1.', true);
    assertion('recreation-first-read-prerequisite', env.EAI_E2E_RECREATE_AFTER_DELETE !== '1' || env.EAI_E2E_REQUIRE_FIRST_EMPTY === '1',
      'Same-key recreation requires EAI_E2E_REQUIRE_FIRST_EMPTY=1.', true);
    const timeoutSeconds = Number(env.EAI_E2E_DEPLOY_TIMEOUT || '900');
    if (env.EAI_E2E_DEPLOY === '1')
      assertion('bounded-deploy-timeout', Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 1800,
        'EAI_E2E_DEPLOY_TIMEOUT must be 1-1800 seconds.', true);
    const whoami = eai(['whoami'], { cwd: controlRoot, allowFailure: true });
    assertion('authenticated-qa-profile', whoami.status === 0, 'Authenticate the explicit QA profile before live smoke.', true);
    const apiLine = whoami.stdout.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find(line => line.includes('PublicAPI'));
    const reportedUrls = apiLine?.match(/https?:\/\/\S+/g) || [];
    assertion('exact-dev-public-api', reportedUrls.some(url => url.replace(/\/$/, '') === expectedApi.replace(/\/$/, '')),
      'QA profile PublicAPI target does not match EAI_E2E_EXPECTED_PUBLIC_API.', true);
    const visibleParents = json(['tenant', 'list', '--format', 'json'], { cwd: controlRoot });
    assertion('qa-parent-visible-and-selectable', Array.isArray(visibleParents.tenants)
      && visibleParents.tenants.some(tenant => tenant.id === parentTenantId && tenant.isActive !== false && tenant.directMembership !== false),
      'The supplied QA parent is not visible as an active selectable workspace for this profile.', true);
    eai(['tenant', 'select', parentTenantId], { cwd: controlRoot, scopeTenantId: parentTenantId });
    const parent = json(['tenant', 'info', parentTenantId, '--format', 'json'], { cwd: controlRoot, scopeTenantId: parentTenantId });
    assertion('exact-qa-parent', parent.id === parentTenantId, 'QA parent identity did not match.', true);
    const identity = publicGet('/v4/identity/me', parentTenantId, { cwd: controlRoot });
    const actorId = identity?.oid || identity?.user?.oid;
    const actorEmail = identity?.email || identity?.upn || identity?.user?.email;
    assertion('exact-qa-actor', Boolean(actorId) && typeof actorEmail === 'string'
      && actorEmail.toLowerCase() === expectedUsername.toLowerCase()
      && (!env.EAI_E2E_TEST_USER_OID || actorId === env.EAI_E2E_TEST_USER_OID),
    'Authenticated QA actor does not match the explicit expected identity.', true);
    const management = publicGet('/v4/platform/tenants/' + encodeURIComponent(parentTenantId) + '/management', parentTenantId, { cwd: controlRoot });
    assertion('qa-parent-management', management?.id === parentTenantId, 'Explicit QA parent management could not be verified.', true);
    const memberships = publicGet('/v4/platform/users/' + encodeURIComponent(actorId)
      + '/memberships?tenant_id=' + encodeURIComponent(parentTenantId), parentTenantId, { cwd: controlRoot });
    assertion('parent-admin-create-bootstrap-cleanup', Array.isArray(memberships?.tenants)
      && memberships.tenants.some(member => member.id === parentTenantId && Array.isArray(member.roles)
        && member.roles.includes('tenant-admin') && member.isActive !== false),
      'The exact QA actor requires an active tenant-admin membership in the explicit parent.', true);
    const preflight = parseJson(readFileSync(env.EAI_E2E_CLEANUP_PREFLIGHT, 'utf8'), {});
    const age = now() - Date.parse(preflight.observedAt);
    assertion('deployed-parent-cleanup-contract', preflight.schemaVersion === 'eai.cli-child-cleanup-preflight.v1'
      && preflight.publicApiUrl === expectedApi && preflight.parentTenantId === parentTenantId && preflight.actorId === actorId
      && /^[a-f0-9]{40}$/.test(preflight.publicApiGitSha || '') && /^[a-f0-9]{40}$/.test(preflight.adminApiGitSha || '')
      && preflight.childDeleteRoute === '/v4/platform/tenants/{parent}/children/{child}/delete' && preflight.childDeleteVerified === true
      && Number.isFinite(age) && age >= -60000 && age <= 3600000,
    'Deployed child-delete route observation is missing, stale or mismatched to DEV, QA parent or actor.', true);
    report.preflight = { publicApiGitSha: preflight.publicApiGitSha, adminApiGitSha: preflight.adminApiGitSha,
      childDeleteRoute: preflight.childDeleteRoute, observedAt: preflight.observedAt }; checkpoint();
    const capability = json(['publicapi', 'post', '/v4/platform/capabilities/evaluate', '--tenant-id', parentTenantId,
      '--data', JSON.stringify({ tenant_id: parentTenantId, target_capability: 'child-tenants', requested_operation: 'create' }),
      '--format', 'json'], { cwd: controlRoot }).body;
    const reasonCode = typeof capability?.reasonCode === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(capability.reasonCode)
      ? capability.reasonCode : 'capability_not_allowed';
    report.preflight.childCreate = { outcome: capability?.outcome || 'unknown', reasonCode }; checkpoint();
    assertion('child-create-capability-allowed', capability?.outcome === 'allow',
      'DEV child-tenants create is blocked: ' + reasonCode + '. Use an eligible dedicated QA workspace; resolve subscription or admin prerequisites first.', true);
    if (env.EAI_E2E_INVITE_TEST_USER) {
      // user list requires a project even with --tenant. Keep this read-only
      // project context separate from both control commands and the future app.
      const readRoot = join(runRoot, 'invite-read-context');
      mkdirSync(readRoot, { mode: 0o700 });
      writeFileSync(join(readRoot, 'eai.config.ts'), 'export default {};\n', { mode: 0o600 });
      const readEnv = { EAI_PROFILE: profile, BASE_URL_PUBLIC_API: expectedApi,
        ROUTING_BOOTSTRAP_PUBLIC_API_URL: expectedApi, EAI_TENANT_ID: parentTenantId };
      writeFileSync(join(readRoot, '.env.local'), Object.entries(readEnv)
        .map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
      const members = json(['user', 'list', '--tenant', parentTenantId, '--search', env.EAI_E2E_INVITE_TEST_USER, '--format', 'json'], { cwd: readRoot }).data;
      assertion('existing-invite-fixture', Array.isArray(members) && members.some(member =>
        String(member.email || '').toLowerCase() === env.EAI_E2E_INVITE_TEST_USER.toLowerCase()
        && [member.userId, member.oid, member.id].includes(env.EAI_E2E_INVITE_TEST_USER_OID)),
      'Invite fixture must be an exact existing QA parent member; directory-user deletion is unavailable.', true);
    }

    phase = 'isolation'; childAttempted = true;
    const created = json(['tenant', 'create', '--name', 'EAI CLI Audit ' + runId + ' ' + nonce, '--slug', appName,
      '--parent', parentTenantId, '--domain', appName + '.example.invalid', '--usecase', 'generic', '--industry', 'test',
      '--starter-template', 'eai-app-template', ...(env.EAI_E2E_CHILD_HOME_REGION ? ['--home-region', env.EAI_E2E_CHILD_HOME_REGION] : []),
      '--format', 'json'], { cwd: controlRoot, observe(result) {
        const payload = parseJson(result.stdout, {});
        if (result.status !== 0 && payload.ok === false && [400, 401, 403, 404, 409, 422].includes(payload.status)) {
          childAttempted = false;
          if (payload.status === 403) throw new SmokeBlocked('DEV denied child creation for the QA actor; no creation was acknowledged.');
        }
        const tenant = payload.tenant;
        if (tenant?.reused === true) childAttempted = false;
        const immediateParent = tenant?.parentTenantId ?? tenant?.parentTenant?.id ?? tenant?.parentTenant;
        if (tenant && typeof tenant.id === 'string' && tenant.id !== parentTenantId && tenant.slug === appName
          && immediateParent === parentTenantId && tenant.reused !== true) {
          report.created.childTenantId = tenant.id; childOwned = true; checkpoint();
        }
      } });
    assertion('created-child-ownership', childOwned && created.tenant.id === child(),
      'Child creation did not acknowledge the exact run-specific tenant; cleanup ownership cannot be inferred.');
    const bootstrap = json(['tenant', 'bootstrap-admin', '--parent', parentTenantId, '--child', child(),
      '--user-oid', actorId, '--user-email', actorEmail, '--format', 'json'], { cwd: controlRoot, scopeTenantId: child() });
    assertion('child-admin-bootstrap', bootstrap.childTenantId === child() && bootstrap.parentTenantId === parentTenantId
      && bootstrap.userOid === actorId && bootstrap.usable === true && typeof bootstrap.membershipCreated === 'boolean'
      && typeof bootstrap.adminAssigned === 'boolean' && ['bootstrapped', 'already-usable'].includes(bootstrap.status)
      && (bootstrap.status !== 'already-usable' || (bootstrap.membershipCreated === false && bootstrap.adminAssigned === false)),
      'Child tenant bootstrap was not confirmed.');
    eai(['tenant', 'select', child()], { cwd: controlRoot, scopeTenantId: child() });
    phase = 'app'; appAttempted = true;
    const app = json(['app', 'create', appName, '--key', appName, '--tenant-id', child(), '--format', 'json'], {
      cwd: controlRoot, observe(result) {
        const body = parseJson(result.stdout, {});
        if (result.status !== 0 && body.ok === false && [400, 401, 403, 404, 409, 422].includes(body.status)) appAttempted = false;
        const response = body.response, enrollment = response?.app, created = response?.created;
        const childId = response?.childTenant?.id;
        const exactChildBinding = childId ? (typeof childId === 'string' && enrollment?.childTenantId === childId)
          : !enrollment?.childTenantId;
        if (body.tenantId === child() && body.appKey === appName && response?.tenantId === child()
          && response?.appKey === appName && response?.verticalKey === appName
          && enrollment?.tenantId === child() && enrollment?.parentTenantId === child() && enrollment?.verticalKey === appName
          && created?.app === true && typeof created.childTenant === 'boolean'
          && exactChildBinding && (!created.childTenant || childId)
          && typeof enrollment.id === 'string' && enrollment.id) {
          report.created.appKey = appName; report.created.enrollmentId = enrollment.id; appOwned = true;
          // The no-child response explicitly binds enrollment.parentTenantId; never infer ownership from ambient context.
          report.created.runtimeTenantId = childId || enrollment.parentTenantId; checkpoint();
        }
      } });
    assertion('created-app-ownership', appOwned, 'App creation did not acknowledge a new exact enrollment.');
    assertion('runtime-creation-binding', runtime() === child()
      || (app.response.created.childTenant === true && app.response.childTenant?.id === runtime()),
    'App runtime must be the run-created child or an acknowledged new descendant.');
    runtimeOwned = runtime() === child();
    if (runtime() !== child()) {
      const management = publicGet('/v4/platform/tenants/' + encodeURIComponent(runtime()) + '/management', child(), { cwd: controlRoot });
      assertion('runtime-isolated-descendant', management?.id === runtime()
        && (management.parentTenantId || management.parentTenant?.id || management.parentTenant) === child(),
      'App runtime is outside the disposable child boundary.');
      runtimeOwned = true;
      json(['tenant', 'bootstrap-admin', '--parent', child(), '--child', runtime(),
        '--user-oid', actorId, '--user-email', actorEmail, '--format', 'json'], { cwd: controlRoot, scopeTenantId: runtime() });
    }
    eai(['init', appName, '--app-key', appName, '--skip-prompts', '--current-dir', '--company-workspace', child(),
      '--package-profile', 'external', '--no-splash'], { timeout: 600000, scopeTenantId: child() });
    assertion('scaffold-bound-to-isolation', readEnvValue(projectRoot, 'EAI_PARENT_TENANT_ID') === child()
      && readEnvValue(projectRoot, 'EAI_TENANT_ID') === runtime() && readEnvValue(projectRoot, 'EAI_APP_KEY') === appName,
    'Scaffold binding differs from this run\'s acknowledged child/app/runtime.');
    json(['start', '--check', '--format', 'json']);
    json(['user', 'provision-me', '--workspace', runtime(), '--format', 'json']);
    json(['user', 'roles', '--workspace', runtime(), '--format', 'json']);
    const ownMembers = json(['user', 'list', '--tenant', runtime(), '--search', actorEmail, '--format', 'json']);
    assertion('qa-child-membership', Array.isArray(ownMembers.data) && ownMembers.data.some(member =>
      String(member.email || '').toLowerCase() === actorEmail.toLowerCase()), 'QA membership was not visible in the isolated runtime.');
    if (env.EAI_E2E_INVITE_TEST_USER) {
      const args = ['--email', env.EAI_E2E_INVITE_TEST_USER, '--tenant', runtime(), '--role', env.EAI_E2E_INVITE_ROLE || 'tenant-viewer', '--format', 'json'];
      const observeInvite = result => {
        const invitation = parseJson(result.stdout, {});
        if (invitation.userId && invitation.userId !== env.EAI_E2E_INVITE_TEST_USER_OID) {
          report.created.directoryUsers.push(invitation.userId);
          report.leftovers.push({ artifact: 'directory-user:' + invitation.userId, reason: 'Unexpected global identity; CLI has no directory-user deletion.' });
          checkpoint();
        }
      };
      const invited = json(['user', 'invite', ...args], { observe: observeInvite });
      assertion('invite-reused-existing-user', invited.inviteMode === 'existing_user_reused' && invited.userId === env.EAI_E2E_INVITE_TEST_USER_OID,
        'Invite returned an unexpected or newly-created directory identity; global cleanup is not proven.');
      const assigned = json(['user', 'role', 'set', ...args], { observe: observeInvite });
      assertion('role-assignment-existing-user', assigned.userId === env.EAI_E2E_INVITE_TEST_USER_OID,
        'Role assignment did not retain the exact existing QA identity.');
      const members = json(['user', 'list', '--tenant', runtime(), '--search', env.EAI_E2E_INVITE_TEST_USER, '--format', 'json']);
      assertion('invite-child-membership', members.data?.some(member =>
        [member.userId, member.oid, member.id].includes(env.EAI_E2E_INVITE_TEST_USER_OID)), 'Invited membership was not visible.');
    }
    if (env.EAI_E2E_NEGATIVE_TESTS === '1') {
      const invalid = eai(['user', 'invite', '--email', 'not-an-email', '--tenant', runtime(), '--role', 'tenant-viewer', '--format', 'json'], { allowFailure: true });
      assertion('invalid-invite-rejected', invalid.status !== 0, 'Invalid email unexpectedly succeeded.');
      report.commands.at(-1).status = 'passed'; checkpoint();
    }

    phase = 'local-checks';
    for (const args of [
      ['agent', 'guide', '--format', 'json'], ['errors', 'list', '--format', 'json'], ['errors', 'explain', 'E101', '--format', 'json'],
      ['blocks', 'list', '--format', 'json'], ['blocks', 'readiness', '--format', 'json'], ['blocks', 'schema', '--format', 'json'],
      ['blocks', 'validate', '--format', 'json'], ['runtime', 'validate', '--format', 'json'], ['template', 'check', '--format', 'json'],
      ['gofer', 'refresh', '--check', '--format', 'json'], ['deploy', 'env', '--provider', 'generic', '--format', 'json'], ['env', 'list', '--format', 'json'],
    ]) json(args);
    eai(['update', '--check', '--no-project-refresh']);
    const blocks = json(['blocks', 'list', '--format', 'json']);
    const blockId = blocks.blocks?.[0]?.id || blocks.items?.[0]?.id;
    if (blockId) json(['blocks', 'describe', blockId, '--format', 'json']);
    eai(['deploy', 'setup']); // No --repo: local workflow only.

    phase = 'storage';
    json(['app', 'list', '--tenant-id', child(), '--format', 'json']);
    json(['app', 'select', appName, '--tenant-id', child(), '--format', 'json']);
    const appProvisioning = json(['app', 'provision', appName, '--tenant-id', child(), '--select', '--format', 'json'], { timeout: 960000 });
    assertion('exact-app-provisioning-ready', appProvisioning.tenantId === child() && appProvisioning.targetTenantId === runtime()
      && appProvisioning.appKey === appName && appProvisioning.provisioning?.status === 'ready'
      && appProvisioning.provisioning.tenantId === child() && appProvisioning.provisioning.appKey === appName
      && typeof appProvisioning.provisioning.jobId === 'string' && Boolean(appProvisioning.provisioning.jobId)
      && typeof appProvisioning.provisioning.enrollment === 'object' && appProvisioning.provisioning.enrollment !== null
      && !Array.isArray(appProvisioning.provisioning.enrollment) && (runtime() === child()
        ? appProvisioning.provisioning.enrollment.childTenantId === undefined
          || appProvisioning.provisioning.enrollment.childTenantId === null
          || appProvisioning.provisioning.enrollment.childTenantId === runtime()
        : appProvisioning.provisioning.enrollment.childTenantId === runtime()),
    'App provisioning did not return exact persisted job readiness.');
    assertion('provision-keeps-runtime', readEnvValue(projectRoot, 'EAI_TENANT_ID') === runtime(), 'App provisioning changed runtime scope.');
    json(['provision', 'storage', '--tenant-id', runtime(), '--format', 'json']);
    writeSmokeObjectTypes(projectRoot, appName, runId, runtime());
    // Follow the selected app template's source-to-generated-artifact contract.
    // This must precede validation/seed and any independent app-build lane.
    const generated = appNpm('build:object-types', 120000);
    assertion('consultant-object-types-generation', generated.status === 0, 'Scaffolded Object Type generation failed.');
    const generatedCheck = appNpm('check:object-types', 120000);
    assertion('consultant-object-types-generated-current', generatedCheck.status === 0, 'Generated Object Type artifacts are missing or stale.');
    const definitions = smokeObjectTypes(appName, runId, runtime());
    const [pgType, docType, fileType, searchType] = definitions.map(definition => definition.slug);
    const bundleFile = join(projectRoot, 'smoke-object-types.json');
    createJsonFile(bundleFile, { objectTypes: definitions });
    json(['provision', 'resourceapi-bundle', '--schema', bundleFile, '--tenant-id', runtime(), '--install-id', appName,
      '--product', appName, '--out', join(projectRoot, 'resourceapi-bundle.json'), '--format', 'json']);
    eai(['types', 'validate']);
    json(['types', 'seed', '--tenant-id', runtime(), '--tenant-key', appName, '--format', 'json']);
    json(['resources', 'sync-schema', '--tenant-id', runtime(), '--backend', 'documentdb', '--dry-run', '--format', 'json']);
    if (env.EAI_E2E_SYNC_SCHEMA_APPLY === '1') json(['resources', 'sync-schema', '--tenant-id', runtime(), '--format', 'json']);
    for (const args of [
      ['types', 'diff', '--tenant-id', runtime(), '--format', 'json'], ['resources', 'schema', '--tenant-id', runtime(), '--format', 'json'],
      ['resources', 'storage', 'status', '--tenant-id', runtime(), '--format', 'json'], ['resources', 'storage', 'doctor', '--tenant-id', runtime(), '--format', 'json'],
      ['resources', 'doctor', '--tenant-id', runtime(), '--format', 'json'], ['resources', 'performance-status', '--tenant-id', runtime(), '--format', 'json'],
      ['resources', 'indexes-plan', '--tenant-id', runtime(), '--object-type', pgType, docType, fileType, searchType, '--format', 'json'],
      ['verify', 'storage', '--tenant-id', runtime(), '--format', 'json'],
    ]) json(args);
    eai(['types', 'pull', '--tenant-id', runtime(), '--output', join(projectRoot, 'src', 'eai.config', 'object-types.generated.ts')]);
    eai(['tenant', 'select', runtime()], { scopeTenantId: runtime() });
    json(['tenant', 'storage', 'list', '--format', 'json'], { scopeTenantId: runtime() });
    json(['tenant', 'storage', 'verify', '--format', 'json'], { scopeTenantId: runtime() });
    eai(['verify', '--tenant-id', runtime()]);
    json(['verify', 'calls', '--tenant-id', runtime(), '--tenant-record', runtime(), '--user-email', actorEmail, '--format', 'json']);
    eai(['doctor']);
    json(['workflow', 'readiness', '--tenant', runtime(), '--format', 'json']);

    if (env.EAI_E2E_SYNC_SCHEMA_APPLY === '1') {
      phase = 'resource-lifecycle';
      function create(type, data) {
        const body = json(['resources', 'create', type, '--tenant-id', runtime(), '--data', JSON.stringify(data), '--format', 'json'],
          { observe: result => recordResource(type, extractId(parseJson(result.stdout, {}))) });
        const id = extractId(body);
        assertion('resource-creation-id', Boolean(id), 'Resource creation returned no ID for ' + type + '.'); return id;
      }
      const pgId = create(pgType, { title: 'postgres smoke', status: 'draft', count: 1 });
      const docId = create(docType, { title: 'documentdb smoke', status: 'draft' });
      for (const [type, id, data] of [[pgType, pgId, { title: 'postgres smoke updated', status: 'updated', count: 2 }],
        [docType, docId, { title: 'documentdb smoke updated', status: 'updated' }]]) {
        json(['resources', 'get', type, id, '--tenant-id', runtime(), '--format', 'json']);
        json(['resources', 'update', type, id, '--tenant-id', runtime(), '--data', JSON.stringify(data), '--format', 'json']);
        const saved = json(['resources', 'get', type, id, '--tenant-id', runtime(), '--format', 'json']);
        assertion('resource-update-persisted', (saved.data || saved.resource?.data)?.title === data.title
          && (saved.data || saved.resource?.data)?.status === data.status, 'Updated resource was not persisted.');
      }
      const fileId = create(fileType, { title: 'file smoke', status: 'draft' });
      const upload = join(projectRoot, 'smoke-file.txt'), download = join(projectRoot, 'smoke-file-downloaded.txt');
      const contents = 'EAI file smoke ' + runId + '\n'; writeFileSync(upload, contents, 'utf8');
      json(['resources', 'file', 'upload', fileType, fileId, 'attachment', upload, '--tenant-id', runtime(), '--format', 'json']);
      eai(['resources', 'file', 'get', fileType, fileId, 'attachment', '--tenant-id', runtime(), '--output', download]);
      assertion('file-roundtrip-bytes', existsSync(download) && readFileSync(download, 'utf8') === contents, 'Downloaded bytes differ from uploaded fixture.');
      json(['resources', 'file', 'delete', fileType, fileId, 'attachment', '--tenant-id', runtime(), '--force', '--format', 'json']);
      absent('/v4/data/resources/' + encodeURIComponent(runtime()) + '/' + encodeURIComponent(fileType)
        + '/' + encodeURIComponent(fileId) + '/files/attachment', runtime());
      const term = 'eaismoke' + runId.toLowerCase() + nonce;
      const searchId = create(searchType, { title: 'search smoke', body: term, status: 'published' });
      for (const operation of ['batch-create', 'batch-import']) {
        const file = join(projectRoot, operation + '.json');
        createJsonFile(file, [{ title: operation + ' one', status: 'draft', count: 10 }, { title: operation + ' two', status: 'draft', count: 20 }]);
        const ids = [];
        const body = json(['resources', operation, pgType, '--tenant-id', runtime(), '--file', file,
          ...(operation === 'batch-import' ? ['--projection-mode', 'deferred'] : []), '--format', 'json'], { observe(result) {
            const payload = parseJson(result.stdout, {});
            for (const row of payload.results || payload.resources || payload.created || payload.items || []) {
              const id = row.id || row.resource?.id;
              if (typeof id === 'string' && id) { ids.push(id); batchIds.push(id); recordResource(pgType, id); }
            }
          } });
        assertion('complete-batch-creation', ids.length === 2 && body.failed === 0 && body.succeeded === 2, operation + ' did not acknowledge every row.');
      }
      const file = join(projectRoot, 'batch-update.json');
      createJsonFile(file, batchIds.map((id, index) => ({ id, version: 1,
        data: { title: 'batch updated ' + index, status: 'batch-updated', count: index + 10 } })));
      const updated = json(['resources', 'batch-update', pgType, '--tenant-id', runtime(), '--file', file, '--format', 'json']);
      assertion('complete-batch-update', updated.failed === 0 && updated.succeeded === batchIds.length, 'Batch update was partial.');
      const listed = json(['resources', 'list', pgType, '--tenant-id', runtime(), '--format', 'json']);
      assertion('created-row-visible', (listed.docs || listed.resources || listed.items || []).some(row => row.id === pgId), 'List missed the exact created row.');
      json(['resources', 'aggregate', pgType, '--tenant-id', runtime(), '--group-by', 'status',
        '--metrics', JSON.stringify({ total: { function: 'count' } }), '--format', 'json']);
      // Dedicated PostgreSQL queries must stay in one database. The three
      // DocumentDB-backed types share their PostgreSQL shadow placement; do not
      // combine them with the dedicated PostgreSQL route in a federated query.
      const queryFixtures = [
        { backend: 'postgresql', types: [pgType], rows: [
          [pgType, pgId, { title: 'postgres smoke updated', status: 'updated', count: 2 }],
          ...batchIds.map((id, index) => [pgType, id, { title: 'batch updated ' + index, status: 'batch-updated', count: index + 10 }]),
        ] },
        { backend: 'documentdb', types: [docType, fileType, searchType], rows: [
          [docType, docId, { title: 'documentdb smoke updated', status: 'updated' }],
          [fileType, fileId, { title: 'file smoke', status: 'draft' }],
          [searchType, searchId, { title: 'search smoke', body: term, status: 'published' }],
        ] },
      ];
      for (const fixture of queryFixtures) {
        const queried = json(['resources', 'query', '--tenant-id', runtime(), '--types', fixture.types.join(','), '--limit', '20', '--format', 'json']);
        assertion('query-' + fixture.backend + '-results-contract', Array.isArray(queried.results)
          && Number.isSafeInteger(queried.totalResults) && queried.totalResults === queried.results.length,
        'Query did not return a complete results contract for ' + fixture.backend + '.');
        for (const [type, id, expected] of fixture.rows) {
          assertion('query-' + fixture.backend + '-created-row-' + id, queried.results.some(result => {
            const row = result && typeof result === 'object' ? result[type] : undefined;
            return row?.id === id && row.data && typeof row.data === 'object'
              && Object.entries(expected).every(([key, value]) => row.data[key] === value);
          }), 'Query missed the exact created row or persisted data for ' + type + '.');
        }
      }
      let indexed = false;
      for (let attempt = 0; attempt < 10 && !indexed; attempt++) {
        const found = json(['resources', 'search', term, '--tenant-id', runtime(), '--types', searchType, '--fulltext', '--format', 'json']);
        indexed = Array.isArray(found.results) && found.results.some(row => (row.id || row.resourceId || row.resource?.id) === searchId);
        if (!indexed && attempt < 9) wait(2000);
      }
      assertion('exact-search-resource', indexed, 'Search did not return the exact run-created resource.');
    }

    if (env.EAI_E2E_WORKFLOW_PROVISION === '1') {
      phase = 'workflow';
      const key = appName + '-workflow';
      const provision = json(['workflow', 'provision', key, '--app', appName, '--tenant', runtime(), '--stage', 'chat:Chat',
        '--workflow-env-key', 'NEXT_PUBLIC_SMOKE_WORKFLOW_ID', '--write-local-env',
        ...(env.EAI_E2E_CHAT === '1' ? ['--bind-ai-runtime', '--ai-provider', env.EAI_E2E_AI_PROVIDER,
          '--ai-model', env.EAI_E2E_AI_MODEL, '--stage-prompt', 'chat=Reply READY.'] : []), '--format', 'json'], { observe(result) {
        const body = parseJson(result.stdout, {});
        if (body.tenantId !== runtime()) return;
        if (body.workflow?.objectType === 'shared-workflow-config' && body.workflow.workflowKey === key
          && body.workflow.action === 'created' && typeof body.workflow.id === 'string' && body.workflow.id) {
          recordResource(body.workflow.objectType, body.workflow.id);
          report.created.workflowIds.push(body.workflow.id); checkpoint();
        }
        if (body.app?.objectType === 'vertical-product-config' && body.app.appKey === appName
          && body.app.configKey === 'workflow:' + key && body.app.action === 'created') recordResource(body.app.objectType, body.app.id);
        for (const row of Array.isArray(body.aiRuntime) ? body.aiRuntime : []) {
          if (row.action === 'created' && ((row.objectType === 'shared-ai-profile' && row.key === key + '-default-model')
            || (row.objectType === 'shared-chatbot-config' && row.key === key + '-chat'))) recordResource(row.objectType, row.id);
        }
      } });
      assertion('workflow-provisioned-scope', provision.tenantId === runtime()
        && provision.workflow?.objectType === 'shared-workflow-config' && provision.workflow.workflowKey === key
        && provision.workflow.action === 'created' && typeof provision.workflow.id === 'string' && Boolean(provision.workflow.id)
        && provision.app?.objectType === 'vertical-product-config' && provision.app.appKey === appName
        && provision.app.configKey === 'workflow:' + key && provision.app.action === 'created'
        && typeof provision.app.id === 'string' && Boolean(provision.app.id),
      'Workflow provisioning did not acknowledge exact newly created workflow and app config resources.');
      const id = readEnvValue(projectRoot, 'NEXT_PUBLIC_SMOKE_WORKFLOW_ID');
      assertion('workflow-provisioned-id', id === provision.workflow.id && provision.env?.NEXT_PUBLIC_SMOKE_WORKFLOW_ID === id,
        'Provisioning did not save its exact acknowledged workflow resource ID.');
      const savedWorkflow = json(['resources', 'get', 'shared-workflow-config', id, '--tenant-id', runtime(), '--format', 'json']);
      const workflowData = savedWorkflow.data;
      assertion('workflow-config-persisted', savedWorkflow.id === id && workflowData?.tenantId === runtime()
        && workflowData.workflowKey === key && workflowData.status === 'active'
        && Array.isArray(workflowData.consumedBy) && workflowData.consumedBy.includes(appName)
        && Array.isArray(workflowData.definition?.workflowDefinition?.stages)
        && workflowData.definition.workflowDefinition.stages.some(stage => stage.id === 'chat' && stage.code === 'chat'),
      'Provisioned workflow config was not persisted in its exact runtime.');
      const savedAppConfig = json(['resources', 'get', 'vertical-product-config', provision.app.id,
        '--tenant-id', runtime(), '--format', 'json']);
      const appConfigData = savedAppConfig.data;
      assertion('workflow-app-config-persisted', savedAppConfig.id === provision.app.id && appConfigData?.tenantId === runtime()
        && appConfigData.verticalKey === appName && appConfigData.configKey === 'workflow:' + key
        && appConfigData.config?.workflowKey === key && appConfigData.config.setupStatus === 'completed'
        && appConfigData.config.setup?.stageIds?.chat === 'chat', 'Provisioned workflow app binding was not persisted.');
      const readiness = json(['workflow', 'status', key, '--tenant', runtime(), '--format', 'json']);
      assertion('workflow-status-exact-scope', readiness.workflowKey === key && readiness.tenantId === runtime()
        && ['available', 'not_ready', 'blocked', 'operator_required', 'paid_upgrade_required', 'rate_limited', 'upgrade_required', 'unsupported'].includes(readiness.status)
        && typeof readiness.reasonCode === 'string' && Boolean(readiness.reasonCode)
        && (readiness.status !== 'available' || (typeof readiness.runtimeWorkflowRef === 'string' && Boolean(readiness.runtimeWorkflowRef))),
      'Workflow status did not return the exact public workflow key and runtime readiness contract.');
      report.workflowReadiness = { workflowKey: key, status: readiness.status, reasonCode: readiness.reasonCode,
        executable: readiness.status === 'available' };
      if (readiness.status !== 'available') {
        const entry = report.commands.at(-1);
        entry.status = 'incomplete'; entry.coverageComplete = false;
        entry.reason = 'Workflow config was saved; executable AICore runtime binding is not available (' + readiness.status + ').';
      }
      checkpoint();
      if (env.EAI_E2E_CHAT === '1') {
        const chat = eai(['chat', 'send', 'Reply READY.', '--workflow', key, '--stage', 'chat']);
        assertion('chat-response', /\bREADY\b/.test(chat.stdout), 'Chat did not return the expected fixture response.');
      }
    }
    if (env.EAI_E2E_PROVISION_ENTRA === '1') {
      phase = 'app-sign-in'; entraAttempted = true;
      try {
        eai(['provision', 'entra', '--company-tenant', child(), '--app-key', appName, '--tenant-id', runtime(), '--create-local-secret', '--force']);
      } finally { report.created.entraClientId = readEnvValue(projectRoot, 'ENTRA_CLIENT_ID'); checkpoint(); }
      assertion('entra-client-captured', Boolean(report.created.entraClientId), 'Entra setup did not persist its client ID.');
      const auth = json(['app', 'auth', 'status', appName, '--tenant-id', runtime(), '--client-id', report.created.entraClientId, '--skip-validate', '--format', 'json']);
      assertion('entra-runtime-authorized', auth.tenantAuthorizedApps?.status === 'authorized', 'Entra client was not authorized for the isolated runtime.');
      if (env.EAI_E2E_ROTATE_ENTRA_SECRET === '1') {
        const before = readEnvValue(projectRoot, 'ENTRA_CLIENT_SECRET');
        eai(['provision', 'entra', '--rotate-secret']);
        const after = readEnvValue(projectRoot, 'ENTRA_CLIENT_SECRET');
        assertion('rotation-changed-local-credential', Boolean(before) && Boolean(after) && before !== after,
          'Successful rotation did not replace the isolated app credential.');
        report.rotationCycle = { clientId: report.created.entraClientId, tenantId: runtime(), appKey: appName,
          commandDispatches: 1, credentialChanged: true }; checkpoint();
      }
    }
    if (env.EAI_E2E_BUILD !== '0') {
      phase = 'build';
      const build = appNpm('build', 600000);
      assertion('consultant-app-build', build.status === 0, 'Scaffolded consultant app build failed.');
    }
    if (env.EAI_E2E_DEPLOY === '1') {
      phase = 'managed-deploy';
      json(['deploy', 'source', 'validate', '--format', 'json'], { timeout: 180000 });
      const result = eai(['deploy', 'app', appName, '--target', 'eai', '--tenant-id', child(), '--target-tenant-id', runtime(),
        '--source', 'eai-managed', '--environment', 'preview', '--wait', '--timeout', String(timeoutSeconds), '--format', 'json'],
        { allowFailure: true, timeout: (timeoutSeconds + 30) * 1000 });
      const deployed = parseJson(result.stdout, {});
      if (typeof deployed.operationId === 'string' && deployed.tenantId === child()
        && deployed.targetTenantId === runtime() && deployed.appKey === appName) {
        report.created.deploymentOperationId = deployed.operationId; checkpoint();
      }
      if (['GITHUB_IDENTITY_VERIFICATION_REQUIRED', 'GITHUB_LINK_REQUIRED', 'GITHUB_LINK_BROWSER_REQUIRED', 'GITHUB_LINK_PENDING',
        'GITHUB_LINK_SESSION_REQUIRED', 'GITHUB_LINK_SESSION_PENDING'].includes(deployed.error?.code)
        || deployed.status === 'pending_review' || deployed.classification === 'pending') {
        report.commands.at(-1).status = 'blocked';
        throw new SmokeBlocked('Managed deployment awaits actor verification, review or operation completion.');
      }
      assertion('exact-deployment-operation', result.status === 0 && deployed.tenantId === child()
        && deployed.targetTenantId === runtime() && deployed.appKey === appName && deployed.classification === 'succeeded'
        && typeof deployed.operationId === 'string' && Boolean(deployed.activeUrl) && Boolean(deployed.deploymentId),
      'Managed deployment did not complete an exact operation bound to this run.');
      const doctor = json(['deploy', 'doctor', '--operation-id', deployed.operationId, '--app-key', appName, '--tenant-id', child(),
        '--target-tenant-id', runtime(), '--evidence-out', join(runRoot, 'deploy-doctor.json'), '--format', 'json'], { timeout: 180000 });
      assertion('operation-bound-doctor', doctor.status === 'pass', 'Deployment doctor failed.');
    }
  } catch (error) {
    originalError = error; report.status = error instanceof SmokeBlocked ? 'blocked' : 'failed'; report.error = redact(error.message);
  } finally {
    phase = 'cleanup';
    if (childOwned) {
      let batchDeleted = false;
      if (batchIds.length) cleanupStep('batch-resources', () => {
        const file = join(projectRoot, 'batch-delete.json'); createJsonFile(file, batchIds.map(id => ({ id })));
        const body = json(['resources', 'batch-delete', report.created.resources.find(row => batchIds.includes(row.id)).type,
          '--tenant-id', runtime(), '--file', file, '--force', '--format', 'json']);
        assertion('complete-batch-delete', body.failed === 0 && body.succeeded === batchIds.length, 'Batch deletion was partial.');
        batchDeleted = true; return { acknowledged: batchIds.length };
      }, false);
      for (const row of [...report.created.resources].reverse()) cleanupStep('resource:' + row.type + '/' + row.id, () => {
        const path = '/v4/data/resources/' + encodeURIComponent(runtime()) + '/' + encodeURIComponent(row.type) + '/' + encodeURIComponent(row.id);
        let alreadyAbsent = false;
        if (!batchDeleted && batchIds.includes(row.id)) {
          const result = eai(['publicapi', 'get', path, '--tenant-id', runtime(), '--format', 'json'], { allowFailure: true, cwd: controlRoot });
          const body = parseJson(result.stdout, {});
          alreadyAbsent = result.status !== 0 && body.ok === false && body.status === 404;
          assertion('batch-fallback-resource-observed', alreadyAbsent || (result.status === 0 && body.ok === true && body.body?.id === row.id),
            'Batch fallback could not verify the exact resource or its absence.');
          report.commands.at(-1).status = 'passed'; checkpoint();
        }
        if (!alreadyAbsent && (!batchDeleted || !batchIds.includes(row.id)))
          json(['resources', 'delete', row.type, row.id, '--tenant-id', runtime(), '--force', '--format', 'json']);
        absent(path, runtime());
        return { absenceVerified: true };
      });
      if (report.created.entraClientId) cleanupStep('entra-registration', () => {
        eai(['provision', 'entra', '--deauthorize', '--client-id', report.created.entraClientId, '--force']);
        // First-class cleanup is text-only. An idempotent repeat returns the JSON server receipt.
        const result = json(['publicapi', 'delete', '/v4/platform/provisioning/entra-apps/' + encodeURIComponent(report.created.entraClientId),
          '--tenant-id', runtime(), '--data', JSON.stringify({ tenant_id: runtime(), delete_registration: true }), '--format', 'json']);
        assertion('entra-cleanup-receipt', entraDeletionReceiptVerified(result.body, report.created.entraClientId, runtime()),
        'Entra deletion receipt did not prove authorization and registration absence.');
        return { clientId: report.created.entraClientId, tenantId: runtime(), authorizationAbsent: true,
          registrationAbsent: true, registrationAbsenceVerified: true, absenceMethod: 'exact-deauthorization-and-graph-backed-registration-receipt' };
      });
      else if (entraAttempted) report.leftovers.push({ artifact: 'entra-registration', reason: 'Creation attempted without an acknowledged exact registration ID.' });
      if (appOwned) cleanupStep('app', () => {
        const plan = publicGet('/v4/platform/tenants/' + encodeURIComponent(child()) + '/apps/' + encodeURIComponent(appName) + '/deletion-plan', child(), { cwd: controlRoot });
        const ownedTargets = runtimeOwned ? [child(), runtime()] : [child()];
        assertion('app-cleanup-targets-isolated', plan?.tenantId === child() && plan?.appKey === appName
          && plan.cleanupContract === 'eai.app-scoped-cleanup.v2' && Array.isArray(plan.runtimeTenantIds)
          && plan.runtimeTenantIds.includes(child()) && plan.runtimeTenantIds.every(id => ownedTargets.includes(id)),
        'App cleanup plan includes an unowned runtime target or lacks the app-scoped cleanup contract.');
        const receipt = json(['app', 'delete', appName, '--tenant-id', child(), '--confirm', appName, '--non-interactive', '--format', 'json'], { cwd: controlRoot });
        assertion('app-deletion-receipt', receipt.schemaVersion === 'eai.app-deletion-receipt.v1'
          && receipt.status === 'deleted' && receipt.verified === true && receipt.appKey === appName && receipt.tenantId === child()
          && typeof receipt.operationId === 'string' && receipt.operationId.length > 0, 'Exact app deletion receipt was not verified.');
        report.deletionCycle = { tenantId: child(), appKey: appName, enrollmentId: report.created.enrollmentId,
          deletionVerified: true, firstInventoryEmpty: false, recreatedSameKey: false }; checkpoint();
        let apps;
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = eai(['app', 'list', '--tenant-id', child(), '--format', 'json'],
            { cwd: controlRoot, allowFailure: true });
          if (result.status === 0) {
            apps = parseJson(result.stdout, undefined);
            assertion('valid-app-inventory-json', apps && typeof apps === 'object', 'App inventory did not return JSON.');
            if (attempt === 0) report.deletionCycle.firstInventoryEmpty = Array.isArray(apps.apps) && apps.apps.length === 0;
            checkpoint();
            if (env.EAI_E2E_REQUIRE_FIRST_EMPTY === '1') assertion('first-app-inventory-empty',
              report.deletionCycle.firstInventoryEmpty, 'The first app inventory after verified deletion must be successful and empty.');
            break;
          }
          if (env.EAI_E2E_REQUIRE_FIRST_EMPTY === '1') assertion('first-app-inventory-empty', false,
            'The first app inventory after verified deletion failed; retrying cannot qualify first-read freshness.');
          const retryable = /\b(?:429 Too Many Requests|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)\b/
            .test(result.stderr || '');
          report.commands.at(-1).retryableReadFailure = retryable; checkpoint();
          if (!retryable || attempt === 2) throw new Error('App enrollment absence could not be verified after deletion.');
          wait(1000 * (attempt + 1));
        }
        assertion('app-enrollment-absent', Array.isArray(apps.apps) && !apps.apps.some(row =>
          (row.data?.verticalKey || row.verticalKey) === appName || row.id === report.created.enrollmentId), 'App enrollment remains after deletion.');
        if (env.EAI_E2E_RECREATE_AFTER_DELETE === '1') {
          assertion('recreate-same-owned-runtime', runtime() === child(), 'Recreation qualification requires the original run-owned runtime to be the company child.');
          let recreatedId;
          try {
            const recreated = json(['app', 'create', appName, '--key', appName, '--tenant-id', child(), '--format', 'json'], {
              cwd: controlRoot, observe(result) {
                const body = parseJson(result.stdout, {}), response = body.response, enrollment = response?.app;
                if (body.tenantId === child() && body.appKey === appName && response?.tenantId === child()
                  && response.appKey === appName && response.verticalKey === appName && response.created?.app === true
                  && response.created.childTenant === false && !enrollment?.childTenantId && enrollment?.tenantId === child()
                  && enrollment.parentTenantId === child() && enrollment.verticalKey === appName
                  && typeof enrollment.id === 'string' && enrollment.id) {
                  recreatedId = enrollment.id; report.created.recreatedEnrollmentId = recreatedId; checkpoint();
                }
              } });
            assertion('new-enrollment-same-key', Boolean(recreatedId) && recreatedId !== report.created.enrollmentId
              && recreated.response.app.id === recreatedId, 'Recreation must return a fresh enrollment ID for the same exact app key.');
            report.deletionCycle.recreatedSameKey = true; report.deletionCycle.recreatedEnrollmentId = recreatedId; checkpoint();
            const inventory = json(['app', 'list', '--tenant-id', child(), '--format', 'json'], { cwd: controlRoot });
            assertion('recreated-enrollment-visible', Array.isArray(inventory.apps) && inventory.apps.length === 1
              && inventory.apps[0].id === recreatedId && inventory.apps[0].data?.verticalKey === appName,
            'Recreated app inventory does not contain exactly the fresh same-key enrollment.');
          } finally {
            if (recreatedId) {
              const cleanup = json(['app', 'delete', appName, '--tenant-id', child(), '--confirm', appName,
                '--non-interactive', '--format', 'json'], { cwd: controlRoot });
              assertion('recreated-app-deletion-receipt', cleanup.schemaVersion === 'eai.app-deletion-receipt.v1'
                && cleanup.status === 'deleted' && cleanup.verified === true && cleanup.appKey === appName
                && cleanup.tenantId === child(), 'Recreated app deletion was not verified.');
              const inventory = json(['app', 'list', '--tenant-id', child(), '--format', 'json'], { cwd: controlRoot });
              assertion('recreated-app-first-inventory-empty', Array.isArray(inventory.apps) && inventory.apps.length === 0,
                'Recreated app cleanup did not produce an empty first inventory.');
            } else report.leftovers.push({ artifact: 'recreated-app', reason: 'Creation attempted without an exact acknowledged new enrollment; physical child cleanup remains required.' });
          }
        }
        return { operationId: receipt.operationId, verified: true, enrollmentAbsent: true };
      });
      else if (appAttempted) report.leftovers.push({ artifact: 'app', reason: 'Creation attempted without an acknowledged new app receipt.' });
      function deleteLeaf(id, parentId) {
        eai(['tenant', 'select', parentId], { cwd: controlRoot, scopeTenantId: parentId });
        const receipt = json(['tenant', 'delete', id, '--parent', parentId, '--force', '--force-hard-purge', '--format', 'json'],
          { cwd: controlRoot, scopeTenantId: parentId });
        assertion('child-hard-purge-receipt', receipt.id === id && receipt.deleted === true && receipt.hardPurged === true
          && receipt.response?.status === 'hard_purged' && receipt.response.parentTenantId === parentId,
        'Parent-authorized leaf cleanup was not confirmed by the exact hard-purge receipt.');
        // Deleted-tenant policy fencing can deny management reads. Prove
        // absence through the still-authorized parent's complete inventory.
        let inventoryComplete = false;
        for (let offset = 0; offset < 1000 && !inventoryComplete; offset += 100) {
          const children = publicGet('/v4/platform/tenants/' + encodeURIComponent(parentId)
            + '/children?limit=100&offset=' + offset, parentId, { cwd: controlRoot });
          assertion('child-inventory-contract', Array.isArray(children) && children.length <= 100
            && children.every(row => typeof row?.id === 'string' && row.id.length > 0),
          'Parent child inventory did not return a complete page of exact tenant IDs.');
          assertion('purged-child-absent-from-parent', !children.some(row => row.id === id),
            'The hard-purged child remains in its parent inventory.');
          inventoryComplete = children.length < 100;
        }
        assertion('complete-parent-child-inventory', inventoryComplete,
          'Parent child inventory exceeded the bounded verification limit.');
        return { tenantId: id, parentTenantId: parentId, hardPurged: true, absenceVerified: true,
          absenceMethod: 'complete-parent-children-inventory' };
      }
      if (runtimeOwned && runtime() !== child()) cleanupStep('runtime-tenant', () => deleteLeaf(runtime(), child()));
      cleanupStep('child-tenant', () => deleteLeaf(child(), parentTenantId));
    } else if (childAttempted) report.leftovers.push({ artifact: 'child-tenant', reason: 'Creation attempted without an acknowledged run-specific tenant ID.' });
    report.coverage = coverageEvidence(report.commands);
    report.coverageComplete = report.coverage.every(row => row.status === 'passed');
    const artifactCleanup = report.cleanup.filter(row => row.artifact !== 'batch-resources');
    report.cleanupRequired = childAttempted || appAttempted || entraAttempted || artifactCleanup.length > 0;
    report.cleanupVerified = artifactCleanup.length > 0 && !report.leftovers.length && artifactCleanup.every(row => row.status === 'passed');
    report.cleanupStatus = report.cleanupVerified ? 'verified' : report.cleanupRequired ? 'unverified' : 'not-needed';
    if (report.leftovers.length) report.status = 'failed';
    else if (!originalError) report.status = report.cleanup.some(row => row.status === 'failed') ? 'failed' : 'passed';
    checkpoint();
  }
  log('[e2e] Selected lifecycle ' + report.status + '; ' + report.coverage.filter(row => row.status === 'not-run').length
    + ' command surfaces not run. Summary: ' + summaryPath);
  if (report.status !== 'passed') {
    const error = originalError || new Error('Lifecycle cleanup was not verified.');
    error.message = redact(error.message) + (report.leftovers.length ? ' Cleanup left ' + report.leftovers.length + ' unverified artifact(s).' : '')
      + ' Summary: ' + summaryPath;
    error.report = report; error.summaryPath = summaryPath; throw error;
  }
  return { ...report, summaryPath, projectRoot };
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
  const source = readFileSync(typeFile, 'utf8');
  const module = ts.createSourceFile(typeFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = statement => statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const declarations = module.statements.filter(ts.isVariableStatement).flatMap(statement =>
    statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name)
      && declaration.name.text === 'objectTypes').map(declaration => ({ statement, declaration })));
  const producerTypes = module.statements.filter(statement => exported(statement)
    && ((ts.isInterfaceDeclaration(statement) && statement.name.text === 'ObjectTypeDefinition')
      || (ts.isTypeAliasDeclaration(statement) && statement.name.text === 'StorageBackend')));
  const { statement, declaration } = declarations[0] || {};
  const annotation = declaration?.type;
  const recordArguments = annotation && ts.isTypeReferenceNode(annotation) ? annotation.typeArguments : undefined;
  if (module.parseDiagnostics.length || declarations.length !== 1 || producerTypes.length !== 2
    || new Set(producerTypes.map(statement => statement.name.text)).size !== 2
    || !exported(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)
    || !annotation || !ts.isTypeReferenceNode(annotation) || !ts.isIdentifier(annotation.typeName)
    || annotation.typeName.text !== 'Record' || recordArguments?.length !== 2
    || recordArguments[0].kind !== ts.SyntaxKind.StringKeyword || !ts.isArrayTypeNode(recordArguments[1])
    || !ts.isTypeReferenceNode(recordArguments[1].elementType) || !ts.isIdentifier(recordArguments[1].elementType.typeName)
    || recordArguments[1].elementType.typeName.text !== 'ObjectTypeDefinition'
    || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    throw new Error('Scaffolded Object Type source does not expose the expected producer types and one exported objectTypes Record initializer.');
  }
  const definitions = smokeObjectTypes(appName, runId, tenantId);
  // Use the template's JSON data boundary, retaining its declared model API.
  // Replacing only the initializer preserves imports, interfaces and helper
  // exports, including optional fields and dynamic tenant-key indexing.
  const initializer = `JSON.parse(${JSON.stringify(JSON.stringify({ [appName]: definitions }))})`;
  const content = source.slice(0, declaration.initializer.getStart(module)) + initializer
    + source.slice(declaration.initializer.end);
  writeFileSync(typeFile, content, 'utf8');
}

function smokeObjectTypes(appName, runId, tenantId) {
  const tenantScope = tenantStorageScope(tenantId);
  const sqlPrefix = `${storageNamePrefix([tenantScope, appName], '_')}_`;
  const blobPrefix = `${storageNamePrefix([tenantScope, appName], '-')}-`;
  return [
    {
      name: `EaiSmokePg${runId}`,
      slug: `eai-smoke-pg${runId}`,
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
          tableName: `${sqlPrefix}pg`,
        },
      },
    },
    {
      name: `EaiSmokeDoc${runId}`,
      slug: `eai-smoke-doc${runId}`,
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
          collectionName: `${sqlPrefix}doc`,
          partitionKey: '/tenantId',
        },
      },
    },
    {
      name: `EaiSmokeFile${runId}`,
      slug: `eai-smoke-file${runId}`,
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
          collectionName: `${sqlPrefix}file`,
          partitionKey: '/tenantId',
        },
        blob: {
          storageAccountAlias: 'tenant-blob',
          containerName: `${blobPrefix}file`,
          blobPrefix: `${appName}/file/${runId}`,
        },
      },
    },
    {
      name: `EaiSmokeSearch${runId}`,
      slug: `eai-smoke-search${runId}`,
      displayName: `EAI Smoke Search ${runId}`,
      description: 'Full e2e smoke AI Search indexed Object Type.',
      status: 'published',
      storageBackend: 'documentdb',
      schemaVersion: 1,
      storageMetadataStatus: 'ready',
      properties: [
        { name: 'title', type: 'text', required: true, indexed: true },
        { name: 'body', type: 'text', required: true, indexed: true },
        { name: 'status', type: 'text', required: true, indexed: true },
      ],
      linkTypes: [],
      actions: [],
      storageBinding: {
        documentdb: {
          databaseAlias: 'tenant-documentdb',
          databaseName: 'tenant-control-plane',
          collectionName: `${sqlPrefix}search`,
          partitionKey: '/tenantId',
        },
        search: {
          searchServiceAlias: 'tenant-search',
          indexName: `${blobPrefix}search`,
          sourceObjectTypes: [`eai-smoke-search${runId}`],
          fieldMappings: { title: 'title', body: 'body' },
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
    console.log(`Full e2e traceability covers ${result.leafCommands} executable CLI entries (${result.liveRows} planned live rows).`);
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
  if (args.mode === 'local') runLocalSmoke(args.cli);
  else runLiveSmoke(args.cli);
}

module.exports = { runOptionalDocumentSmoke, runLiveSmoke, runLocalSmoke, writeSmokeObjectTypes, smokeObjectTypes, coverageEvidence, leafEntries, checkTraceability, candidateEvidence, entraDeletionReceiptVerified, TRACEABILITY, redact };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }
}
