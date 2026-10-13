# Permanent CLI capability qualification

The owning CLI repository supplies the command contracts, source build proof,
retained QA foundation, permission probes and disposable lifecycle runner.
`ci/eai-cli-tests` checks these contracts with controlled fixtures. The deployed
read-only canaries in `eai-testing-dev` check the released artifact. Neither
controlled tests nor a successful selected lifecycle certify every CLI command.

## Candidate and private evidence

Use Node 24, install the locked dependencies, and commit the candidate before
producing build evidence. Work from this checkout; an installed package or an
uncommitted tree cannot provide canonical source-build qualification. Use a
private directory outside the checkout, with mode 0700 and files mode 0600.
Do not store tokens, credentials, raw provider responses or actual business data
in fixture specifications or evidence. Sign in through normal named CLI
profiles; the harness never accepts an operator token as fixture configuration.

```bash
npm ci
npm run qa:build -- --cli "$PWD/dist/index.js" --output /private/cli-qa/build.json
```

`eai.cli-source-build.v1` records the actual `npm run build` exit, Node version,
complete tracked source fingerprint, clean Git SHA, and hashes of the entry and
full runtime. It invalidates previous success before a new build attempt. A
dirty, linked, changed or unverified source cannot qualify. Build evidence expires
after one hour; rebuild and rerun observations when it expires. Dependency
overrides in tests are marked `controlled-fixtures` and never qualify a live run.
These are private operator observations, not signed server attestations.
Private state and leases refuse caller-created links in every ancestor and
recheck the observed directory identities before file operations. The fixed
macOS `/tmp` and `/var` aliases are allowed only with their exact system targets.
Ancestors must belong to the operator or root and cannot grant group/world
write access without the sticky bit. Trusted sticky temporary directories remain
supported; a private leaf inside a non-sticky shared parent is refused. Ownership,
permissions and directory identities are rechecked during each operation.
These checks do not provide descriptor-relative isolation from arbitrary
concurrent filesystem changes by another process using the same OS account.
Normal-profile calls and lifecycle subprocesses receive only allowlisted OS,
profile-home and network settings plus the harness's explicit tenant/profile
settings. Ambient GitHub, Azure, npm and headless credential variables, injected
Node options and operator lifecycle overrides are excluded.
Protected command and assertion receipts must each record exact `environment`,
`publicApiUrl` and `scopeTenantId`. Their scope must match the audit gateway and
a retained sibling or a child from verified cycles bound to the same foundation.
Retained sibling scopes require a complete valid authorization receipt. If cycle
context is supplied, its fixture, workspaces and actors must match that role
receipt. Valid standalone role evidence can report a retained read as passed;
it does not prove the ten cycles required for full qualification.
Each imported cycle must also carry its actual child-create acknowledgment and
parent-scoped command/guard, plus the exact parent hard-purge receipt and complete
parent-inventory absence observation. The independent consumer matches these to
the retained fixture, root parent, both siblings and administrator. A retained
workspace cannot qualify as a new disposable child, and missing or mismatched
ownership evidence cannot qualify that child scope. These remain unsigned
operator observations rather than signed server attestations.
A same-candidate command observed in another environment cannot certify this
environment. These unsigned records are trusted operator observations.
The canonical build and its source Git reads use the same restricted operational
environment. npm receives fresh empty private user/global configuration files.
Normal builds execute `npm-cli.js` directly through the active Node installation,
without selecting npm from `PATH`. The required `canonicalExecution` record
binds the executable paths and hashes, exact invocation, successful exit and
unchanged executables. Older receipts without this record cannot qualify; rerun
the canonical builder. Receipts must also record the empty user/global configs,
admitted project config and active Node bin first in lifecycle `PATH`.
Source and app receipt consumers compare the recorded Node/npm paths, versions
and hashes with the current installed tools; source receipts also compare Git.
An internally consistent imported record for another installation cannot qualify.
Rebuild when the installation changes; these checks do not authenticate unsigned
operator observations or prove execution independently.
The Node/npm installation, committed scripts and operator
filesystem remain trusted; this receipt is not a filesystem sandbox or signed
server attestation.
A project `.npmrc` may contain only `save-exact=true` and `package-lock=true`
installation pins, blank lines and comments in a bounded regular file. Unknown,
credential or Node-option settings block qualification; no operator override is
silently adopted.
The build enables committed lifecycle scripts and fixes its audit/fund/update
settings. This prevents npm from restoring lifecycle `NODE_OPTIONS` from an
operator configuration file. Standard registry token keys are not exported by
npm as environment variables. This configuration policy does not sandbox trusted
build code from files accessible to the same OS account. Profile home and the
allowlisted network/CA settings remain available.

