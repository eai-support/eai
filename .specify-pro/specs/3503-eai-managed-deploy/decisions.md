# Decisions

## 2026-09-25 owner approval

Implement all reviewed client hardening while preserving successful commands, source modes, status vocabulary, and ownership boundaries. Do not merge, release, deploy, activate, bill, or run destructive live tests.

## Producer pin before release

The template feature is not released. Record its exact candidate commit and content digests and enforce byte/schema parity now. Keep the final immutable release tag/commit explicitly unresolved until the producer is merged and released. Do not predict or reuse a version.

The final reviewed candidate is app-template commit `56aa426b52e445d371061b529300dabe8b1abd99`. Its isolated handoff validates canonical schema provenance before OIDC, hashes the downloaded archive through a fixed-size no-follow buffer with an opened-size growth probe, and retains the same archive descriptor while bounded GNU/BSD-compatible tar operations inspect the index and exact referenced manifest blob. The handoff accepts the image digest only when one Linux/amd64 descriptor has a canonical digest, bounded size and supported media type and its actual manifest bytes have the exact size, SHA-256 digest, schema, and media type. It reads downloaded evidence through a bounded parent/leaf-bound descriptor and byte-caps each exact-source and GitHub metadata body before parsing. One trusted inline streaming helper counts the actual OIDC and PublicAPI response bytes even when `Content-Length` is absent, retains at most 1 MiB of token JSON, and writes the handoff response only through a new no-follow single-link descriptor before the clean checkout-free parser reopens it. Generated files use exclusive no-follow creation, governed reads bind pre-open size and timestamps, and GitHub command-file appends independently require one link on both the descriptor and leaf snapshots after writing. The collector caps each GitHub output value at 4 KiB and each aggregate append at 64 KiB before opening the command file. Its other reads use fixed 64 KiB loops to cap metadata, configuration, response, and archive bytes and reject post-open growth before allocating beyond the opened snapshot. Every collector open uses one shared capability guard and fails closed when no-follow or required nonblocking semantics are unavailable. Collector and handoff share the 10 MiB per-file, 32 MiB total, and 4,096-file manifest budget. Before application-controlled work, the workflow requires the approved commit to equal signed `github.sha` and passes that signed value directly to checkout; its build job has no persistent dependency cache. The handoff exact-binds legacy source-mode and target-tenant field presence, the current upload action's artifact ID and digest, the repository/run/source metadata, and the exact workflow attempt before OIDC. It retains `workflow_call` only for a manually dispatched caller and documents that PublicAPI must exact-bind signed same-repository caller/callee workflow, ref, path, and SHA claims. The CLI embeds both canonical files byte-for-byte. This candidate pin does not satisfy the deferred immutable release gate.

Direct CLI `workflow_dispatch` behavior remains unchanged and still requires a nonempty server-issued `config_hash` at runtime. The embedded producer rejects any non-`workflow_dispatch` caller event before checkout and does not use the deprecated `EAI_ACCESS_TOKEN` or `EAI_PUBLIC_API_URL` secrets. The historical reusable schema keeps `config_hash` optional: it derives the exact checked-out governed digest before application work when omitted and rejects any supplied mismatch, then carries the one validated value through evidence and isolated handoff. A reusable caller must grant the workflow's declared read, attestation, and OIDC permissions because the called workflow cannot elevate caller authority.

## Doctor compatibility

Keep URL-only black-box doctor behavior. Add optional deployment-operation bindings and a portable evidence-output option; managed deployment completion uses the stronger receipt.

## Explicit runtime tenant

The owner confirmed on 2026-09-25 that `--target-tenant-id` is mandatory on the initial command for both source modes as well as resume and retry. This prevents tenant inference and preserves same-tenant deployment by repeating the app-scope tenant value explicitly.

## Unified operation success

Use the additive unified operation response defined for Issue #3503. Terminal success requires root `sourceStatus` in `handoff_pending` or `completed`, active root and deployment status, `doctor.ready: true`, matching deployment and doctor identities, and a complete `sourceRevision` whose operation, source, tenant, application, environment, configuration, workflow, commit, artifact, image, repository, installation, and run fields match the root operation. Do not infer success from the TenantInfra projection alone.

The unified managed operation must also report `requiresTenantInfra: true`. This exact boolean confirms the managed TenantInfra handoff. A false, missing, or non-boolean value is not terminal managed-deployment evidence and remains pending.

## Local evidence and configuration paths

Treat caller-selected evidence as untrusted local input: open it without following the final link, prove the opened object is the same bounded regular file, and only then parse its canonical schema. For configuration hashing, reject a linked or non-directory component beneath the application root and recheck ancestors immediately before every no-follow file read; a lexical in-root path does not authorize a linked ancestor.

