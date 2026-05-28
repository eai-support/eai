# Feature 026: Public Platform Builder Experience - eai CLI

## Purpose

The `eai` CLI is a public builder tool. It must explain and automate what public developers can safely do on the EnterpriseAI platform using PublicAPI only.

## Problem

Strategy Monitor showed that CLI flows can scaffold an app but leave developers blocked by hidden platform prerequisites. Help output also needs to highlight update paths for the CLI, Gofer, templates, and UI components without implying destructive overwrites.

## Responsibilities

- Use PublicAPI for builder readiness, workflow status, workflow requests, app secret rotation, tenant capacity, and plan-gated guidance.
- Keep public help free of private service names and implementation details.
- Explain safe update flows for CLI, Gofer, vertical template, and UI components.
- Never overwrite generated vertical code without preview/diff, confirmation, and manifest/provenance checks.

## Functional Requirements

- `eai --help` highlights available update checks: CLI update, Gofer update, template check/update, and UI component check/update.
- `eai doctor` or equivalent uses `GET /v3/builder/readiness`.
- `eai workflow status <key>` uses PublicAPI runtime workflow status.
- `eai workflow request <key>` creates a public workflow provisioning request.
- `eai provision entra --rotate-secret` uses PublicAPI secret rotation for existing registrations.
- `eai template check` recognizes legacy `eai init` projects by manifest, package metadata, tenant config, Gofer assets, and scaffold commit heuristics; it should explain when provenance is inferred.

## Public/Private Boundary

CLI help may mention PublicAPI, tenant/app IDs, env vars, support docs, and upgrade URLs. It must not mention private repo names, internal service topology, privileged cloud operations, private policies, or internal runbooks.

## Acceptance Criteria

- A Strategy Monitor developer can run a single diagnostic command and see self-service, operator-required, and paid-upgrade blockers.
- Existing app secret rotation is available when policy allows and fails with a clear public next action when not.
- Template/update commands produce a preview and do not overwrite local customizations without confirmation.
- Help output clearly describes how to update Gofer, templates, and UI components.

