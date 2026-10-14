---
title: Content Understanding
description: Configure bounded document analyzers from your own harness and read completed document results.
---

# Content Understanding

## October launch: document fields and background processing

The October 15 scope uses the existing Admin Portal document workflow. A consultant's harness can turn a request such as “classify quotations, extract the supplier and total, and write a short summary” into a bounded JSON file. `eai docs configure-type` creates the tenant-owned leaf analyzer, verifies its exact fields and readback digest, then syncs the matching runtime document rules. The workspace UUID in the file and `--tenant-id` must use lowercase canonical hex. It accepts 1–32 scalar fields (`string`, `integer`, `number`, `boolean`, `date`, or `time`) with `extract` or `generate` methods. Document codes use only letters, numbers and underscores so distinct codes cannot collapse to one Admin Portal analyzer ID. Azure normalizes an `integer` analyzer field to `number` while the runtime rule stays `INTEGER`. The command does not accept figures, tables, nested fields, Azure credentials, or provider URLs.

Run inside an initialized EAI project and select the intended profile explicitly. For DEV:

```json
{
  "kind": "eai.document-type.configuration",
  "schemaVersion": 1,
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "code": "Quotation",
  "name": "Quotation",
  "description": "Supplier quotation",
  "fields": [
    { "name": "supplierName", "description": "Supplier organisation", "type": "string", "method": "extract" },
    { "name": "totalAmount", "description": "Total amount including tax", "type": "number", "method": "extract" },
    { "name": "summary", "description": "One-sentence summary", "type": "string", "method": "generate" }
  ]
}
```

```bash
eai --profile dev docs configure-type --file quotation.json --tenant-id <workspace-id> --format json
eai --profile dev classifier save --file classifier.json --tenant-id <workspace-id> --format json
eai --profile dev classifier publish <classifier-key> --tenant-id <workspace-id> --format json
eai --profile dev classifier target <classifier-key> --app <app-key> --workflow <workflow-key> --document-lifecycle business-document-v1 --tenant-id <workspace-id> --format json
eai --profile dev docs classify ./quotation.pdf --storage-target resourceapi --vertical-key <app-key> --workflow-key <workflow-key> --tenant-id <workspace-id> --format json
eai --profile dev docs job <job-id> --tenant-id <workspace-id> --wait --format json
eai --profile dev docs get <document-id> --job-id <job-id> --tenant-id <workspace-id> --format json
```

The classifier's `documentTypeKey` must match the configuration `code`. The app and workflow must already be provisioned and entitled, and the business-document object types published before upload. A queued job is only acceptance; inspect the completed job and persisted field values. If `configure-type` reports a partial `runtime-sync` failure, retain the same file and inspect that phase before retrying. No automatic rollback or document re-upload is implied.

The broader typed CU v2 mode below is a separate, gated capability and is not part of the October 15 launch. Its flags should remain off until its own provider and document-processing qualification passes.

## Typed configuration after qualification

Your harness authors a JSON manifest. The CLI validates it locally, reads the selected workspace's capabilities, obtains a plan, and submits that unchanged plan through the platform. The platform owns Azure credentials, approved models, analyzer ownership, publication and activation. No Azure key or resource URL belongs in the manifest.

This mode supports typed document fields and one flat workflow classifier. It requires administrator permission and an enabled, ready workspace. Installed commands do not establish that the workspace has the capability. Nested classifiers, segmentation, audio/video, arbitrary model deployments and resource provisioning are unavailable in this mode; unsupported settings fail before any configuration writes.

These typed commands are installed in CLI v3.20.2, but remain disabled on DEV pending separate qualification. Installed commands do not establish readiness. Check the current package and workspace capabilities before planning.

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

Missing login returns `E101`; an expired or rejected session returns `E102`.
A saved login that differs from the selected authentication configuration returns
`E104` with a safe re-login instruction, without exposing stored authority or
client values. These errors retain only a valid caller-supplied operation ID.

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

Acceptance is not completion. A job with failed stages or `completed_with_errors` returns nonzero. A wait timeout retains its job identity and does not re-upload. `docs get` returns nonzero for incomplete or failed processing while retaining the raw record in `body`; successful processing requires `complete` or `completed` in the record and any supplied machine analysis. Read that full persisted record for recursive field values, observed evidence, warnings and analyzer/definition/operation provenance; the compact job summary is not the complete result. `Other` is reserved for the existing manual review target and has no analyzer leaf.
