# Clear Updates And Current Goals

## Business Replies

Explain what changed, why it matters, and what happens next. Use two or three
short sentences for progress. Do not repeat an unchanged update. State blockers
and uncertainty without hiding them behind technical terms.

Before sending, store the draft in a private local file and run:

```sh
node .specify/scripts/node/gofer-response-check.mjs --input <private-draft-file>
```

Use `--kind answer` for a full answer. Use `--previous <private-file>` to check
for an identical progress update. Use `--technical` only when the user asks for
technical detail. It is not a way to bypass a failed business reply. Rewrite
failed drafts; do not send the findings instead of explaining the work. Do not
commit drafts. The helper does not print the draft or previous reply.

The check flags a bounded set of jargon, length, repetition, and long sentences.
It does not prove meaning, technical accuracy, business clarity, or ASD-STE100
conformance. A human or model review must still check those points. It cannot
block chat messages sent directly by the coding app. Native tool logs remain the
host's responsibility. Never claim universal message interception.

## Reconcile Each Work Batch

1. Read the agreed goal, current spec, tasks, and latest findings before work.
2. Select tasks linked to that goal. Run the applicable acceptance checks.
3. After learning something new, record the evidence and affected assumptions.
4. Update the spec, plan, tasks, traceability, and validation scope as needed.
   Record why a document remains valid if no change is needed.
5. If the outcome, scope, cost, security, or delivery promise changes, ask the
   user before accepting that change. Do not rewrite requirements to excuse
   failing code. Preserve requirement IDs and the decision history.
6. Mark tasks complete only after their checks pass. Record failure or blockage
   instead of completion. Reopen affected tasks when evidence becomes stale.
7. Explain the business effect. Continue the next authorized batch or report the
   exact unresolved decision. Do not wait until final validation to reconcile.

This applies to app and non-app features. Conversation-only requests need no
feature files. Maintenance commands stay maintenance-only. Keep local MVP
exemptions: no forced sign-in or deployment if the current scope excludes them.

## Delivery Checkpoint

New loop contracts enable `requireDeliveryCheckpoint: true` by default. For an
existing feature with a spec and tasks, enable it in `loop-contract.json`. Do
not disable it to hide a failed check. Create or reconcile `spec.md`, `plan.md`,
`tasks.md`, and `traceability.md` first. Research-only work before that point
does not need placeholder implementation artifacts. Legacy loop audits report
that the new coverage is absent until it is enabled; they retain their existing
checks.

After checks pass, write a local JSON evidence record for each completed task:

```json
{
  "result": "pass",
  "check": "The actual executed acceptance check or named manual verification",
  "requirements": ["FR-001"],
  "specHash": "SHA-256 of the spec used by that check"
}
```

Keep actual command output or manual verification records alongside it. Do not
manufacture a passing record. Record evidence at test time; changing its spec
hash later is not a valid way to reuse stale results. Evidence records and the
mapping below are relative to the feature directory. Each traceability row must
link the task to its requirement IDs.

```json
{
  "T001": { "requirements": ["FR-001"], "evidence": "evidence/t001.json" }
}
```

Capture the reviewed state with that mapping file:

```sh
node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir> --capture --evidence-map <mapping-file>
```

An empty mapping is valid only when no tasks are complete. Capture stores
hashes; it does not mark tasks complete or approve changed goals. Do not
recapture solely to hide drift. Review the change, update affected documents,
rerun checks, and replace stale evidence first.

Before advancing a batch, resuming work, or claiming completion, run:

```sh
node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir>
```

The existing strict loop audit also runs this check from the tasks stage when
enabled or when a checkpoint exists. A failure blocks that audit. It checks
document freshness and recorded task evidence. It does not independently execute
acceptance tests, detect every code change, or prove semantic goal alignment.
Keep the existing goal, test, browser, review, and release checks.

## Supported Surfaces

Claude, Codex, Copilot, VS Code, Grok, and Google command/skill packages receive
the same rules and portable Node helpers through the existing build paths.
Package tests prove the files are present. Script tests prove the checker
behavior. Neither proves that a live desktop or CLI session called the helper.
If the host cannot execute it, report the check as unverified; do not invent a
pass.