The governed configuration digest includes every regular file beneath `src/eai.config`, including test and specification files. Only `object-types.json` and `object-types.provisioning.json` are deterministic generated outputs and may be excluded. The CLI and packaged collector must produce the same digest from the same checkout.

Legacy exact-operation reads use the same safe opaque-segment validation as the unified managed route. Retry state is authoritative only when it carries the exact allowlisted `publicApiUrl` selected for the original operation; missing endpoint authority requires a fresh deployment rather than inheriting a current profile value.

## Producer and filesystem race closure

The deferred release gate resolves the immutable canonical producer tag and independently reads both canonical files from that exact commit before comparing pinned digests. Local byte parity alone is insufficient.

Source revision evidence carries `workflowBlobSha` as a lowercase 40-hex Git blob SHA and `collectorDigest` as a lowercase algorithm-qualified SHA-256 digest. The platform derives, verifies, and seals them from server-side linked-installation reads. The CLI does not establish producer trust from caller values; it requires the platform-sealed fields in terminal proof.

After a no-follow open, governed configuration and local publication re-resolve the path, compare its inode with the opened descriptor, and reject any escaped or changed ancestor before reading. Doctor evidence and local recovery receipts stage complete owner-only bytes in a separate inode, then revalidate the bound root, ancestors, and target immediately before publication; rejected staging leaves existing target bytes unchanged.

Keep `src/commands/eai-managed-deploy.ts` and `src/lib/eai-managed-source-client.ts` as compatible public entrypoints while moving focused implementation into modules below 300 lines. JSON failures retain the CLI-wide nested error envelope.

## Exact retry and completion authority

Load protected customer-owned retry state before the first network request. Build every retry read and mutation client from the state's original allowlisted `publicApiUrl`; unavailable local authority fails closed and leaves server state unchanged. A terminal failed source operation without accepted evidence always requires a fresh operation and nonce.

Before customer-owned redispatch, reread the original server-bound browser link session through that protected gateway and compare its verified GitHub numeric ID, case-insensitive login and proof ID with local retry state. The session must still match the sealed EAI actor, app, target, environment and link-session ID. A verified session's original browser deadline does not invalidate an existing operation retry; pending, failed, missing or mismatched proof cannot authorize dispatch. This adds one scoped read only when dispatch has not happened.

Recovery receipt save and load use the same trusted-directory preparation as complete retry state. Reject group/other-writable parents before setting the recovery leaf directory to owner-only mode. Managed source preparation persists its validated operation ID and original gateway authority before upload-token retrieval or external source upload, including idempotent prepared responses. If receipt persistence fails, return the prepared operation ID and do not upload; an uncertain upload response therefore retains the original recovery authority.

An EAI-maintained publication marked `completed` is valid only when it supplies a canonical lowercase 40-hex merged commit. The unified source revision must name that exact commit. Caller-selected evidence also binds every parent directory and the opened file identity through the complete bounded read.

The canonical collector's `sourceMode`, `targetTenantId`, `workflowBlobSha`, and `collectorDigest` are validated and forwarded as untrusted observations. PublicAPI remains responsible for repository, tenant, workflow, and collector authority. Local nonce-bearing retry-state updates, dispatch-claim updates, private evidence, and canonical generated files use an exclusive owner-only sibling stage with no-follow opens. Initial private claim/reservation creation retains direct no-follow exclusive creation without overwriting existing authority. After sync, publication revalidates the original root, ancestors, and exact target snapshot; an absent target is published without clobbering, while replacement requires the inspected existing file. Accepted output must retain the staged inode and single link. A rejected stage does not truncate or rewrite existing file bytes. Cleanup removes only a stage that still matches the writer's exact identity. Hostile same-UID namespace changes after the final path check remain outside a descriptor-relative atomic namespace guarantee.

Configuration hashing treats the governed path set as part of the snapshot. It repeats the complete inventory after all reads and fails when the sorted set differs. Configuration and bounded source readers revalidate the opened descriptor, complete ancestor chain, final contained path, size, modification time, and change time after bytes are read.

Recovery without an explicit source choice reads the unified exact operation and routes only from its sealed `sourceMode`. A customer retry still loads its protected original endpoint authority before that read. The target tenant uses the managed opaque-segment grammar before context resolution, retry state binds before any terminal/reuse branch, and doctor output resolves only beneath the application root.

Private recovery input remains bounded after open and before allocation. Canonical generated-file staging uses `O_EXCL`; an existing target must still be the exact inspected inode and unchanged size/time before replacement, and an absent target cannot be clobbered by publication.

