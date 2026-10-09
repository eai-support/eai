# CLI backend lifecycle smoke

`npm run smoke:eai-full:check` checks the public command inventory against
the planned traceability table. It does not contact DEV or establish live parity.
The inventory includes action-bearing parents such as `eai verify`.

`node scripts/eai-full-e2e-smoke.cjs --local --cli dist/index.js` executes the
built candidate's local command contracts in disposable fixtures independently
of DEV entitlement. It checks block discovery/schema/readiness, agent/error
guidance, runtime and Object Type validation, masked local environment output,
template drift against a local Git fixture, Gofer check/apply/convergence, provider
detection and local deployment workflow/env output. Read-only calls must preserve
fixture files. The candidate fingerprint and per-command assertions are saved in
an owner-only summary, then the fixture app, template and isolated child-process
home are deleted. No real tokens are loaded or copied. A synthetic private token
file proves `logout` clears only that isolated home.

Local login qualification checks invalid callback rejection before browser
authentication. It remains `incomplete`, since real PKCE and workspace selection
require an authenticated operator. Set `EAI_E2E_LOCAL_UPDATE=1` to also read the
public npm/static release channels with `update --check --no-project-refresh`;
local qualification never installs over the candidate. Local fixture cleanup is
`localCleanupVerified`; it never supplies protected-backend `cleanupVerified`
proof. When combining candidate-matching summaries, retain live cleanup and
authorization evidence and all per-command failures/incomplete statuses.

`npm run smoke:eai-full:live` runs a selected consultant lifecycle using the
built CLI. Every app, membership, schema, resource, workflow and deployment
mutation stays in a fresh child of the explicitly supplied QA parent. The runner
never adopts an existing active workspace and always attempts independent
cleanup in `finally`. Login must already be complete through the normal CLI.

## Required prerequisites

Set these variables without committing their values:

| Variable | Requirement |
| --- | --- |
| `EAI_E2E_TEST_PROFILE` | Explicit authenticated QA CLI profile. |
| `EAI_E2E_TEST_USERNAME` | Expected authenticated actor email. |
| `EAI_E2E_PARENT_TENANT_ID` | Explicit dedicated QA parent with an active actor `tenant-admin` membership. |
| `EAI_E2E_CLEANUP_PREFLIGHT` | Private JSON path containing a fresh deployed child-delete route observation, described below. |
| `EAI_E2E_TEST_USER_OID` | Optional extra exact actor ID check. |
| `EAI_E2E_EXPECTED_PUBLIC_API` | Defaults to canonical DEV AU. Only canonical DEV AU or TEST AU/CA/EU HTTPS `/public` URLs are accepted. |
| `EAI_E2E_OUTPUT_ROOT` | Optional private output parent; defaults to the system temporary directory. |

Before selecting a workspace, the runner requires the exact supplied parent to
appear as active and selectable in normal workspace-list results. Before the
first creation, it verifies the exact profile gateway, actor, parent management,
parent membership and cleanup observation. The optional invite identity read uses
a separate owner-only local project context with the exact profile, API and
parent, because `user list` requires project markers even with an explicit
workspace. This creates no backend artifact. The runner evaluates
`child-tenants` creation through the read-only capability evaluator. A denied,
unconfigured or admin-required result is `blocked`, with its stable reason code;
it does not create an artifact. For example, `subscription_inactive` requires an
eligible approved QA workspace or its subscription prerequisite to be resolved.

The cleanup observation schema is `eai.cli-child-cleanup-preflight.v1` with exact
`publicApiUrl`, `parentTenantId`, `actorId`, `observedAt`, `publicApiGitSha` and
`adminApiGitSha`; `childDeleteRoute` must equal
`/v4/platform/tenants/{parent}/children/{child}/delete` and
`childDeleteVerified` must be `true`. Its timestamp must be less than one hour
old. This is an operator observation of the deployed contract, not a signature
or an ownership receipt. Recheck the actual PublicAPI/AdminAPI revisions and
route before producing it. Configurator super-admin is unnecessary for the
parent-authorized leaf route; the generic no-parent purge route has different
authorization. Isolation and cleanup cannot be disabled in live mode.

## Selected lanes