Source and candidate Git reads use verified conventional installed Git locations,
independently of `PATH`. The normal build records Git path, executable hash,
version, exact source-read invocations and unchanged identity. Legacy or malformed
Git records cannot qualify and require a fresh build. System/Homebrew and normal
Windows Git installation locations are supported; an unavailable installation
blocks qualification. Tool installation, operating-system path settings, Git
configuration and the operator remain trusted. This is no filesystem sandbox or
signed server attestation; actual Windows execution has not been qualified here.

## Retained foundation

Provide an entitled DEV AU or TEST AU/CA/EU QA parent. The setup operator must be
an active tenant administrator in that parent. Five other, existing CIAM users
need distinct authenticated profiles, object IDs and emails:

| Slot | Workspace | Exact role |
| --- | --- | --- |
| adminA | a | tenant-admin |
| builderA | a | tenant-builder |
| viewerA | a | tenant-viewer |
| adminB | b | tenant-admin |
| builderB | b | tenant-builder |

Create a private specification with `environment`, `region`, `parentTenantId`,
`owner: {profile, oid, email}`, `actors` containing all five slots, and
`workspaces: {a: {name, slug}, b: {name, slug}}`. Each slug starts with
`eai-cli-qa-`; neither workspace supplies an existing ID. Start with
`bindings: {}`. Profiles and identity references are not credentials.

```bash
npm run qa:foundation -- --init --spec /private/cli-qa/spec.json --manifest /private/cli-qa/foundation.json
npm run qa:foundation -- --prepare --manifest /private/cli-qa/foundation.json --cli "$PWD/dist/index.js"
```

Initialization is local. Preparation checks the real gateway, operator and all
actor identities, evaluates the parent's child entitlement, and creates two
journaled sibling children through the normal CLI. It bootstraps their creator
and invites each existing actor with the exact role. `bootstrap-admin` cannot
replace a child's existing administrator; independent actors use membership
invitations. Preparation rejects newly created or unexpected directory users.
It verifies exact child/parent relationships, complete actor inventories, active
roles and absence of parent/sibling/global administrator authority.
Each actor's complete inventory must also contain its assigned QA workspace.
Existing unrelated memberships are allowed and grant no QA parent/sibling role.

The foundation remains available between runs. Each probe rechecks its
identities and roles; `state: verified` alone is insufficient. A single-host
exclusive lease prevents concurrent mutation. A crash, ambiguous create/invite,
unexpected user or changed membership requires reconciliation from exact
acknowledgements and fresh reads. Never delete the journal to retry an unknown
creation or guess its ownership. A deployment runner spanning multiple hosts
needs an external exclusive lease before invoking these scripts.
New foundations record each actor as `never-invited` before the first membership
write. Resume refuses missing or contradictory invitation history before any
bootstrap or invitation; an observed invitation is reconciled by fresh membership
reads rather than replayed. Independent role OIDs and profiles are distinct after
case folding, as in normal foundation identity validation.
Every saved child ID must match its journaled successful creation acknowledgment,
including the fixture, operator, parent, slug and returned child. An ID returned
with a nonzero exit remains saved for diagnosis and requires manual
reconciliation before any later child mutation. Older journals without that
exact ownership record cannot automatically adopt an existing child.
The synchronous backend's new-child response is a flat 201 result without a
`reused` marker; existing-child reuse explicitly returns `reused: true`.
Preparation preserves the supported absent-marker response and rejects reuse
or any malformed present marker rather than inferring ownership from it.

## Permission probe

