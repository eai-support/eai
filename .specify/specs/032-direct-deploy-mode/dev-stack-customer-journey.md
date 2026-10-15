# #3592 fresh customer sign-off — existing hybrid DEV stack

Prepared 16 October 2026 (Australia/Sydney). This is a runbook, not executed customer evidence. Root owns browser, customer mutations, stack control, evidence journal and cleanup.

## Existing paths and release identity

- Reuse `eai-stack/dev-stack/dev-stack.sh` and the already configured hybrid data target; do not create replacement storage accounts, registries, queues, identities or deployment infrastructure.
- Existing default local ports in that script: PublicAPI `http://localhost:8000`, AdminAPI `http://localhost:8010`, Admin Portal `http://localhost:3010`. Treat these as configured defaults, not current health receipts.
- Reuse the current owner-protected Installer preparation from `workspace-setup/scripts/dev-stack/prepare_installer_clients.py` and its private `installer.env`. It binds `dev-stack-local`, the existing pinned HTTPS PublicAPI tunnel, template, Gofer and local Portal origin. Do not print the environment file, tokens or private config.
- Use the newly prepared CLI 3.21.0 package, not a previous #3503 staged CLI copy. Canonical tarball: `eai-cli/docs-site/static/registry/-/@enterpriseai/cli-3.21.0.tgz`; prepared SHA1 `45f8569d48ddec275d68e099773539456ec59204` (refresh from final `verify-docs-publication.cjs --prepared-source` receipt if repacked).
- Production-dependency install prepared for execution: `/Users/van/Documents/Australia/Work/EAI Repos/eai-cli/.specify/specs/032-direct-deploy-mode/evidence/packed-cli/bin/eai`. Use Node 24, for example `/Users/van/.local/share/fnm/node-versions/v24.15.0/installation/bin/node /Users/van/Documents/Australia/Work/EAI Repos/eai-cli/.specify/specs/032-direct-deploy-mode/evidence/packed-cli/bin/eai …`. Host default Node 20 is not supported.
- Before customer writes, root records final component commit SHAs, consumed local process descriptors, the deployed TenantInfra DEV identity and the existing active ACR/storage/worker configuration. DEV infrastructure consumption is a separate prerequisite; a local build is not a deployed worker receipt.

## Fresh customer identity and onboarding

1. Root opens a clean browser context and starts a new signup through the configured local signup URL. Use an approved fresh test mailbox/customer identity; do not reuse the old #3503 actor, workspace, app or operation.
2. Complete signup and create a uniquely named customer workspace through the customer UI. Record its exact owner workspace ID, chosen region and actor ID in the private journal. Confirm hosting entitlement through the normal product path. Missing entitlement is a blocker; do not bypass it, seed it silently or weaken authorization.
3. Launch the existing prepared Installer with its established private environment. Complete the real customer setup: new project folder, signed-in fresh account, newly created workspace and new application. Record elapsed time, emitted app key, exact runtime tenant ID and the Installer's final acknowledgement. If the prepared Installer bundles an older CLI, root must refresh its preparation against final CLI source through the existing helper before execution; do not call an old prepared client proof current.
4. In the new project folder, run the packaged CLI with `--profile dev-stack-local whoami --format json`. Verify actor and selected workspace match step 2. If an old profile token is selected, stop and sign out/sign in through the supported customer CLI flow before any write. Do not copy old token files into the journey.
5. Inspect the generated project binding and app-owned source. Record the exact owner workspace, runtime tenant, app key and template revision. Retain the normal generated runtime/auth controls. Add a harmless visible app-owned marker (for example “Direct deploy sign-off <run-id>”) without changing deployment controls or dependencies.

## Direct source and live access

Set shell variables from the acknowledged fresh records; never guess IDs or substitute a previous customer:

```sh
# Run only after root has authorized execution and validated the fresh identity.
# Existing private installer.env/profile routing remains in force.
NODE24=/Users/van/.local/share/fnm/node-versions/v24.15.0/installation/bin/node
CLI=/Users/van/Documents/Australia/Work/EAI Repos/eai-cli/.specify/specs/032-direct-deploy-mode/evidence/packed-cli/bin/eai
# OWNER_TENANT, RUNTIME_TENANT and APP_KEY are the exact fresh acknowledgements.
"$NODE24" "$CLI" --profile dev-stack-local whoami --format json
"$NODE24" "$CLI" --profile dev-stack-local deploy source validate --format json
"$NODE24" "$CLI" --profile dev-stack-local deploy app "$APP_KEY" \
  --target eai --tenant-id "$OWNER_TENANT" --target-tenant-id "$RUNTIME_TENANT" \
  --source direct --environment dev --wait --format json
```

6. Capture the CLI's JSON, exit code, operation ID, canonical bundle/config digests, template revision and state transitions. Confirm the server-side ACR build, image digest, deployment ID and readiness belong to that exact operation. No customer GitHub repository, browser GitHub linking, PR or child-workflow dispatch is part of this mode.
7. In the fresh customer's existing Launch App page, observe actual accepted/building/deploying states while the operation runs. Confirm “Uploaded by CLI”, returned environment and absence of repository/PR/deploy/transfer/rollback controls. Follow the existing Deploy sidebar/deep link too: it must share the read-only Launch presentation and must not mount GitHub management controls while status is loading or unavailable.
8. Require CLI `ready`, exit 0, the independently verified TenantInfra active pointer and the exact same app/runtime/environment in the Portal. Click the visible HTTPS URL or Open app button. Complete the fresh customer's app login where required and verify the visible authored marker and a small real app-owned customer action: create a Task and record its exact identifier/content for every later persistence check. Record authenticated browser outcome and source/runtime receipts; an HTTP 200 or a rendered Portal page alone is not sign-off.

