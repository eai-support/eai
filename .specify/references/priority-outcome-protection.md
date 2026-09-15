# Keep The Agreed Outcome

Gofer must stay on the user's priority, not merely complete available tasks.
These rules extend the existing pipeline, not replace it.

## Before Work And After Resume

Record material changes to the goal, priority, scope or permission in the
private feature decisions.md before acting. Resolve what a short instruction
such as "do it" refers to. Do not copy secrets or every routine chat message.
Update spec.md, plan.md, tasks.md and traceability when affected. Never infer
approval.

Create priority-plan.json from the template by the tasks stage. Include every
task ID, its prerequisites and an explicit allowedEditScope. Paths are relative
to the repo: exact files or directories ending in `/`, not wildcards. Include
feature evidence paths where the task writes them. Empty scope means read-only.
Record `lastInstruction` in decisions.md. Keep this plan under the existing
delivery checkpoint so an unnoticed direction change fails the freshness check.

Before a task, run:

```sh
node .specify/scripts/node/gofer-priority-check.mjs --feature-dir <feature-dir> --task T001
```

Supply `--workspace <repo-root>` and `--changed-file <repo-relative-path>` for
every intended edit and again for the actual diff. The helper is read-only. It
does not intercept host tools; the agent must inspect the full diff, including
untracked files and other repos. The checker resolves existing parents of
proposed files and rejects symlinks that escape the approved scope. Recheck
immediately before an edit; the host still controls the actual write. It rejects
non-regular files and oversized records (4 MiB documents, 64 MiB per evidence
file, 128 MiB total unique evidence per review). Aliases reuse the same raw-file
hash. Keep focused evidence in the feature; do not weaken required checks to
reduce the record size. Task graphs are bounded at 20,000 tasks and 100,000
dependencies. Split larger work into reviewed features.

Follow `nextTask`. It resolves the first open priority task and its unfinished
prerequisites. Independent parallel work requires `parallelFor`, a reason and
the recorded approval ID. A blocked priority never authorizes unrelated chores.
Changing scope requires updating the plan and user understanding, not bypassing
the check. Preserve all release/security gates even for unrelated failures.

On resume, read the saved direction, goal, tasks and evidence before acting.
Say: "We are proving sign-in works. I will first check the failed login." Do not
dump internal IDs in routine progress updates.

## Before Asking For Help

Use the existing blocker controller and retry budget. For a technical blocker,
the `ask` event needs `verification`, a relative path in its private state
folder. The JSON diagnosis must include:

- `blockerId`, `kind: "diagnosis"`, `checkedAt` (UTC, within 24 hours),
  `source`.
- `classification`: product, tooling, credential, environment or self-caused.
- `command` and `observed`: the safe check actually performed and its result.
- `evidence` and `sha256`: the private output file and its raw-file SHA-256.
- `selfCauseChecked: true` and `selfCauseCheck`: verify syntax, route order,
  environment and existing configuration against current evidence.
- `authorizedRepairAvailable: false` and `authorityCheck`: explain why the agent
  cannot safely repair it within the approved scope and existing access.
- `alternativeCheck` or `noSafeAlternativeReason`. Logs or current help may be
  enough. Never replay a destructive action merely to reproduce a failure.

If an authorized repair is available, use the existing bounded recovery instead.
An expired token needs an actual session check, not an invented tenant. Having
an admin role does not authorize every change. Real business choices use the
`decision` category and need no fabricated technical failure. Evidence hashes
protect saved records from change; they do not certify that a claim is true.

## Prove The Current Outcome

Place the first meaningful user/runtime proof immediately after its minimum
prerequisites. The scope can be local MVP, non-app research or a deployed
feature. Do not require future authentication, a cloud deployment, or tenant
setup for work that does not yet need it. Later release checks remain mandatory.

The plan names the outcome, requirements, target environment/revision and
receipt. Before completion, run the helper with `--finish`. A receipt must
contain:

- `result: "pass"`, `outcomeId`, `planHash` and `specHash` (SHA-256 of raw
  files).
- `target` matching the agreed environment and exact code/document revision.
- `requirements` and nonempty `checks`, each with `command`, `result: "pass"`,
  relative `evidence` path and its raw-file `sha256`.

Traceability must name the receipt for each outcome requirement. Verify the
deployed revision independently before recording it. Rerun affected checks after
any code, direction or target change; a renamed or copied file is not new proof.
The helper checks recorded integrity, not the live environment or user consent.

Missing or failed proof means **outcome unverified**, even when other tests
pass. Keep those test results visible; do not erase them or claim the whole
feature passed. Existing task evidence checks still apply to every completed
task.

New loop contracts require this plan at stages 4-6. Earlier stages do not
require the final result. Legacy contracts retain their checks with an explicit
coverage limitation until reviewed and migrated. Conversation-only work needs no
plan.

Final closed-loop validation also uses
`gofer-closed-loop-audit.mjs --completion`. Without that flag, the audit checks
plan structure and drift only; it does not prove completion. The explicit
completion check requires the plan even for an older feature. Migrate it first
rather than silently accepting missing evidence.

## Release And Recovery

After this version records diagnostic proofs, do not downgrade to an older
blocker reader. Older readers reject the new proof type. Keep the current record
readers and completion argument when preparing a corrective release. User-facing
policy and new defaults can be reverted in that release without deleting
evidence or resetting retry budgets. Pause blocked work until the compatible fix
passes its tests. A package downgrade is not a supported recovery.

Merging release preparation updates the GitHub Pages feed. That is already a
rollout boundary, even before the Marketplace finishes. If a publishing step
fails, repair that same version's publication. Do not announce a complete
release until every required channel serves the checked version and helper
files.