Publish the same simple, synthetic `cli-qa-*` Object Type in both retained
siblings using the normal app/schema workflow. Add an `authorization` binding
with `workspaceSlot: a`, its exact `objectType`, a text `nonceField`, and bounded
synthetic `data`. An optional exact Object Type `id` binds only workspace `a`. The probe
reads and validates both published schemas before mutation; this binding cannot
stand in for missing published schemas.
Each selected definition must explicitly report `status: published`; the passive
schema endpoint can return an installed draft definition. Draft, disabled or
missing publication status blocks this published-fixture probe.
Published property names, types, required flags, select values and defaults must
match across siblings; local definition IDs and property order may differ.

```bash
npm run qa:authorization -- --foundation /private/cli-qa/foundation.json --cli "$PWD/dist/index.js" --output /private/cli-qa/authorization.json
```

The fifteen cases cover admin/builder creation and reads in each own workspace,
viewer read and write denial, and denial of all five actors against the sibling.
The probe retains each management DTO's actual child ID and immediate parent in
`workspaceBindings`. Imported standalone role evidence must identify a valid
foundation parent distinct from both siblings and bind both observed children
to it; a parent cannot be admitted as a retained sibling scope.
The generic `publicapi` command accepts an explicit UUID context for normal
authenticated users and leaves authorization to PublicAPI. Local CLI rejection,
401, outage, malformed envelopes and path/header mismatch never prove a role
denial. The probe requires exact request metadata and HTTP 403/404 for denial.
It creates four fresh nonce-bound rows with fresh idempotency keys and checks
exact tenant, object type, data, version, resource IDs and the writer's creator
OID. PostgreSQL creates have `updated_by: null`; unchanged reads preserve that
metadata. An unexpectedly persisted viewer update fails authorization and can
only be reconciled for cleanup against that exact recorded viewer/nonce attempt.
Foreign creator or updater attribution cannot qualify the probe. It independently deletes
every acknowledged row through its own workspace administrator and requires an
authenticated exact GET 404. Unknown creation outcomes remain recorded leftovers
without automatic replay or guessed cleanup.
An idempotent replay retains its returned ID as unresolved evidence and never
authorizes automatic deletion. New-row ownership requires the typed
`idempotentReplay: false` field supplied by ResourceAPI's response contract.
Preflight-only probes keep resource `cleanupVerified: false`; removing their
local context is recorded separately and cannot prove resource teardown.

This resource permission matrix does not prove every endpoint's policy.
System-admin cache refresh, tenant/user administration, provider, document and
deployment permissions require their own actor-bound command assertions.

## Deployed revision observations

Produce a private array of fresh observations for PublicAPI, AdminAPI,
ResourceAPI, Authz, Configurator, TenantInfra, AICore, AdminPortal, AzureAPI and
CIAM. Include Website when certifying `support`. Every row identifies the exact
environment, public gateway, observation time and an HTTPS evidence reference.

For code services, record `parity: main`, fresh `mainSha`/`mainObservedAt`, and
`observedSha` from a revision endpoint, selected deployment, image label or
OneDeploy receipt. `runtime` contains the matching `sourceSha`, `active: true`,
`ready: true`, exact revision and `sha256:` artifact digest. `selectedRelease`
contains the same source SHA/digest, `configured: true`, `status: succeeded`,
`kind: container|onedeploy`, and exact deployment ID. Workflow head or health
alone cannot identify the release serving requests. All observations expire
after one hour; mismatches and unavailable revision evidence remain pending.

CIAM is external identity infrastructure. Its row uses `source: oidc-discovery`
and a verified `identity` with the selected tenant UUID, client UUID, exact
CIAM/Microsoft issuer and discovery URL. The evidence reference is that discovery
URL. CIAM has no fabricated application `mainSha` or `observedSha`.

## Ten fresh lifecycle cycles

Before writing, provide an actual deployed parent-authorized child-delete
observation as described in [CLI backend lifecycle smoke](./cli-backend-lifecycle-smoke.md).
Bind it to retained workspace a, actor adminA and the selected PublicAPI/AdminAPI
revisions in the deployment array. A route observation is required in addition
to active entitlement. Do not construct success booleans from expected behavior.

```bash
npm run qa:cycles -- --foundation /private/cli-qa/foundation.json --deployments /private/cli-qa/deployments.json --cleanup-preflight /private/cli-qa/cleanup.json --build-receipt /private/cli-qa/build.json --cli "$PWD/dist/index.js" --output /private/cli-qa/cycles.json
```

