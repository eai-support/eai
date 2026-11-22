---
generated: false
title: Deploy An EAI App Anywhere
---

# Deploy An EAI App Anywhere

Start with EAI-managed container hosting when you want EAI to host your app.
You can also deploy the same app to another supported provider. The app keeps
the same runtime contract across hosting options.

## Hosting Options

### EAI-Managed Containers

Choose EAI-managed containers first for an EAI-hosted app. Use the EAI CLI
deployment flow to publish and check the app.

Validate the app source, then deploy it to EAI-managed containers:

```bash
eai deploy source validate --format json
eai deploy app <app-key> \
  --target eai \
  --tenant-id <tenant-id> \
  --target-tenant-id <runtime-tenant-id> \
  --environment preview \
  --source eai-managed \
  --wait
```

Use the tenant that owns the app for `--tenant-id`. Set
`--target-tenant-id` to the workspace where the app will run. If both are the
same workspace, use the same ID for both options.

### Other Hosting Providers

You can also host the app with Vercel, Docker, AWS, Azure, Kubernetes, a VM, or
another provider. You or your hosting provider manage that hosting environment.
The EAI CLI prepares the required environment settings and checks the deployed
app.

```bash
eai deploy env --provider vercel
```

## Local Contract Validation

```bash
eai runtime validate
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

Tenant apps use user-delegated access for EAI data-plane calls. Browser code
calls the local BFF at `/api/eai/...`; the BFF forwards to PublicAPI with the
current user's session token. PublicAPI, OPA/Authz, and ResourceAPI then
evaluate the user, app, and tenant together.

Do not add app-only `client_credentials` PublicAPI credentials for ordinary
ResourceAPI reads, writes, files, or search. If work must continue after the
user leaves the page, have the user request a platform workflow/job and pass
tenant, app, and user context into that workflow.
