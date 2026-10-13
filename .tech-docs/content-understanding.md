---
title: Content Understanding
description: Configure bounded document analyzers from your own harness and read completed document results.
---

# Content Understanding

Your harness authors a JSON manifest. The CLI validates it locally, reads the selected workspace's capabilities, obtains a plan, and submits that unchanged plan through the platform. The platform owns Azure credentials, approved models, analyzer ownership, publication and activation. No Azure key or resource URL belongs in the manifest.

This mode supports typed document fields and one flat workflow classifier. It requires administrator permission and an enabled, ready workspace. Installed commands do not establish that the workspace has the capability. Nested classifiers, segmentation, audio/video, arbitrary model deployments and resource provisioning are unavailable in this mode; unsupported settings fail before any configuration writes.

These commands require CLI v3.20.0 or newer. The 3.20.0 source candidate requires package publication and DEV provider qualification before launch; the existing published release is listed in [Start Here](./start-here.md). The release owner must also regenerate and commit the matching static fallback registry before installer promotion. Source validation does not establish that the candidate is installable from either release channel.

## Author and validate

Start with the installed schema. Local schema and validation commands need no sign-in and make no network requests:

```bash
eai content-understanding schema --format json
eai content-understanding validate --file cu.json --format json
```

The schema is in the JSON response's `body`. Validation also enforces finite references, nesting, evidence and snapshot limits that JSON Schema alone cannot express.

A manifest identifies one workspace, bundle, app and workflow. The launch planner requires an existing app/workflow binding. When the manifest includes a classifier, its matching tenant-owned draft must already exist. Prepare these prerequisites with the existing app/workflow and classifier commands; the plan reports missing prerequisites before any typed configuration writes. Procurement and meeting summaries use separate bundles. Replace the workspace UUID and app/workflow keys below with your authorized binding:

```json
{
  "kind": "eai.content-understanding",
  "schemaVersion": 1,
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "bundleKey": "meeting-review",
  "provider": "azure-content-understanding",
  "apiVersion": "2025-11-01",
  "binding": {
    "appKey": "consultant-app",
    "workflowKey": "meeting-review",
    "documentLifecycle": "business-document-v1"
  },
  "documentTypes": [{
    "code": "MeetingMinutes",
    "name": "Meeting minutes",
    "contentUnderstanding": {
      "analyzerDefinition": {
        "fieldSchema": {
          "fields": {
            "MeetingDate": { "type": "date", "method": "extract" },
            "Summary": { "type": "string", "method": "generate", "description": "Summarize the discussion for a reviewer." },
            "ActionItems": { "type": "array", "method": "generate", "items": { "type": "string", "method": "generate" } }
          }
        }
      }
    }
  }],
  "classifier": {
    "classifierKey": "meeting-review",
    "displayName": "Meeting review",
    "definition": {
      "labels": [
        { "key": "MeetingMinutes", "displayName": "Meeting minutes", "description": "A written meeting record.", "documentTypeKey": "MeetingMinutes" },
        { "key": "Other", "displayName": "Other", "description": "Requires manual review.", "documentTypeKey": "Other" }
      ]
    }
  }
}
```

For this example, save the `classifier` object from the manifest as `classifier.json`, retaining its exact key and label mappings, then save the draft in the same workspace:

```bash
eai classifier save --file classifier.json --tenant-id <workspace-id> --format json
```

The plan verifies the existing binding and draft alongside the desired analyzer/classifier configuration. Inspect its actual blockers before applying.

Field types are `string`, `date`, `time`, `number`, `integer`, `boolean`, `array`, `object` and `json`. Methods are `extract`, `generate` and `classify`; an omitted method retains the provider's extraction default. Arrays require `items`, objects require `properties`. Classify fields require a string enum; optional `enumDescriptions` must cover that enum exactly. Definitions can use finite local `#/definitions/<key>` references. Field keys are ASCII identifiers of at most 64 characters. Bounded human strings use UTF-16 code units, matching the platform validator; a paired emoji counts as two. Unpaired surrogate characters are invalid.

