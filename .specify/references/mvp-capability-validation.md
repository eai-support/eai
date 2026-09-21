# MVP Capability-Based Validation Contract

## Purpose

Validate the work that the active feature specification requires now. Do not
apply later delivery requirements to an early MVP.

## Capability States

Use one state for every relevant capability:

| State            | Meaning                                                                | Validation result                                     |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `not_applicable` | The feature does not require this capability.                          | Excluded from the result.                             |
| `planned`        | The feature includes this capability, but no code exists.              | Visible as planned. It does not fail the current MVP. |
| `implemented`    | Code or configuration exists.                                          | Evidence is required before completion.               |
| `verified`       | Required evidence passes.                                              | Complete for the current feature scope.               |
| `blocked`        | The active feature requires this capability, but evidence cannot pass. | The affected outcome is not complete.                 |

## Required Gates

1. Create `.specify/specs/{feature}/` before app or operator-tool source work.
2. Map every specified requirement to an automated test, smoke check, or named
   manual check.
3. Validate only capabilities that are `implemented` or required by the current
   delivery decision.
4. Store HTTP checks, screenshots, and manual review evidence in the feature
   validation report.
5. State the exact feature result. Do not call an app working when a required
   journey fails.

## Conditional Gates

| Capability                   | Required when                                                                                                     | Not required when                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| EAI CLI and tenant readiness | The current feature uses EAI Platform services or the user asks to prepare an EAI deployment.                     | Local MVP work does not use EAI services yet.              |
| EAI app template readiness   | The feature creates, changes, or validates an EAI Platform app integration.                                       | The local MVP has not entered EAI integration scope.       |
| Authentication journey       | The specification includes sign-in, protected content, user roles, or a deployment target that requires identity. | Authentication is explicitly out of the current MVP scope. |
| Deployment evidence          | The user asks to deploy or the feature claims a deployed outcome.                                                 | Local development and preview only.                        |
| Browser preview evidence     | The feature changes user-facing behaviour.                                                                        | Non-app work or no user-facing change.                     |

## Authentication Journey

When authentication is `implemented`, `required`, or `blocked`, record these
checks:

1. Provider endpoint responds as expected.
2. Callback address matches the configured provider value.
3. Sign-in completes.
4. A session exists.
5. The first protected API call succeeds for an authorised user.
6. An unauthorised user fails safely.

Use `.specify/references/platform/eai-auth-access.md` for the access decision.
Record owner confirmation of `workspace-only` (default) or explicitly approved
`platform-authenticated` access. Test non-members, cross-tenant requests,
revocation, and unavailable membership checks. Sign-in alone is not permission.
Client SSO is a separate choice. Changing the provider must not widen access.
Require a real federated journey before claiming that SSO is verified.

If authentication is `not_applicable` or `planned`, record that state and the
trigger that will make it required. Do not report an authentication failure.

## Direction Changes

Before work continues after a scope change:

1. Update `spec.md`, `plan.md`, `tasks.md`, `traceability.md`, and the active
   validation scope.
2. Record the change, business effect, new capability state, and test impact.
3. Tell the user what changed, what remains valid, and what now needs evidence.
4. Re-open only the affected pipeline loop.

## Completion Language

Use one of these truthful statements:

- `The current MVP works for its specified local journey.`
- `The server runs. Authentication is not in the current MVP scope.`
- `The server runs. Authentication is required and currently blocked.`
- `The deployed journey is not verified because browser evidence is unavailable.`

`run.sh`, `run.bat`, and `run.ps1` prove that the app starts. They do not prove
authentication, sessions, EAI access, or deployment readiness.

## Release Capability Ledger

For a feature that claims a release or deployed outcome, create
`release-capability-ledger.md`. Record every accepted capability with:

| Field                   | Required evidence                                              |
| ----------------------- | -------------------------------------------------------------- |
| Business requirement    | Requirement ID and plain-language outcome.                     |
| Acceptance evidence     | Automated test, smoke check, or named manual check.            |
| Responsible change      | PR number and commit.                                          |
| Required release branch | Branch or release candidate that must contain the commit.      |
| Deployed evidence       | Browser, API, or operational evidence for the claimed outcome. |

Final validation must not report a complete or 100% result when a required
capability is missing from the specification or traceability record, remains on
an open PR, is absent from the release branch, or lacks required browser
evidence.