The default lifecycle creates a child, bootstraps its QA actor, explicitly creates
an app, scaffolds its exact acknowledged binding, checks local/runtime contracts,
prepares storage and Object Types, runs diagnostics, and builds the consultant
app. It preserves the scaffolded Object Type module's producer type exports,
imports, helpers and declared tenant-keyed model API, replacing only its data
initializer with the exact fixture JSON. Unexpected producer layouts fail before
generation or seed and still require owned cleanup. It then runs the template's
`npm run build:object-types` and `npm run check:object-types` before validation
and seed. Both generated JSON artifacts must be current; the normal app build
keeps its producer checks. `EAI_E2E_BUILD=0` omits the app build. `EAI_E2E_CHILD_HOME_REGION` supplies an
explicit child region when required; `EAI_E2E_RUN_ID` can supply 1–14 digits.

| Variable | Additional execution and prerequisites |
| --- | --- |
| `EAI_E2E_SYNC_SCHEMA_APPLY=1` | Applies schema in the fresh runtime and tests PostgreSQL/DocumentDB CRUD, complete batch operations, separate backend queries with exact created rows and persisted data, exact search result, and file byte roundtrip/deletion. |
| `EAI_E2E_INVITE_TEST_USER` plus `EAI_E2E_INVITE_TEST_USER_OID` | Adds and assigns an existing QA parent identity to the disposable runtime. It must be reused; the CLI has no directory-user deletion. `EAI_E2E_INVITE_ROLE` defaults to `tenant-viewer`. |
| `EAI_E2E_NEGATIVE_TESTS=1` | Verifies an invalid-email invitation is rejected in the disposable runtime. |
| `EAI_E2E_WORKFLOW_PROVISION=1` | Provisions and checks this run's own workflow. |
| `EAI_E2E_CHAT=1` | Also requires workflow provisioning and `EAI_E2E_AI_PROVIDER`/`EAI_E2E_AI_MODEL` available to the runtime; sends a real positional chat request and asserts its response. |
| `EAI_E2E_PROVISION_ENTRA=1` | Creates isolated app sign-in, verifies authorization and deletes its exact registration. `EAI_E2E_ROTATE_ENTRA_SECRET=1` additionally rotates its secret. |
| `EAI_E2E_DEPLOY=1` | Validates source, publishes this run's exact app through EAI-managed preview, requires completed operation evidence and runs operation-bound doctor. `EAI_E2E_DEPLOY_TIMEOUT` defaults to 900 seconds, maximum 1800. Actor-verification, review or completion pending is `blocked`. |

Requests for shared config mutation, workflow requests, ResourceAPI refresh or
bundle apply, document classification and cache refresh are blocked
before writes until their isolated fixtures and verified teardown exist. Index
apply is unsupported because PublicAPI exposes only dry-run planning; the CLI
rejects it before auth or HTTP. Index plans require an explicit bounded set of
exact published Object Type slugs. Existing
workflow keys and arbitrary deployment URLs are likewise rejected. Controlled
tests of those command contracts remain separate from live execution.

Query fixtures keep dedicated PostgreSQL separate from DocumentDB-backed rows.
Each query must return the exact created IDs and persisted field values. Current
ResourceAPI requires dedicated PostgreSQL query types to share one database;
search-only types are unsupported by query. These fixtures qualify compatible
placements without claiming federation across providers or join behavior.

## Cleanup and evidence

The runner captures acknowledged IDs before checking command status and saves
incremental owner-only `summary.json` outside the generated app. It saves command
names, option names, scopes, results and assertion/cleanup statuses; it omits
arguments, raw output, tokens and credential values. The runtime fingerprint
binds evidence to sorted path-and-byte content under `dist`, `resources` and
`package.json`, alongside version, entry hash and source Git provenance. An
installed package uses its own `gitHead`, never the current repository's HEAD.

Resource cleanup requires explicit GET 404 for each captured resource and file.
Batch failures remain failures even if individual fallback proves every row
absent. Entra cleanup requires an exact server receipt proving registration and
runtime authorization absence. App cleanup first checks its scoped target plan,
then requires verified deletion and enrollment absence. Any newly created runtime
leaf is hard-purged through its company parent before the company child is
hard-purged through the original QA parent; each needs an exact parent/child
receipt and complete parent child inventory proving that the exact child is
absent. A 403 from a deleted child's management route is never absence proof.
Every cleanup failure is recorded while the
remaining cleanup steps continue. Unacknowledged creation or unverifiable
cleanup is reported as an unverified artifact rather than guessed ownership.