Extraction requires effective source and confidence estimation. The platform preserves observed null evidence instead of inventing confidence. Generated summaries and action items are suggestions for a reviewer. Defaults are schema version 1, base analyzer `prebuilt-document`, model profile `default`, `returnDetails: true` and `estimateFieldSourceAndConfidence: true`. Explicit false segmentation/omission flags are allowed; enabling them is refused. Local validation accepts the bounded formula/figure/output-format syntax. Apply and acknowledged continuation require `features.advancedDocumentConfig` to be exactly true whenever one of those settings is supplied with a value other than false. Ready typed mode also requires `features.typed_fields` and `features.flatClassifiers` to be exactly true; flags and readiness are verified again before continuation.

Each bundle supports at most 64 document types and 64 flat labels. Each analyzer is bounded to seven expanded field levels and 200 expanded validation nodes, including unused definitions and reference expansion. Combined normalized analyzer snapshots have a 16 KiB admission budget. Unknown properties, legacy rules mixed with typed definitions, external references, cycles and context templates in field descriptions are rejected.

## Plan and apply

```bash
eai content-understanding capabilities --tenant-id <workspace-id> --format json
eai content-understanding plan --file cu.json --tenant-id <workspace-id> --format json > cu-plan.json
eai content-understanding apply --file cu.json --plan cu-plan.json --tenant-id <workspace-id> --wait --timeout 300 --format json
```

Proceed only when capabilities and the saved plan report `ready: true` with no blockers. Planning reads prerequisites and writes no configuration. The saved output binds the exact file bytes, workspace, bundle and selected API gateway to server-owned preconditions. Editing even whitespace in the manifest requires a new plan before a new operation. The backend verifies actual current versions and model bindings before initial mutation.

Apply may return an accepted `pending` or `running` operation. Retain its `operationId`. Successful current configuration requires both `status: "succeeded"` and `currentReady: true`. Historical completion alone is insufficient after configuration, binding or provider drift; false or missing readiness returns `CU_CURRENT_READINESS_UNVERIFIED` with the retained operation ID. Failed, partial, unknown and expired waits are also nonzero results with the retained identity. `--wait` has a bounded deadline of 1 to 1800 seconds. It polls the acknowledged operation and may resume its remaining publication/activation steps only when the backend explicitly returns `nextAction: "apply"`.

A safe HTTP failure after successful reservation can include its confirmed `operationId`; retain that ID and inspect the existing operation. If the acknowledgement is lost, `CU_APPLY_ACK_UNKNOWN` preserves the original plan identity. Keep the original manifest and plan. Deliberately repeat that original apply to recover the existing durable operation, or inspect its status once its ID is known. The CLI never automatically repeats an initial apply with unknown acknowledgement. A replacement plan or client-generated operation ID cannot establish recovery.

Operation IDs are exact nonzero canonical UUIDs assigned by the platform. The CLI refuses other strings before profile activation or authentication; general secret redaction remains enabled.

For an explicit `--operation-id`, JSON errors also preserve that valid supplied ID
when authentication, saved-plan, gateway or capability preflight fails. This
retention does not confirm existence or ownership; the backend must still
authorize the original operation before it can be read or resumed.

```bash
eai content-understanding status --operation-id <operation-id> --tenant-id <workspace-id> --wait --format json
eai content-understanding apply --file cu.json --plan cu-plan.json --operation-id <operation-id> --tenant-id <workspace-id> --wait --format json
```

Status reads the existing operation and never publishes or activates configuration. `CU_REQUIRES_APPLY` means provider work is ready and remaining changes need the explicit apply command with the original inputs. Resuming a known operation preserves its immutable workspace, bundle and definition. Repeating the original saved plan recovers the same operation even when its own activation already changed current versions.

## Process and read documents

After the configuration reports success with verified current readiness, submit a supported document through the existing workflow. Poll the accepted job and read the persisted result:

```bash
eai docs classify ./minutes.pdf --tenant-id <workspace-id> --storage-target resourceapi --vertical-key consultant-app --workflow-key meeting-review --format json
eai docs job <job-id> --tenant-id <workspace-id> --wait --timeout 300 --format json
eai docs get <document-id> --job-id <job-id> --tenant-id <workspace-id> --storage-target resourceapi --format json
```

Acceptance is not completion. A job with failed stages or `completed_with_errors` returns nonzero. A wait timeout retains its job identity and does not re-upload. Read the full persisted record in `body` for recursive field values, observed evidence, warnings and analyzer/definition/operation provenance; the compact job summary is not the complete result. `Other` is reserved for the existing manual review target and has no analyzer leaf.