The controller sequentially runs ten new consultant lifecycles under adminA in
workspace a. Each lifecycle uses a fresh child, app, registration and enrollment;
applies the owned schema; scaffolds and builds the app; rotates exactly once;
proves the isolated local credential changed; deletes the app; requires the
**first** inventory to succeed and be empty; and recreates the same app key with
a distinct enrollment ID. It deletes that recreation, proves its first empty
inventory, removes the exact Entra registration, and hard-purges the owned child
with complete parent inventory absence. It records no secret values.

A first-read 503 or nonempty inventory stays failed even if later reads recover.
No failed rotation or ambiguous recreation is automatically replayed. Each
runner still attempts independent cleanup in `finally`; the controller stops
on the first failed cycle. Source/build/deployment/cleanup proofs are rechecked
between cycles and joined to each runner's receipt. Each runner must match the
controller's complete candidate record: clean status,
version, runtime file count, Git SHA, entry hash and full runtime hash.
The controller also passes its retained fixture UUID, both workspace UUIDs and
all five actor OID/profile pairs to the runner. The runner checks its selected
administrator and parent against those references before any CLI dispatch and
records the context in its private receipt. A missing or different fixture,
workspace or actor reference cannot qualify a cycle.
The expected context includes the foundation's own parent UUID. The runner
refuses that parent and both retained workspaces as creation/cleanup ownership
before adopting a returned child ID. Its receipt preserves the full validated
child-cleanup observation, including schema, gateway, actor, parent and exact
`childDeleteVerified: true`, alongside source revisions, time and route.
All ten registration IDs,
child IDs and app keys must be distinct, and all twenty original/recreated
enrollment IDs must be unique. Fixture-controlled cycles can pass
their structural assertions but remain `qualified: false`.
Candidate Git reads use the shared operational environment, excluding ambient
Git directory, worktree and index overrides. Controller local-project cleanup
starts unverified and passes only after its own removal and absence checks; a
runner's cleanup flag cannot survive a controller cleanup failure.
Cycle qualification also retains the actual rotation, build, deletion, first
inventory, recreation, recreated inventory/deletion and registration-absence
command/guard receipts. Consumers independently require passing exits, exact
runtime scope, expected guard outcomes and their recorded order; success flags
alone cannot qualify a cycle. Both selected steps and child create/purge guards
retain their actual environment, PublicAPI URL and tenant scope. Each assertion
must match its command and the expected runtime child or cleanup parent; a
matching top-level header cannot replace these observations. Each selected
command and guard also carries the producer's same observed invocation sequence;
a guard from another invocation cannot prove that selected step. Assertion-name
lists must be arrays. This selected lifecycle proof does not implement
the command/option qualification contract. The producer now emits UUID-bound assertion records; selected lifecycle proof still cannot qualify unexecuted commands or options.

Intentionally unsupported capability classification stays separate from observed
execution status. Failed, blocked and incomplete attempts remain visible;
unsupported option coverage requires the corresponding denial execution and
option-specific passing assertion. Authorization receipts require exact boolean
foundation verification and bounded normal-profile references, and the producer
rechecks all six candidate fields between probe steps.

The controller requires a successful consultant build and removes ambient
optional lane flags; deployment, chat and provider journeys need separate
approved runs. CLI/build subprocesses retain the normal profile home while
removing inherited app routing and headless authentication overrides. The cycle
app scripts and the standalone Bash build share the canonical installed npm,
empty configuration and active lifecycle Node policy. App-build receipts record
this executor identity and policy; legacy or callback-driven build success cannot
qualify a normal consultant build. Disposable local Git fixtures use the verified
installed Git executable. The installation, committed scripts and owned app
dependencies remain trusted, and build code retains the OS account's file access.
Cycle output must be new and separate from every fixture, proof and CLI input.
The controller owns a fresh private output root for each cycle. Its `finally`
cleanup removes the generated app folders, including `.env.local` credentials,
on success or failure while retaining the private summary and command receipts.
Reported paths outside that owned root never authorize deletion. A cleanup
failure stops qualification and leaves its receipt marked unverified.
Deployment observations are operator snapshots. Coordinate with the release
owner to avoid overlapping rollouts while collecting and using them; the
controller validates their identity and age but does not lock cloud releases.