Bind the requested application-root inode and ancestor identities across `realpath`, then recheck the same binding before and after source inventory, Git reads, configuration hashing, canonical installation, and receipt writes. A replaced root invalidates the operation instead of becoming a new authority.

Legacy source commands validate the configured regional PublicAPI URL before resolving tenant context. Source-unspecified customer retry constructs its first unified-operation client from protected retry state, so a regional context refresh cannot change the operation authority. The canonical producer supports both source modes on their respective routes. The legacy `app workflow-evidence` command accepts only source-unknown evidence and rejects a CLI source mode or operation namespace before tenant context or network access; the canonical CLI workflow submits directly to its operation-specific managed-source route.

## Final review closure

Treat terminal failure consistently across both source modes. An EAI-maintained publication that is already `failed` cannot reuse its operation or nonce. Resume and retry return a stable fresh-operation action before any additional poll.

The managed no-redirect rule covers authenticated tenant-context setup as well as deployment routes. The selected regional URL is allowlisted before setup traffic, and the setup client uses `redirect: error` for membership and tenant-management reads.

Canonical byte comparison is an authority decision. Read an existing target only through a no-follow descriptor while its parent identities, project-root binding, leaf inode, size, and timestamps remain stable. A matching symlink target is never `unchanged`.

Configuration hashing owns its project-root binding. The helper binds the requested and canonical root once and revalidates it before and after inventory and each governed file read. Callers do not supply or discard that authority.

Operation-bound doctor output uses the same original-root authority. Bind the application root immediately after command-context resolution, revalidate it after operation and runtime reads, and pass it into the owner-only descriptor write before any evidence directory can be created.

Legacy source-unknown commands use one managed request policy from regional endpoint discovery through membership, tenant management, app validation, and the final source operation. A validated base URL does not permit an authenticated redirect.

Configuration inventory includes directory identity, not only sorted names. Preserve the root/configuration directory inodes seen during initial traversal and reject a replacement even when it exposes the same filenames and valid replacement bytes.

## Recovery selector and system-alias closure

Validate every caller-controlled operation selector before tenant context, retry-state lookup, or network access. This includes `deploy app --resume`, `deploy app --retry`, operation-bound doctor, legacy source-unknown handoff, and the operation binding inside canonical workflow evidence. Use one bounded opaque-segment grammar at command and API boundaries; source-specific prefixes remain an additional schema check.

Operation IDs and deployment scope identifiers have distinct grammars. Operation IDs remain strict alphanumeric, hyphen, and underscore tokens. App keys and tenant scopes retain safe dots used by existing enrollments. Never reuse the stricter operation grammar to reject a valid dotted scope.

Do not treat every symbolic link directly below the filesystem root as trusted. The only supported exceptions are the fixed macOS `/tmp` to `/private/tmp` and `/var` to `/private/var` system aliases. Verify each alias resolves to its exact expected target, bind the alias and target identities, and revalidate both through the read or write. Reject every other linked ancestor.

## 2026-09-28 readiness closure

Resume and retry select source mode and environment from the sealed unified operation; explicit conflicting options are rejected. Every retry namespace reads an owner-only original-gateway receipt before authentication, and regional tenant discovery cannot replace that gateway. Terminal success requires the source and executed workflow SHA to be equal and independently compares source revision fields against platform-sealed setup fields, including repository/installation IDs and the managed review head. Local Git inspection, source traversal, doctor probes, and canonical installation retain the original project-root binding. Reads reject FIFO substitutions and hardlinks, and governed hashing retains at most 64 KiB per read while enforcing the same 10 MiB per-file, 32 MiB total, and 4,096-file limits as the final producer. These are code merge-readiness changes; the immutable producer release and live Installer-first qualification gates remain separate.

Managed local-file operations require nonzero no-follow and nonblocking capabilities and fail closed before opening when the host lacks them. Native Windows Node therefore requires a verified safe filesystem primitive or a supported POSIX environment before this managed-deployment path can be qualified; metadata inspection alone is not an atomic security boundary. Managed deployment endpoints deliberately allow DEV Australia East only, and TEST/PROD Australia East, Canada Central and Germany West Central, matching the approved environment/region scope.

Retry compares the persisted GitHub installation ID against independently sealed setup before dispatch, accepted-evidence handoff, or terminal success. Canonical positive numeric and decimal-string IDs are transport equivalents; a missing, malformed, or changed ID is a binding mismatch. V1 retry state does not persist a repository ID; terminal source revision continues to compare that ID against independent setup.
