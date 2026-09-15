# App Access And Client Sign-In

## Business Decision

Sign-in confirms who a person is. It does not grant workspace access. An EAI
workspace is an application tenant, not the shared CIAM directory.

When authentication enters scope, ask:

> Who should be able to use this app: only members of its EAI workspace
> (recommended), or any authenticated EAI user?

Default to `workspace-only`. Wait for the answer before changing auth code. Do
not treat silence as approval. Continue unrelated approved work if possible.
Keep stricter existing restrictions. Do not silently change an existing app's
access policy. Ask again when the owner changes this decision.

| Choice                   | App access                                                             | Data access                                                                               |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `workspace-only`         | Verified members of the configured workspace who meet app permissions. | Only the resources permitted by their roles.                                              |
| `platform-authenticated` | Valid EAI users may enter the explicitly approved app experience.      | Workspace data still needs explicit authorization. No automatic membership or admin role. |

The wider option needs an approved onboarding and data-isolation design. Do not
use an app credential to give a visitor the owner's workspace access.

Record the choice, rationale, confirmation, target workspace reference, app
permissions, and tests in `spec.md`. Keep real tenant IDs and secrets out of
public artifacts. Update plan, tasks, traceability, and validation on changes.

## Server-Side Enforcement

Verify identity and permissions on protected pages, server actions, and APIs.
Resolve membership from the approved platform contract using the authenticated
user and the configured app workspace. Do not trust a client-supplied tenant ID.
Apply the platform's verified membership semantics, including inherited access
only when the contract permits it. Do not assume direct membership is the only
valid form of membership.

A session, shared CIAM `tid`, matching email domain, hidden button, or selected
CLI tenant is not app authorization. The CLI operator is not the runtime user.
Unknown, unavailable, revoked, or expired authorization must fail closed. Define
bounded cache expiry and revocation handling. Never keep access forever because
an earlier session was valid.

## Separate Sign-In Decision

Ask whether users should use normal EAI sign-in or their company sign-in through
EAI. This does not change the app's workspace access policy. For client SSO,
prefer federation through EAI's identity layer so platform sessions, API
audiences, tenant membership, and permission checks remain intact. Do not point
the app directly at a client issuer and assume EAI APIs accept it.

Discover the installed CLI with `eai --describe` and exact command help. Never
invent an `eai sso` command. Check the deployed platform contract and tenant
entitlement before offering a configuration action. Provider capability, backend
source, a setup menu, and successful end-to-end sign-in are different levels of
evidence.

## Tenant Admin SSO Setup

1. Confirm the EAI workspace, app, current access decision, and SSO entitlement.
2. Identify the client's identity administrator and approved provider.
3. Verify the supported EAI setup route. If no supported CLI or admin screen
   exists, request platform support. Do not bypass it with guessed endpoints.
4. Have the client administrator prepare the federation registration, issuer,
   callback settings, and required claims. Transfer secrets only through an
   approved protected channel, never chat, specs, source, or logs.
5. Have an authorized EAI operator configure the provider and associate the
   intended user flow and apps. An EAI tenant-admin role does not itself grant
   administration of the shared Entra directory. Protect other tenants' flows.
6. Plan existing-account continuity and preserve memberships and roles. Never
   link identities by email alone. Keep a tested emergency admin sign-in path.
7. Test a pilot user, a denied user, session creation, and a protected EAI API
   call before rollout. Test rollback and document who owns credential renewal.

Adding SSO is not proof that existing CIAM users have migrated. Do not remove
their original sign-in method until identity continuity and recovery pass.

Microsoft documents Entra workforce sign-in through custom OIDC federation. It
requires client registration, provider configuration, user-flow association, and
sign-in testing. This vendor support does not prove the deployed EAI setup
supports that path. Recheck EAI if it reports an older restriction.
[Microsoft setup guide](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-entra-id-federation-customers).

## Required Evidence

Apply these checks when authentication is implemented or required. Do not add
auth requirements to non-app work or an auth-free local MVP.

- An authorized workspace member completes the first protected journey.
- An authenticated non-member cannot access protected workspace content.
- Anonymous users cannot access protected content.
- A forged workspace selection cannot change the authorization boundary.
- A revoked member loses access within the documented revocation bound.
- An unavailable membership service does not grant access.
- The wider mode, when approved, still denies unauthorized workspace data.
- A federated pilot retains the correct EAI identity, memberships, and roles.
- Changing the sign-in provider does not widen the approved access policy.

Record browser and API evidence against acceptance criteria. If tests cannot
run, mark the affected outcome unverified. Instructions and passing source tests
do not prove that a customer's app or SSO configuration is secure.
