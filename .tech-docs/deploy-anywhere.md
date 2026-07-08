---
generated: false
title: Deploy An EAI App Anywhere
---

# Deploy An EAI App Anywhere

EAI apps declare a provider-neutral runtime contract in `eai.runtime.json`.
Hosting-specific tooling should translate that contract into provider env vars,
secret settings, callback URLs, and smoke checks. The app contract stays the
same whether the host is Vercel, Docker, AWS, Azure, Kubernetes, a VM, or an
internal demo environment.

## Local Contract Validation

```bash
eai runtime validate
eai deploy env --provider generic
```

The validator checks that required env names and secrets are declared, tenant
and workflow key patterns are consistent, the Auth.js callback path is valid,
public endpoints are declared, public endpoints do not claim anonymous
server-side platform access, and post-deploy smoke tests are present.

## Deployed Runtime Doctor

```bash
eai deploy doctor --url https://your-app.example.com
```

The deploy doctor checks `/health`, `/api/auth/providers`,
`/api/eai/config`, declared public endpoints, and declared smoke tests. It
classifies failures as host/infrastructure, app not running, Auth.js config,
Entra callback config, EAI PublicAPI config, tenant/workflow config, PublicAPI
authorization, or app runtime error.

`/health` returning 200 is not enough. Gofer should treat deployment as
incomplete until runtime smoke tests pass.

## Tenant Data Access

Tenant apps use signed-in-user/OBO access for EAI data-plane calls. Browser code
calls the local BFF at `/api/eai/...`; the BFF forwards to PublicAPI with the
current user's session token. PublicAPI, OPA/Authz, and ResourceAPI then
evaluate the user, app, and tenant together.

Do not add app-only `client_credentials` PublicAPI credentials for ordinary
ResourceAPI reads, writes, files, or search. If work must continue after the
user leaves the page, have the user request a platform workflow/job and pass
tenant, app, and user context into that workflow.