The report schema is `eai.cli-lifecycle-smoke.v2`. `status` describes the selected
lifecycle; per-command coverage is `passed`, `failed`, `blocked`, `incomplete` or
`not-run`. `coverageComplete` requires every public command's actual execution
to pass. `cleanupVerified` requires nonempty successful artifact cleanup receipts;
a preflight-only blocked run has `cleanupStatus: "not-needed"` and
`cleanupVerified: false`. It does not claim tested teardown. Native installers,
provider GUI harnesses and package publication need separate qualification.

## Remaining run-owned fixtures

The local lane and default isolated lifecycle do not prove every command or
backend branch. These remaining journeys need explicit fixtures and teardown:

| Surface | Required fixture and proof |
| --- | --- |
| Classifier save/publish/target/disable/enable/delete | A run-owned draft and approved provider materialization inside the disposable runtime; assert immutable published version, exact workflow targeting and runtime denial/enabled behavior. Draft deletion needs disabled/unpublished state; published artifacts require verified tenant purge rather than pretending the draft-delete command removes them. |
| Document upload/classify/index | A published document classifier and business-document workflow in the disposable app, a synthetic supported file and expected type, exact job/document IDs, persisted storage/classification/index results, and document/analysis/search/blob cleanup receipts plus absence. The controlled document helper is not live proof. |
| Chat stream | A run-owned provisioned workflow with an available model; a bounded streaming session, actual streamed response/completion and exact conversation ownership, followed by runtime purge. Interactive help or non-streaming send does not prove streaming. |
| App existing-source/adoption/workflow evidence/source-unknown | A disposable enrolled app, exact actor-linked repository/ref/commit, unchanged canonical deployment evidence and a nonce tied to that operation. Teardown must remove app, install/source state and any created cloud/repository artifacts. |
| Source move and hosted rebind | The exact successfully deployed EAI-managed app, actor/browser GitHub proof and a disposable destination repository. Verify same-repository native transfer, backup retention, hosted rebind and reversal/cleanup; opening a Portal URL alone is not a successful handoff. |
| Azure config and own-cloud deployment | Disposable App Configuration/Key Vault labels and secret names, a dedicated Azure identity, repository/workflow and app host. Assert pull/push roundtrip, build/deploy/run status and app health; explicitly remove every changed config/secret, repository and cloud resource. |
| ResourceAPI refresh/bundle apply/cache refresh | Authorized administrative/operator identities, a run-owned install/storage fixture and request reasons. Assert policy denial for unauthorized/cross-tenant callers, signed/trusted installation behavior and removal/restoration of install, schema/cache side effects. |
| `resources indexes-apply` | Unsupported: PublicAPI exposes only dry-run index planning. An administrative test fixture cannot make this a public CLI apply capability; keep it unsupported until a public apply contract is implemented. |
| Workflow requests and generic PublicAPI patch/put | Stable endpoints with exact run-owned IDs and complete request/enrollment teardown; arbitrary shared-resource writes cannot certify these surfaces. |
| Interactive create/dev/full login | A disposable generated app and isolated authentication profile, bounded provider/server processes and operator PKCE completion. Verify launch/readiness and process teardown without deleting the working QA profile. |
| `types define` | Currently a coming-soon placeholder. A fixture cannot make this an implemented capability; retain `unsupported` until source behavior exists. |

Role denial and tenant isolation additionally require distinct approved viewer,
builder and administrator identities; successful admin operations alone do not
certify their authorization boundaries.

## Capability audit

After building, `npm run audit:cli-backend` writes the complete command, alias,
option and dependency inventory to the ignored `.smoke/cli-backend-audit`
directory. Without execution evidence, commands remain `not-run`; `types define`
is explicitly `unsupported` because it is currently a placeholder.

To join an actual lifecycle report and timestamped deployment observations:

```sh
npm run audit:cli-backend -- --evidence /private/path/summary.json --deployments /private/path/deployments.json
```

The execution report must match the candidate source SHA, entry hash and complete
runtime fingerprint. Deployment input is an array of exact service/environment
observations with `observedSha`, `mainSha` and `parity`; matching dates or version
labels alone do not establish main parity. Full backend certification also
requires verified lifecycle cleanup and separate passed role-matrix and
cross-tenant isolation evidence. Keep private account and workspace values out
of committed documentation.