## Idempotency, failure and recovery

9. Repeat the unchanged direct deploy and verify the same sealed operation is returned without another build. Observe it using the printed resume command. The reserved `direct-<32hex>` operation ID also supports inferred direct resume without `--source`; explicit `--source direct --resume <id>` is preferred in the journal. No source upload or GitHub action may occur on resume.
10. In this DEV-only fresh app, introduce a small reversible compile error in app-owned code and submit a new direct deployment. Require nonzero CLI exit, `failed` with the real reason/bounded log and `activeUrl: null` on the failed operation. The Portal must display failure plus the independent prior `activeDeployment` pointer. Click Open app and confirm the original marker and the same Task are still live. A failed candidate must not replace the active deployment or image.
11. Restore the original source. Repeating its unchanged bundle may idempotently reuse the original ready operation. Verify the authoritative active pointer and live customer action again. A polling timeout is incomplete observation: resume the exact operation rather than claiming failure or creating another upload.

## Required same-app customer-owned GitHub handoff

This sequence is required for final sign-off, after the direct-ready action, redeploy and failed-update checks above. Existing generator code or mocked tests alone do not prove the handoff. Root performs the authorized live customer/GitHub mutations only after the deployed DEV prerequisites are ready.

12. Retain the same fresh customer, owner workspace, runtime tenant, app key and DEV environment. Read the same Task created in step 8 through the authenticated app, retaining its identifier and content for the handoff persistence checks. Use the customer's newly authorized GitHub App installation and a new customer-owned repository; follow the existing browser GitHub link/install flow. Do not reuse an old #3503 source anchor, installation receipt or repository.
13. Push the customer's app-owned source through the repository's normal authorization and branch rules. From that bound local checkout, invoke the packaged CLI with the exact retained scope and new GitHub repository/installation:

```sh
"$EAI_CLI" --profile dev-stack-local deploy app "$APP_KEY" --target eai \
  --tenant-id "$OWNER_TENANT" --target-tenant-id "$RUNTIME_TENANT" \
  --source customer-owned --repo "$CUSTOMER_REPOSITORY" \
  --installation-id "$GITHUB_INSTALLATION_ID" --environment dev --wait --format json
```

14. Require the supported canonical workflow installation/review stop when files differ: `.github/workflows/eai-app.yml` together with `scripts/source-unknown-deployment-evidence.mjs` and other emitted canonical runtime files. Inspect generated candidates against existing edits, apply only reviewed canonical changes, then customer-authorized commit/push before rerunning the exact CLI command. Preserve the generated workflow and collector pair. Do not hand-write YAML, install token secrets, invent an OIDC identity, use `deploy setup`, `source move` or `source authorize-commit`, or assume an EAI-maintained anchor exists. Missing or conflicting files are a blocker to resolve through the emitted supported flow.
15. Follow CLI browser authorization/retry/status output. Capture the resulting source-unknown operation, exact committed SHA, nonce/config correlation, GitHub Actions run and collector completion, TenantInfra deployment/image and independently verified active pointer. This canonical workflow is **dispatch-only**: source push alone does not deploy. The CLI's exact authorized workflow dispatch and real Actions/runtime completion are required evidence.
16. Reload the same app's Launch page. Confirm the authoritative runtime source now selects the existing GitHub presentation; historical direct `ready` must not keep showing an obsolete direct URL as currently live. Open the verified current HTTPS app URL, authenticate as the same customer, verify the new source marker, and read/update the same Task from step 12. Record its persistence across the direct-to-GitHub transition.
17. In this new customer's DEV repository only, submit one reviewed reversible compile failure using the canonical GitHub deployment flow. Require actual Actions/build/deployment failure; verify the authoritative active pointer still identifies the prior healthy GitHub deployment and the same Task remains available. Restore the source through normal reviewed commit/push and exact CLI dispatch. Never infer failure from a local timeout or replace the active pointer with the failed candidate.
18. Exercise a wrong-target read using the same customer token against the same operation but a different authorized fixture target. Require the normal scoped denial/not-found result without exposing another target's URL or operation. Do not create another deployment to test isolation or use another customer's credentials.

Record a separate verdict for direct deploy, same-app GitHub handoff, Task persistence, failed GitHub update preservation and wrong-target denial. Any unexecuted or blocked step leaves customer sign-off incomplete.

## Stop conditions and closeout

- Stop on actor/workspace/runtime/app/region mismatch, unexpected existing #3503 data, missing entitlement, expired authentication, wrong consumed source, missing deployed worker, unavailable ACR/queue/storage, malformed direct projection, missing active pointer, wrong source discriminator, failed readiness, an inaccessible HTTPS app or missing authenticated customer action.
- A completed historical direct operation is not live proof. If the authoritative active pointer is a newer GitHub runtime, the Portal must return to the existing GitHub flow. Pending direct updates can show their own progress while preserving the separately verified previous active runtime.
- Do not resolve blockers by adding infrastructure, turning off auth/tenant checks, inventing an enable flag, forcing `ready`, fabricating an active URL or using a previous actor's credentials.
- Root's journal must distinguish repo tests, local process consumption, deployed TenantInfra/ACR evidence and authenticated customer acceptance. Record anything incomplete explicitly.
- Cleanup belongs to root through existing ownership-aware app deletion and its verified receipt for the fresh manifest/runtime only. Do not delete shared infrastructure, historical customer records or a shared workspace. Keep cleanup evidence separate from sign-off; do not run cleanup during this read-only preparation.
