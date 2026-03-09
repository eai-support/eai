---
feature: 001-cli-consolidation
created: 2026-03-09T11:00:00Z
status: complete
---

# Spec: CLI Consolidation & Org Migration

## Overview

Consolidate all vertical-related feature work from the trialportal repo into a single, coherent CLI package at `eai-tools/eai-cli`. Update all references from `enterpriseaigroup` to `eai-tools` for the template repo. Enhance scaffolding quality based on lessons learned from demo-iom and the vertical-delivery-pipeline spec.

## Requirements

### R1: Org Migration (Critical)
- Update template repo URL from `enterpriseaigroup/Vertical-Template` to `eai-tools/Vertical-Template`
- Update GitHub org constant from `enterpriseaigroup` to `eai-tools`
- Update package name from `@enterpriseaigroup/cli` to `@eai-tools/cli`

### R2: Enhanced Object Types Scaffold
- Generated `object-types.ts` should include rich comments documenting all field types
- Include a complete example type with properties, links, actions, side effects
- Show multi-tenant structure (single key with array) with comment for dual-tenant pattern

### R3: Enhanced `.env.local` Generation
- Include `TENANT_KEYS` variable
- Include `TENANT_<KEY>_ID` and `WORKFLOW_<KEY>_ID` with clear placeholders
- Include `BASE_URL_PUBLIC_API` with correct default
- Include `APP_BASE_PATH` derived from app name
- Include comments referencing `eai env pull` for cloud sync

### R4: Deploy Workflow Generation
- Include `build:object-types` step before `build`
- Include correct `APP_BASE_PATH` environment variable
- Include `target-path` for multi-app deployment
- Reference correct GitHub secrets

### R5: Project CLAUDE.md Generation
- `eai init` should generate a project-specific CLAUDE.md
- Should reference Platform SDK, Object Types guide, BFF proxy pattern
- Should include the Vertical Delivery Checklist (10 steps)
- Should document available `eai` CLI commands relevant to the project

### R6: Archive Trialportal Feature Branches
- Document which specs from trialportal are consolidated here
- These specs remain archived in trialportal — no deletion needed

## Out of Scope
- `eai types define` interactive builder (Phase 3)
- Local mock gateway / offline mode (Phase 5)
- Developer portal / Docusaurus (Phase 4)
- Multi-tenant middleware generation (domain-specific, not generalizable)
- Custom BFF route scaffolding (domain-specific)
