# Verified Agent Execution

## Real Checks, Repair And Recovery

`createAcceptanceChecker` in `gofer-acceptance-check.mjs` runs reviewed absolute
programs with argument arrays, not shell command strings or worker-supplied
commands. The trusted host supplies the current input revision. Checks fail on
changed inputs, nonzero exit, timeout, cancellation or excess output. Private
receipts contain bounded output; repair prompts receive receipt references and
failed check IDs, not raw logs. This helper is not a sandbox. Reviewed commands
retain their normal operating-system permissions and inherited environment. Do
not use it to run untrusted programs. Successful checks also require a trusted
`verifyCleanup` callback with a matching process ID, start time and evidence
receipt for the complete owned process tree. A closed parent alone is
insufficient. Missing proof prevents a passing result. The bounded drain path
can stop waiting without proving escaped children stopped; the report keeps
cleanup unverified. No containment adapter is qualified here.

The kernel consults the existing blocker register before each attempt. Waiting
or blocked work does not dispatch another worker or repeat the unanswered
question. Ready repair work still needs the trusted reservation adapter and its
existing limits.

`inspectExecutionRecovery` in `gofer-execution-recovery.mjs` inspects the
original journal without changing it. It preserves consumed limits and requires
trusted worker and receipt checks. It never authorizes resume or replays
uncertain side effects. An interrupted atomic commit or remote worker still
requires host reconciliation. This is a checked snapshot, not an atomic
authorization to reuse state. The host must revalidate inputs and blockers
within its atomic commit before changing task status. Older journals without
check/attempt/concurrency metadata remain blocked for explicit reconciliation;
their records are never deleted or treated as a new run.

`gofer-execution-metrics.mjs` compares matched baseline and candidate trials.
Include failed, blocked and timed-out trials, every worker/reviewer/retry, and
missing usage. Unknown values stay null. The reporter does not authenticate
native labels or declare a product speed improvement. Actual native
qualification remains required.

## Business Summary

Keep the agreed outcome. Use specialist help when it improves the work. A reply
from an agent is not proof that a feature works. Keep all required reviews, even
when they must run one after another.

## One Catalogue, Different Hosts

`agent-catalog.json` records the existing specialist roles. The companion
`gofer-agent-catalog.mjs` reads role instructions without provider frontmatter.
Run its `--help` before using its command-line interface. Shared role content
does not mean a host has registered or executed a native agent.

Use this contract for all stages and helpers, including non-app research.
Conversation and maintenance do not require an unnecessary multi-agent run. Keep
EAI app setup, workspace access, MVP scope, preview, and release rules intact.

Before assigning a specialist:

1. Run `gofer-host-capability.mjs --host <current-host> --json`. This probes
   only the local executable. It does not discover models or qualify isolation.
2. Identify the current surface and its installed version.
3. Read the role's responsibilities from the shared catalogue.
4. Verify available models and tools from the actual host.
5. Check allowed read/write scope and independent execution support.
6. Give the worker its task, current requirement revision and acceptance checks.
   The catalogue requires `requiredChecks` and binds that list into the
   assignment proof. A missing list or proof for a different list cannot
   authorize dispatch.
7. Give reviewers requirements and evidence, not the builder's reasoning
   history.
8. Record actual execution identity, limitations and results.

Never create model identifiers from examples or bypass host permissions. Native
controls enforce isolation. A prompt or capability JSON file cannot. Known
failed isolation remains blocked until a new exact-version test passes. Do not
turn all specialists into user-facing commands.

### Antigravity isolation status

On 2026-09-17, `agy` 1.2.4 completed a scoped native task launched from a fresh
temporary workspace, but wrote its output to the global Antigravity scratch
directory instead of that workspace. This proves native invocation only. It is
negative evidence for workspace isolation, scoped writes and independent
execution. Do not qualify Antigravity native delegation, or issue a capability
receipt claiming `git-worktree` isolation, until a new exact-version run proves
the host writes only inside a Gofer-created isolated boundary and returns a
durable host receipt.

### Local isolation requirement

A qualified local task needs both a dedicated Git worktree and an operating-
system sandbox. A worktree separates source changes; it does not restrict the
host process. Cloud execution cannot substitute for this evidence.

