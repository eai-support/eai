# Blocker Mediation

Technical escalation now requires a fresh diagnosis in the ask event's
`verification` file. Use `priority-outcome-protection.md` for its required
fields. A real business decision needs no failed command. Existing retry
budgets, ask-once history and permissions remain unchanged.

Keep the agreed goal. Stop spending time when progress needs an answer, access
or a change outside the current work.

## When To Use It

Before retrying a failed action or asking for missing input, check the existing
record. Routine successful work needs no blocker entry.

Use the private feature directory for app or product delivery. For
conversation-only work, reuse a private session directory. Do not initialise an
app for a question. Share the directory when changing coding tools. Do not store
passwords, access tokens or customer details in the record.

## State And Actions

Run
`node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <directory>`
to inspect. Add `--task T001` only after confirming that task does not depend on
blocked work. No task filter means the whole feature.

Send actions with `--event <private-json-file>`. Reserve an action before asking
the user or starting a tool. Exit code 1 means stop that action. The helper
records decisions; it does not run commands or prove that permission was
granted.

| Action   | Effect                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------- |
| open     | Record the cause and affected tasks. Repeated opens retain history and widen, never narrow, task scope. |
| ask      | Reserve one question. Later attempts to ask again are denied.                                           |
| attempt  | Reserve one investigation, then at most one different recovery.                                         |
| result   | Record the reserved attempt's actual result. Progress alone does not mean resolved.                     |
| classify | Update the cause without clearing a wait or resetting the budget.                                       |
| resume   | Accept changed evidence and allow one further bounded investigation/recovery cycle.                     |
| resolve  | Accept the relevant successful check or genuine answer as resolution evidence.                          |

Use stable keys for the goal, affected subject and missing condition. Search the
register before assigning keys. Do not derive them from question wording, model
identity or command text. This identity rule needs agent judgement; the helper
does not detect semantic aliases.

An open event has this shape:

```json
{
  "action": "open",
  "goalKey": "feature-access",
  "subjectKey": "workspace-selection",
  "conditionKey": "user-choice-required",
  "category": "decision",
  "owner": "user",
  "question": "Which workspace should this app use?",
  "requiredChange": "The user selects the target workspace.",
  "tasks": ["T001"]
}
```

Categories are `decision`, `access`, `external`, `capability`, `solvable` and
`unknown`. The first four start in a waiting state. An empty task list affects
the whole feature. Other events use the returned `blockerId`. An `attempt` also
needs a stable `approachKey`. A `result` needs the returned `attemptId`, a
`summary` and `result`: `progress`, `no_progress` or `blocked`.

## Evidence And Resumption

For `resume` or `resolve`, supply `evidence` as a relative path inside the state
directory. A resume also needs `category`: `solvable` or `unknown`. Keep
evidence immutable:

```json
{
  "blockerId": "<returned blocker ID>",
  "kind": "change",
  "result": "changed",
  "source": "<actual user reply or external check reference>",
  "summary": "<what changed and why work can proceed>"
}
```

Resolution uses `kind: resolution` and `result: pass`. Cite a real answer for a
decision, or the relevant successful check for a technical fault. A login answer
does not prove app access. Record the check that the current scope requires.
Local MVPs do not gain new authentication requirements from this rule.

Missing, changed, reused or unrelated evidence is rejected. The helper checks
its identity and file hash. It cannot authenticate a user reply or verify the
truth of a hand-written receipt. The agent must inspect the referenced evidence
and respect host permissions.

One evidence-backed resumption is allowed. Existing lower time, token, retry and
permission limits still apply. If that allowance is exhausted, stop for human
review. Do not delete the record or invent a new goal. Repeated calls,
unanswered questions and unchanged status are not progress.

A pending attempt survives a restart. Inspect what actually happened before
recording its outcome; never launch it again solely because the chat ended. A
writer lock prevents simultaneous state changes. If a lock remains after a
crash, confirm that no writer is active before manual recovery. Do not
automatically delete it.

## User Update

State the result, business impact and one next action:

> The page opens, but sign-in still fails. Access is needed to check the account
> settings. This work is paused until access is available. The page layout can
> continue separately.

Ask the actual question once. Later progress updates must not repeat it. Waiting
is not feature completion.

## Validation Coverage

Strict loop checks reject unresolved or invalid recorded blockers. Legacy
features without a register retain their existing checks; absence is not proof
that no blocker exists. Package tests must execute the helper, test restart
behaviour, and verify all generated surface instructions. Native chat compliance
needs separate host tests. These instructions cannot force an unsupported host
to intercept every action.
