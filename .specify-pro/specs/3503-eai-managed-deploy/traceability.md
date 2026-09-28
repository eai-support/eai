# Traceability

Requirements are defined by the [Issue #3503 hardening amendment](https://github.com/enterpriseaigroup/Issues2025/issues/3503#issuecomment-5826177803).

Exact app-template candidate: `3432b6e1ee5c66bc517a140a4a55c16c5b17eb66`. Its authenticated runtime-owned readiness binding supports the separate deployed qualification; The collector now independently enforces a single hard link at every archive and bounded-file read snapshot; the CLI embeds those exact bytes. The workflow bytes are unchanged. The producer publication gate remains closed until a real immutable release is recorded.

| Requirement               | Planned implementation                                                                                                                                                                                                                         | Owned evidence                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| DTE-009–DTE-011, DTE-014  | `src/commands/eai-managed-deploy.ts`, explicit target tenant, exact GitHub link session/client identity                                                                                                                                        | CLI integration and source-client tests                                              |
| DTE-016                   | requested/canonical project-root and ancestor binding across resolution, configuration hashing, doctor execution/evidence, and publication; no-follow parent/leaf-bound canonical byte comparison; single-link pre-open/open/rebound/post-read contained-path/inode/ancestor/size/time-bound publication with fail-closed required no-follow/nonblocking capabilities; pre-allocation private opened-size enforcement; copy-on-write owner-only staging with sync, exact root/ancestor/target revalidation, no-clobber absent publication, unchanged existing bytes on rejected staging, and accepted staged-inode/single-link binding; confined receipt/state/claim writes with the explicit same-UID namespace trust boundary; parent-bound workflow evidence; exact identity-bound macOS `/tmp` and `/var` aliases with every other root-level link rejected | root-resolution, doctor-root, explicit system-alias allowlist, arbitrary-root-link rejection, config-root/directory, canonical-match symlink/race, managed-source/read-size/file/ancestor/post-read-race, receipt/state/claim/generated-create/write-race, unit, and workflow-evidence tests |
| DTE-018, DTE-095          | stable repeated no-follow source-manifest inventory with retained initial governed-directory identities, aligned 10 MiB per-file/32 MiB total/4,096-file limits, fixed-buffer descriptor reads, post-open growth rejection, and post-read path/ancestor/leaf checks for `configHash` over every governed file including `.test.*` and `.spec.*`, with only two generated-output exclusions shared exactly by the collector | CLI/collector parity, bounded-read/manifest structure, valid 4–10 MiB file, total-limit, same-name directory replacement, inventory-addition, post-open growth, oversized-file, post-read substitution, and managed deploy/source tests |
| DTE-019–DTE-021, DTE-088  | embedded workflow/collector with separate legacy and CLI-managed routes, pre-auth legacy rejection of CLI-mode/namespace evidence, validated untrusted source/tenant/workflow/collector observations, isolated canonical source-provenance validation before OIDC, exact platform-sealed workflow Git blob and collector digest revision proof, canonical-path candidate pin manifest, and canonical remote tag-to-commit plus remote-byte verification | collector-envelope/operation-namespace, handoff-provenance, linked-source/release metadata, remote substitution, and deploy integration tests |
| DTE-022, DTE-023, DTE-025 | exact producer workflow/collector bytes with runner-temporary bounded artifact staging, current upload ID/digest plus exact REST repository/run/source/attempt binding, opened-size fixed-buffer archive hashing with growth probes, same-descriptor bounded OCI index/manifest extraction with exact manifest size/content-digest/schema/media-type binding, one fail-closed no-follow/nonblocking collector-open guard, capped fixed-buffer metadata/configuration/response reads, per-value and aggregate-bounded GitHub outputs, actual-byte-capped OIDC/PublicAPI response streams with new no-follow handoff output, bounded downloaded evidence and exact-source/GitHub bodies, clean checkout-free inline handoff response validation, pre-open through final-path size/mtime/ctime binding for generated-tree and archive sources, exclusive generated-file creation, post-append command-file descriptor/leaf identity and one-link binding, immutable action/image pins, credential-free build, and isolated OIDC handoff | producer byte parity, current-upload/run-attempt substitution, output byte-limit and inter-snapshot hard-link rejection, Linux OCI fixture plus missing/duplicate/substituted-manifest assertions, no-follow capability regression, workflow staging/no-checkout assertions, bounded unknown-length token/handoff, archive/evidence/response/fetch readers, accepted and persisted-pending response shapes, same-size pre-open rewrite, collector growth/race/substitution tests, and release-gate verification |
| DTE-025, DTE-026          | unchanged direct CLI dispatch plus byte-identical producer support for manually dispatched same-repository reusable calls; nonempty direct `config_hash`, optional reusable hash resolved from the exact checkout with supplied mismatch rejection, exact legacy source-mode and target-tenant presence binding, pre-checkout caller-event and signed source-commit equality checks, direct `github.sha` checkout selection, GNU/BSD-compatible bounded tar flags, no persistent build cache, documented caller permissions, no long-lived token use, and server-authoritative signed caller/callee workflow, ref, path, and SHA binding | producer byte parity plus direct empty-config, legacy field presence, static signed-checkout, portable-tar, cache-isolation, reusable caller, omitted/supplied reusable config-hash, ordering, permission, credential-isolation, and bounded-response assertions; coordinated PublicAPI signed-claim tests |
| DTE-031–DTE-035           | pre-network exact operation validation across resume, retry, doctor, legacy handoff, and canonical evidence; separate dotted app/tenant scope grammar; protected original endpoint receipts for every opaque operation namespace, sealed source-mode and environment recovery routing with explicit option conflict rejection, persisted installation-bound retry-state comparison before dispatch/terminal/reuse branches, consistent fresh-operation handling for terminal failure in both source modes, dispatch state, required equal source/executed merged SHA, and complete unified-operation binding | API route-builder dotted-scope coverage plus managed deploy, vertical evidence/handoff, recovery, binding, and integration tests |
| DTE-016, DTE-031–DTE-035, DTE-091 | freshly server-bound GitHub numeric ID/login/proof before undispatched customer retry; trusted owner-only recovery parents on save/load; mandatory prepared-operation recovery persistence before source upload or upload-token retrieval | modified local GitHub identity negatives, writable-parent refusal and safe mode enforcement, pre-upload authority observation, lost-response recovery and persistence-failure/no-upload tests in source-client and managed-deploy integration suites |
| DTE-091                   | pre-context and client-boundary regional allowlists, no-redirect authenticated membership/management/app-validation setup for modern and legacy managed commands, browser origin allowlists, protected state loaded before retry traffic, unified lookup and all later retry requests bound to its original endpoint, including suppression of regional environment synchronization, plus operation-route redirect rejection | legacy-command pre-network/setup/app-validation redirect, API client, state, source-client, and deploy integration tests |
| DTE-036, DTE-061, DTE-080 | `eai deploy doctor` operation binding, canonical declared-secret readiness probe, original-root-bound and application-root-confined opened-inode-bound evidence output, exact workflow/collector revision identity, exact positive TenantInfra handoff marker, independent setup/source revision comparison including repository/installation IDs and review head, and unified-operation deployment/doctor success binding | deploy doctor/runtime/help/describe, positive/negative TenantInfra-marker operation classifier, outside-root, root/path-race, and filesystem tests |
| DTE-086, DTE-087          | current-main merge, focused managed command/library/source-client module boundaries under 300 lines behind compatible public paths, standard JSON failures, and exact-head checks                                                              | module-size, integration envelope, build, lint, `test:eai-cli:ci`, release preflight |

Late GitHub/evidence boundary validation: 140 focused deployment unit/integration
cases passed. Explicit private visibility is required before registration or
dispatch; malformed visibility and a real evidence hard link are rejected.
Build and lint passed. These checks add no GitHub/provider calls, only one field
to the existing overlapped repository read and metadata checks on existing
filesystem snapshots.

The final template candidate additionally omits incomplete authenticated
deployment bindings while preserving legacy readiness statuses. Its workflow
and collector bytes remain unchanged; candidate revision3432b6e is mirrored
exactly and the publication gate remains closed.

The latest combined review fixes reject CLI-managed evidence before the legacy
command authenticates, bind the saved installation to independent setup before
any retry action, and stage generated/private updates before publication. The
focused semantic corpus passed 202 cases and writer/race corpus passed 48
(including 20 new writer regressions). Build, lint and exact producer parity
passed. The full one-worker run retained three unchanged fixture timeouts with
1,152 passes and two existing skips across 54 files; it is a failed execution,
not live qualification or an inferred pass. No timeout threshold was changed.

Late retry/recovery proof: 205 focused source-client, managed-deployment unit and
command integration cases pass. The complete serialized suite passes 1,165
tests across 54 files with two existing documented skips in 214.81 seconds;
build, lint and exact template3432 byte pairing pass. Earlier failed and
interrupted executions retain their separate provenance. The identity check adds one
fresh server-scoped link-session read only before redispatch; receipt persistence
adds local I/O before upload, with no new route, authority scope, producer bytes,
or deployed response contract. Existing CI owns the changed source-client module
family and regressions. Publication and live qualification are not inferred.

The retry redirect review is checked against the endpoint-level
`managedPublicRequest` guard, which validates the original PublicAPI authority
and sets `redirect: error` independently of generic constructor options. Three
command integration regressions cover accepted handoff, subsequent operation
polling and the fresh actor-bound GitHub-link read, rejecting 307 responses and
confirming no request reaches the redirected host. These tests change no
transport behavior, auth scope, route or producer bytes; the existing owned
managed-deploy integration suite and CI selection cover them.

The first full serialized execution with these three regressions recorded
1,167 passes, one failure and two existing skips across 54 files in 216.51
seconds. The failure was the unchanged 10-second `afterEach` removal hook for
the 4,096-file governed-count fixture; the new integration cases passed.
Concurrent site compilation was slow (119 seconds), so a separately recorded
full rerun is coordinated after heavy checks drain. This failed execution is
not reclassified by a diagnostic or subsequent passing run.

After heavy checks drained, the separately recorded complete one-worker repeat
passed all 54 files: 1,168 tests and two existing documented skips in 228.35
seconds, with the original timeout limits. The three focused redirect cases,
lint and exact template3432 producer verification also pass. This successor
adds tests and evidence only; protected transport behavior and producer bytes
remain unchanged. Current-head CI, human review, publication and live
qualification remain independently assessed gates.

Late recovery review closes the undispatched accepted-evidence branch with the
same fresh server-bound GitHub proof used before workflow dispatch. Failed,
expired, pending, crossed-actor, changed-user and changed-proof sessions reject
before mutation. An expired but still verified original proof retains the
existing retry allowance; dispatched recovery does not require a new session.
Explicit repository, installation, ref, workflow, commit and link-session hints
must match the independently sealed setup; defaults are ignored and missing
setup fields cannot be inferred from the terminal revision. The real Git
customer-owned install/commit/retry case succeeds with the new immutable SHA;
the EAI-maintained source-bundle allowlist remains unchanged.

The complete serialized corpus passed 1,187 tests with two documented skips
across all 54 files in 157.49 seconds. It used the initial 98-case integration
test snapshot. The final test-only expansion independently passed all 103
managed-deploy integration cases in 12.79 seconds. These are separate execution
records; no 1,192-test full result is claimed. Build, lint and exact template3432
producer pairing pass. The publication gate remains awaiting-producer-release.

The enforced performance repair caps managed PublicAPI requests at 30 seconds
or the smaller existing command/remaining poll budget. Its native signal remains
active across credential lookup, headers and body consumption, including legacy
OIDC evidence submission. Exact operation reads distinguish their issued timeout
from an unrelated provider abort and direct recovery through the original
receipt's `--retry` gateway without redispatch. Polling makes no extra read after
the deadline. This changes no cross-service contract; existing owned API-client,
source-client and managed-command tests and feature mapping cover the behavior.

The focused transport/recovery corpus passed 230 cases. The complete serialized
suite then passed 1,208 tests across all 54 files with two existing documented
skips in 160.33 seconds, including the final retry-guidance assertions. Build,
full source lint, changed-test lint and exact template3432 pairing pass. Earlier
failed runs retain their separate provenance; no test timeout, skip, release pin
or activation gate was widened. Changed public deadline/body interfaces document
their critical contract; untouched missing-doc advisories remain pre-existing.

Final publication-boundary closure keeps `--resume` observational for accepted
and publishing operations, including an upload ticket with no local source or
recovery file. Only `--retry`, after protected original receipt loading, can
replay the exact bound upload; a changed current profile cannot select its
gateway. Source-specific preparation/readback and polling reject other
namespaces and malformed IDs using the actual AdminAPI-produced
`cli-managed-[a-f0-9]{32}` format. The former synthetic fixture prefix is not a
production alias; help and its generated release assets now show the real form.

Portal uploads share the existing managed request signal and caller-credential
deadline. A native upload timeout retains uncertain-result guidance and the
prepared operation, without another preparation, upload or status read. The
upload response body is not trusted as publication success: the bounded exact
operation read remains authoritative. The native signal remains attached to
the upload stream after headers. Independent credential refresh and pre-client
context discovery are outside this caller deadline, so no whole-command or
underlying auth-fetch cancellation SLA is claimed. Evidence callers may reduce
the fixed 1 MiB ceiling but cannot raise it, even for a small or missing file.

The final focused four-suite corpus passed 324 cases. The complete serialized
execution passed 1,227 tests across all 54 files with two documented skips in
151.93 seconds. Build, full source lint, changed integration/source-client lint,
exact template3432 pairing, generated release-asset freshness and diff checks
pass. The unit file's five untouched `no-regex-spaces` findings were reproduced
against its predecessor HEAD bytes and remain separate baseline diagnostics;
none arises from the new evidence-limit tests. Earlier failed/incomplete runs
and the 1,208-test predecessor proof remain historical, with no widened timer,
skip, release pin, route or authorization scope.

The sealed setup mode review reproduced two terminal-success defects on af8
(165 companion tests passed); defined mismatching, null, empty or unsupported
setup modes now keep both source choices pending. An omitted setup mode remains
compatible with the current producer, and matching modes preserve success. The
legacy command already rejected a canonical CLI publication ID before tenant
context or authentication via its source-unknown namespace check. Its early
message now uses the same canonical pattern as publication readback/polling,
with three real command/no-network cases for omitted and explicit source modes.
The shared identifier file is explicitly owned by the existing feature map.

The same-UID publication race test now asserts the actual target bytes as well
as the untouched displaced original inode. A mutation inside rename after the
final snapshot is rejected by post-publication verification, but the target
contains the adversarial bytes; the writer does not report success or fabricate
a safe rollback. This is the existing final-check host trust boundary, not a
claim that path-based publication is immune to an owner-controlled namespace.
Detected substitutions before publication continue to preserve existing target
bytes. No writer algorithm, new filesystem read or rollback mutation is added.

Current focused validation passed 228 cases across four suites. The complete
serialized run passed 1,232 tests across all 54 files with two existing
documented skips in 239.11 seconds, at unchanged timeout limits. Build, full
source lint, changed legacy-command/writer test lint and exact template3432
producer-byte verification pass. Coverage-map Prettier and untouched inline-doc
advisories were reproduced/separated as baseline diagnostics. The previous
1,227-pass proof and initial two-failure reproduction remain historical rather
than being reclassified. The new guards are local comparisons with no extra
network request, larger byte budget or wider source authority. Publication,
immutable native producer pins and live qualification remain external gates.

The publication review successor of `8043e175` guards the remaining deadline
before each required status read, including the first read. It binds preparation,
upload retry, authoritative readback and later polling to the captured GitHub
numeric ID, case-insensitive login and exact proof ID. Repository `.`/`..`
components are rejected before command context or `gh` credentials/provider
calls; valid names retain their grammar and API path pieces are encoded.
Counter regressions prove exhausted-budget zero I/O, mismatch rejection before
the next call, unchanged positive request counts and the existing 129-read
ten-minute publication ceiling. These are local guards without new provider
requests, wider authority, timeout increases or producer-byte changes.

Before repair, the selected new regressions recorded 20 failures and one pass
(261 unrelated cases filtered). The complete focused source-client/deployment
unit/command corpus then passed 282 cases in 23.57 seconds. The full serialized
repository suite passed all 54 files: 1,260 cases and two existing documented
skips in 182.69 seconds, at unchanged timers. Build, full source lint, changed
source-client/command test lint, exact template3432 producer pairing, generated
release/experience/error-doc freshness and diff checks pass. The unit file's
five pre-existing `no-regex-spaces` lint findings match the unchanged HEAD
baseline; two untouched missing-JSDoc advisories remain. Existing feature
mapping and `ci/eai-cli-tests` own the changed paths/tests. This changes no
cross-service contract. Same-UID namespace trust, the 30-second managed request
ceiling and underlying token-refresh cancellation limits remain explicit;
native producer publication/assembly, live qualification and commercial gates
are unchanged.


The recovery/dispatch review successor of `b920fecd` preserves the first receipt
with exclusive creation and, on existing receipt reuse, one bounded 16 KiB
comparison of its own schema, operation, tenant, target tenant, app, original
PublicAPI URL and actor fields. Equality preserves the existing bytes/inode;
a mismatch rejects before upload. Values are compared exactly, without
inheriting or normalizing new authority.

Claim advancement holds an exclusive owner-only `.dispatch.update-lock` across
its bounded read, expected-inode/version atomic publication and conditional
release. Accepted status and a known GitHub run ID cannot regress; conflicting
run IDs reject and accepted-without-ID can gain its first observed ID. Private
state saves preserve the supported schema's 20 immutable fields, including its nonce,
then merge only its three progress fields under `.json.update-lock`. Delayed
senders recover the retained accepted claim/state run ID, including before
claim acquisition and after provider acceptance. Unknown serialized metadata
is not part of this supported authority contract.

Guards have no timeout or automatic takeover. A crash-held/malformed guard
requires all local holders to be quiesced and explicitly authorized conditional
recovery of the inspected unchanged original guard. A substituted guard is
left untouched and the update fails closed. Parent identities are reused
through each guarded read/write/release; existing-state creation and update
use two native capture phases. No provider or subprocess call is added.
Counter tests observe two target opens for changed claim publication, one for
idempotent accepted reuse with no stage/publication, and zero target opens
when the guard is held or content exceeds 16 KiB.

The first full attempt remains failed: 54 files, 1,298 passes, one existing
parent-race fixture expectation failure and two documented skips, 179.14
seconds. The source/test input manifest stayed unchanged throughout that run.
Exclusive first state creation now shares the existing claim creation contract:
a same-UID parent replacement immediately before open can leave a zero-byte
leaf, then the retained parent check rejects before writing any nonce/authority
bytes. The corrected fixture proves that rejection, original state and unrelated
replacement bytes surviving, and zero fetch/provider dispatch. It does not
claim zero filesystem effects or immunity to an owner-controlled namespace.
Only that fixture changed after the failed run; production source stayed frozen.
Its complete 28-case diagnostic passed in 1.59 seconds at unchanged limits.

Before source repair, selected receipt/claim regressions recorded 15 failures
and four passes (231 unrelated cases filtered). Additional exact-b920
state/caller regressions recorded 20 failures (128 filtered); the source files
were restored with verified byte equality. The final changed helper/command
corpus passed 273 cases in 20.96 seconds. These passing diagnostics do not
reclassify the failed executions. The complete repeat passed all 54 files: 1,299 tests and two existing documented
skips in 150.76 seconds (151.74 seconds orchestrated), at unchanged limits.
All 651 tracked input hashes, including 164 source/test files, stayed unchanged
through execution and final checks. Only the corrected parent-race fixture
changed from the failed full attempt; its production source is byte-identical.

Fresh build, full source ESLint, changed writer/race/command test ESLint, exact
template3432 producer byte pairing, generated release/experience/error-doc
freshness, guidance verification, public hygiene, placeholder and diff checks
pass. Five unit-file regex lint findings equal the exact b920 baseline; nine
untouched inline-doc advisories remain, with the changed public dispatch
contract documented (baseline had ten). Existing feature mapping owns the
changed paths/tests. This changes no cross-service contract. The intentional
release preflight still rejects missing immutable native producer publication;
no release, provider run, live qualification or cohort composition is claimed.