## Whole-capability audit and remaining lanes

```bash
npm run audit:cli-backend -- --cli "$PWD/dist/index.js" --build-receipt /private/cli-qa/build.json --deployments /private/cli-qa/deployments.json --evidence /private/cli-qa/combined-evidence.json --output /private/cli-qa/audit
```

The combined evidence keeps the exact `candidate`, environment/gateway,
`commands`, explicit `aliases`, `unsupported`, `authorizationEvidence`,
`cycleEvidence` and live `cleanupVerified` receipts. Preserve failures and
incomplete entries when joining matching reports. An executed subset cannot
claim `coverageComplete`; every command, alias and option needs its own named
assertions and a zero exit for supported executions. Missing or nonzero exits
cannot qualify command, alias or option coverage. `types define` and
`resources indexes-apply` intentionally return
unsupported before auth/network and need explicit exit-1/no-network evidence.
Their receipts also require a complete UUID-bound execution with passing scoped
assertions; bare exit/auth/network flags cannot certify unsupported completion.
Top-level evidence, role receipts and cycle receipts must match all six clean
candidate fields: source SHA, entrypoint hash, runtime hash, runtime file count,
package version and `dirty: false`.
The audit's schema subprocess retains normal home, path, locale and network
settings through the same operational allowlist as the qualification commands;
it excludes ambient credentials, Node injection options and EAI routing context.
Canonical command receipts cannot carry alias metadata; alias invocations remain
in their separately bound `aliases` collection. Qualification requires explicit
DEV AU or TEST AU/CA/EU scope with its canonical PublicAPI gateway in every
deployment, role and cycle receipt. Matching missing or invalid scope is never
proof. Malformed permission-case entries remain unqualified without discarding
the command inventory.
Absent evidence remains `not-run`; attempted unfinished observations remain
`incomplete`. Command, alias and option failures take precedence over blocked
or incomplete observations, and one success cannot erase another attempt for
the same option. A passing selected run never means the full
inventory is qualified.
Use a new private audit output, separate from every input. Candidate collection
and private input failures retain a sanitized blocked-attempt JSON/Markdown
record and cannot qualify. Malformed receipt collections or entries are retained
as collection/index observations without copying raw input. Their unknown scope
prevents other successes from certifying the audit. Null cycles return an
unqualified result instead of aborting the consumer.
Qualifying executions have an exact UUID `executionId`. Each assertion is a
record with a bounded `name`, that exact `executionId`, matching `command`, and
an explicit `status: passed`. Alias assertions also name the exact `alias`.
Each option needs its own assertion naming the exact `option`; a generic command
assertion cannot qualify every listed flag. Failed or blocked scoped assertions
remain non-passing, and missing/malformed/foreign records remain incomplete.
Legacy assertion-name arrays alone cannot certify a command or option.
Full qualification also joins role and cycle evidence to the same `fixtureId`,
both retained workspace IDs and all five actors' exact OIDs/profiles. The cycle
controller records those references from its verified foundation. Independently
valid receipts from another foundation, actor or workspace cannot be combined
to certify this run; older cycle receipts without that context cannot qualify.
Permission evidence must also carry both matching published schema observations,
four fresh acknowledged rows and their exact successful DELETE/404 cleanup
records. Cleanup records retain bounded observed method/path/tenant/gateway and
exit/HTTP status fields, plus the deleted row ID, marker and timestamp. The
consumer validates those fields independently; summary flags alone cannot pass.
Every allow/denial case also retains its observed method/path/tenant/gateway and
exit/HTTP status. The importer derives the expected collection or item operation
from the selected actor and owned row. A create DTO without its exact POST wire
does not authorize cleanup; an exact owned acknowledgment with a nonzero exit
remains reconcilable but cannot certify the role case.
Every allow/deny case names its scoped row; flags without those receipts
cannot certify authorization. Candidate/deployment read failures after output
validation leave a private blocked summary before any runtime mutation.
Local/live producers allocate a fresh execution UUID before each actual
invocation and retain structured assertions bound to that execution. `commands`,
`aliases` and `unsupported` contain their respective actual CLI invocations;
`executions` preserves the full ordered lifecycle ledger, including npm builds.
An alias does not also create a canonical command receipt. Each semantic check
keeps its observed outcome, scope and invocation sequence. JSON-format checks
name `--format`; rotation evidence names `--rotate-secret`. Other option checks
require their own observed semantic assertions.