EAI Setup checks the machine prerequisites. Gofer creates a dedicated task
worktree, then asks EAI CLI to report local isolation readiness for that exact
path. The report is a readiness check, not proof that a host executed the task.
A fresh host receipt is still required.

After a verified run, the controller must call the native runtime's `dispose()`
method to remove its clean, receipt-bound task worktree. Disposal is refused
while a run is active, failed, or incomplete. Keep the worktree for independent
recovery inspection; do not force-remove it to clear a failed task.

The native runtime requires a trusted `bindWorkspace` factory. It supplies the
exact task worktree and receipt. The factory must return validation, input,
reservation, lease, and commit methods bound to that worktree. The controller
keeps its plan, journal, and worker evidence under the source workspace, outside
the worker sandbox. The runtime rejects an unbound adapter, a control directory
outside the source workspace, or a changed task worktree before run.

Any missing sandbox, full-access bypass, cloud route, unbound project, or
unsupported surface fails closed. Do not start a verified task by using the
ordinary workspace-opening command.

## Bounded Execution

`gofer-verified-execution.mjs` exports an experimental trusted-adapter
controller. It reads `priority-plan.json` and `loop-contract.json`; it does not
create a second task plan. It calls the existing priority checker before
admission and after reported changes. It serializes overlapping declared write
scopes.

The host integration must supply these trusted functions:

| Function        | Obligation                                                                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reserve`       | Reserve an attempt through the stable blocker register and existing permissions/budgets. Deny an exhausted or unanswered blocker.                                                                                                                                       |
| `lease`         | Grant a unique, finite task lease after reservation. A missing or expired lease prevents dispatch.                                                                                                                                                                      |
| `execute`       | Execute authorized work in the qualified boundary. Return actual changed files; do not trust worker-declared scope alone.                                                                                                                                               |
| `inputRevision` | Return the tested input identity, including relevant uncommitted files. A commit alone is insufficient.                                                                                                                                                                 |
| `check`         | Execute a configured acceptance check separately from the worker. Store raw evidence and return matching task, revision, check and exit status.                                                                                                                         |
| `verified`      | Compare-and-set task progress against expected direction, input and cancellation. Call `assertCurrent` immediately before the conditional commit. Return matching identities, `committed: true` and a durable receipt. Never change the specification to match failure. |

These functions are code supplied by the host integration, not arbitrary
commands returned by an agent. The controller does not install or launch host
CLIs itself. It does not provide a sandbox or verify provider identity.

Use finite parent call, attempt, concurrency and deadline limits. A deadline
signals cancellation and stops new work. It does not prove a remote process
stopped. Record unresolved side effects before further work. Monetary limits are
rejected until a spend-reservation adapter exists; unknown cost is null.

The append-only journal is an action-governing runtime ledger: it records
reservations, leases, checks, conditional commits and terminal state before an
operator can rely on the result. The controller also writes an atomic delta
checkpoint with the current task state. An existing journal requires
reconciliation; do not delete it, change its name, or create a new run to reset
limits. Automated crash recovery is not qualified yet. Previously completed
checkboxes require evidence reconciliation; the controller does not treat them
as fresh proof. Conditional commits and physical isolation remain trusted
adapter obligations. Uncertain commits must be reconciled before resumption,
even if a task checkbox was already written.

Only required current-input checks can verify a task. All required branches must
pass before their dependent work starts. No majority vote can waive a required
check. Feature completion still requires existing delivery, priority outcome,
closed-loop and release-capability checks.

## Current Qualification

The controller and catalogue have deterministic test coverage. Role definitions
are reusable **advisory** guidance until the relevant host supplies fresh proof
of real execution, read/write isolation and granted tool permissions. Local
process tests are a separate category. Neither category qualifies Claude, Codex,
Copilot, VS Code, Grok or Antigravity native delegation.

The shared protocol now provides host discovery and assignment binding. Native
adapters, read-isolation qualification, cancellation of remote work, restart
reconciliation and matched product benchmarks remain host-specific release
gates. Keep an affected feature in draft until its applicable gates pass. Normal
safe Gofer use remains available; unavailable specialist work stays unverified.

## Evidence Classes

Report each separately: instruction/package coverage, simulated adapter tests,
real local processes, native host execution, and matched product outcomes.
Record failures, cancellations and timeouts, not just accepted answers. Do not
claim speed or cost savings from simulated timers or file counts.