Only a verified semantic contract can set command completion. Exit zero, JSON
shape, read-only preservation, global preflight success and later passing
invocations cannot complete an unchecked contract. Missing unsupported
authentication/network observations remain incomplete; the producer does not
invent them. Controlled producer-to-audit tests verify this mapping, and a
normal offline smoke verifies actual installed command assertions. Selected
local checks do not prove authentication, deployed backend parity,
normal-role authorization, provider readiness or ten full lifecycle cycles.
The local Docker lifecycle harness also requires its single newly visible
matching-slug child to carry the exact requested `parentId` before selection,
storage provisioning or cleanup. Missing or mismatched parent metadata fails
without adopting that workspace.
Before its first subprocess, the local Bash harness selects a compatible Node
from a conventional installation rather than PATH. All profile, journal, build
and CLI subprocesses use that absolute executable. The operator, OS installation
and owned scripts remain trusted; this does not sandbox those inputs.
If ID parsing fails after acknowledgment and reconciliation, the EXIT trap
recovers only a verified journal child matching the current gateway, profile and
parent. Unresolved journals require manual reconciliation and never authorize
guessed deletion.
It preserves a minimal private creation journal outside the disposable app,
including the exact returned child ID and creation exit status before inventory
reconciliation. Missing or ambiguous inventory leaves that journal unresolved
for manual reconciliation without guessed selection or cleanup. Cleanup uses
the exact parent-authorized `--parent` and `--force-hard-purge` route. The journal
records ownership only after the create acknowledgment matches the requested
resource type and ID. It only sets `cleanupVerified` after every created resource has an exact successful
DELETE acknowledgment and a same-gateway, same-child GET404, followed by the exact
child/parent hard-purge receipt and complete bounded parent inventory absence.
Resource failures remain recorded and fail the run while cleanup still attempts
the independently owned child purge. External Docker storage cleanup starts only
after that exact child purge and parent absence pass. A failed, malformed,
partial or nonempty observation cannot pass; the harness reports success only
after cleanup. This child receipt does not certify an external provider teardown.
Before any resource DELETE or absence GET, the helper rechecks the accepted
creation row against the current child, profile, parent and gateway. A cached
shell ID cannot authorize cleanup by itself; refusal remains in the private
journal while independently verified child purge can still proceed.
Local and live output roots reject caller links, nonprivate roots and unsafe
ancestors before creating run files or dispatching commands. The default trusted
sticky system temporary directory creates a private run; supplied roots require
owner-controlled private permissions. Directory identities are rechecked under
the trusted OS/operator boundary, with no hostile same-user namespace guarantee.

Provider, analyzer, classifier, documentWorkflow and GitHub bindings hold
references to approved retained fixtures. No provider material, third-party
credentials or directory-user deletion is provisioned by foundation setup.
Their run-owned materialization and teardown requirements are listed in the
lifecycle guide. Until those fixtures, endpoint role checks and all alias/option
assertions exist, full capability qualification remains pending.

## Rollout handoff

Review and deploy ResourceAPI committed purge receipts, then AdminAPI exact
schema publication, then the PublicAPI deletion barrier with healthy shared
Redis. Deploy AdminAPI/PublicAPI rotation contracts, ResourceAPI query placement
repair and PublicAPI AI discovery before exercising their changed boundaries.
The platform owner performs DEV deployment, observes the selected releases,
runs owned qualification, and repeats it after TEST deployment.

The CLI release owner runs the canonical release preflight and publishes a new
patch through the normal release workflow. Enable the additional DEV canaries
against that actual released artifact before reviewed TEST/PROD promotion. The
installer owner checks its own harness against that real CLI artifact and Node
baseline. These PRs implement and test the repairs; they do not merge, deploy,
publish a package, release the installer, or certify currently deployed versions.
