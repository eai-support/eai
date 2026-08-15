/**
 * eai classifier — author, publish, and manage tenant workflow document classifiers.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { PlatformAPIClient, parseApiError } from "../lib/api.js";
import { normalizeFormat, resolveCommandContext } from "../lib/context.js";
import * as out from "../lib/output.js";
import { isRecord } from "../lib/utils.js";

const CLASSIFIER_OBJECT_TYPE = "shared-document-classifier";

interface ClassifierCommandOptions {
  tenantId?: string;
  file?: string;
  format?: string;
  json?: boolean;
}

interface ClassifierTargetOptions extends ClassifierCommandOptions {
  app: string;
  workflow: string;
  version?: string;
}

interface ClassifierDeleteOptions extends ClassifierCommandOptions {
  confirm?: string;
}

interface ClassifierLabel {
  key: string;
  displayName: string;
  description: string;
  documentTypeKey: string;
}

interface ClassifierDraft {
  tenantId?: string;
  classifierKey: string;
  displayName: string;
  description?: string;
  verticalKey?: string;
  workflowKey?: string;
  status?: "draft" | "published" | "disabled";
  definition: {
    labels: ClassifierLabel[];
    minimumConfidence?: number;
  };
  sourceMode?: "local" | "inherit" | "extend" | "fork";
  sourceTenantId?: string;
  sourceClassifierKey?: string;
  sourceVersion?: number;
  visibleToChildren?: boolean;
  publishedVersion?: number;
  publishedVersionId?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
}

interface ClassifierResource extends ClassifierDraft {
  id: string;
  version: number;
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function parseClassifierRecord(
  value: unknown,
  allowServerManagedFields: boolean,
): ClassifierDraft {
  if (!isRecord(value))
    throw new Error("Classifier file must contain a JSON object.");
  if (
    !allowServerManagedFields &&
    ["status", "publishedVersion", "publishedVersionId"].some(
      (field) => value[field] !== undefined,
    )
  ) {
    throw new Error(
      "Classifier files cannot set server-managed publication fields.",
    );
  }
  const classifierKey = requiredString(value, "classifierKey");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(classifierKey)) {
    throw new Error(
      "classifierKey may contain only letters, numbers, dot, underscore, and hyphen.",
    );
  }
  if (!isRecord(value.definition) || !Array.isArray(value.definition.labels)) {
    throw new Error("definition.labels must be an array.");
  }
  const sourceMode = value.sourceMode ?? "local";
  if (
    sourceMode !== "local" &&
    sourceMode !== "inherit" &&
    sourceMode !== "extend" &&
    sourceMode !== "fork"
  ) {
    throw new Error("sourceMode must be local, inherit, extend, or fork.");
  }
  const sourceTenantId = optionalString(value, "sourceTenantId");
  const sourceClassifierKey = optionalString(value, "sourceClassifierKey");
  const sourceVersion = value.sourceVersion;
  if (
    sourceVersion !== undefined &&
    (typeof sourceVersion !== "number" ||
      !Number.isInteger(sourceVersion) ||
      sourceVersion < 1)
  ) {
    throw new Error("sourceVersion must be a positive integer.");
  }
  const lineage = [sourceTenantId, sourceClassifierKey, sourceVersion];
  if (sourceMode === "local" && lineage.some((item) => item !== undefined)) {
    throw new Error("Local classifiers cannot declare parent lineage.");
  }
  if (sourceMode !== "local" && lineage.some((item) => item === undefined)) {
    throw new Error(
      "Inherited, extended, and forked classifiers require complete parent lineage.",
    );
  }
  const labels = value.definition.labels.map(
    (candidate, index): ClassifierLabel => {
      if (!isRecord(candidate))
        throw new Error(`definition.labels[${index}] must be an object.`);
      return {
        key: requiredString(candidate, "key"),
        displayName: requiredString(candidate, "displayName"),
        description: requiredString(candidate, "description"),
        documentTypeKey: requiredString(candidate, "documentTypeKey"),
      };
    },
  );
  if (labels.length < 1) {
    throw new Error("A classifier definition requires at least one label.");
  }
  if ((sourceMode === "local" || sourceMode === "fork") && labels.length < 2) {
    throw new Error(
      "Local and forked classifiers require at least two labels.",
    );
  }
  if (new Set(labels.map((label) => label.key)).size !== labels.length) {
    throw new Error("Classifier label keys must be unique.");
  }

  return {
    classifierKey,
    displayName: requiredString(value, "displayName"),
    description:
      typeof value.description === "string"
        ? value.description.trim() || undefined
        : undefined,
    verticalKey: optionalString(value, "verticalKey"),
    workflowKey: optionalString(value, "workflowKey"),
    status:
      allowServerManagedFields &&
      (value.status === "published" || value.status === "disabled")
        ? value.status
        : "draft",
    definition: {
      labels,
      minimumConfidence:
        typeof value.definition.minimumConfidence === "number"
          ? value.definition.minimumConfidence
          : undefined,
    },
    sourceMode,
    sourceTenantId,
    sourceClassifierKey,
    sourceVersion,
    visibleToChildren: value.visibleToChildren !== false,
    publishedVersion:
      allowServerManagedFields && typeof value.publishedVersion === "number"
        ? value.publishedVersion
        : undefined,
    publishedVersionId:
      allowServerManagedFields && typeof value.publishedVersionId === "string"
        ? value.publishedVersionId
        : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

/** Validates an untrusted authoring file before any tenant-scoped classifier mutation is attempted. */
export function parseClassifierDraft(value: unknown): ClassifierDraft {
  return parseClassifierRecord(value, false);
}

async function requireJson(
  response: Response,
  operation: string,
): Promise<unknown> {
  if (!response.ok) {
    const error = await parseApiError(response);
    throw new Error(`${operation} failed: ${error.status} ${error.message}`);
  }
  return response.json();
}

function classifierResources(payload: unknown): ClassifierResource[] {
  if (!isRecord(payload)) return [];
  const rows = Array.isArray(payload.docs)
    ? payload.docs
    : Array.isArray(payload.items)
      ? payload.items
      : [];
  return rows.flatMap((row) => {
    if (
      !isRecord(row) ||
      !isRecord(row.data) ||
      typeof row.id !== "string" ||
      typeof row.version !== "number"
    ) {
      return [];
    }
    try {
      return [
        {
          ...parseClassifierRecord(row.data, true),
          id: row.id,
          version: row.version,
        },
      ];
    } catch {
      return [];
    }
  });
}

async function findClassifier(
  client: PlatformAPIClient,
  classifierKey: string,
): Promise<ClassifierResource | undefined> {
  const response = await client.listResources(CLASSIFIER_OBJECT_TYPE, {
    limit: 2,
    where: { classifierKey },
  });
  const rows = classifierResources(
    await requireJson(response, "Classifier lookup"),
  );
  if (rows.length > 1)
    throw new Error(`Multiple classifier drafts found for ${classifierKey}.`);
  return rows[0];
}

function printResult(format: string, value: unknown, summary: string): void {
  if (format === "json") out.json(value);
  else out.success(summary);
}

async function saveClassifier(
  options: ClassifierCommandOptions,
): Promise<void> {
  if (!options.file) throw new Error("--file is required.");
  const format = normalizeFormat(options);
  const draft = parseClassifierDraft(
    JSON.parse(await readFile(options.file, "utf8")),
  );
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const existing = await findClassifier(context.client, draft.classifierKey);
  if (existing?.status === "disabled") {
    throw new Error(
      `Enable classifier ${draft.classifierKey} before editing it.`,
    );
  }
  const data: Record<string, unknown> = {
    ...draft,
    ...(existing
      ? {
          publishedVersion: existing.publishedVersion,
          publishedVersionId: existing.publishedVersionId,
        }
      : {}),
    tenantId: context.tenantId,
    updatedAt: new Date().toISOString(),
  };
  const response = existing
    ? await context.client.updateResource(
        CLASSIFIER_OBJECT_TYPE,
        existing.id,
        data,
        existing.version,
      )
    : await context.client.createResource(CLASSIFIER_OBJECT_TYPE, data);
  const saved = await requireJson(response, "Classifier save");
  printResult(format, saved, `Saved classifier draft ${draft.classifierKey}`);
}

async function listClassifiers(
  options: ClassifierCommandOptions,
): Promise<void> {
  const format = normalizeFormat(options);
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const payload = await requireJson(
    await context.client.listResources(CLASSIFIER_OBJECT_TYPE, {
      limit: 100,
      sort: "displayName",
    }),
    "Classifier list",
  );
  const rows = classifierResources(payload);
  if (format === "json") {
    out.json(rows);
    return;
  }
  if (rows.length === 0) {
    out.info("No tenant classifier drafts found.");
    return;
  }
  for (const classifier of rows) {
    const details: [string, string][] = [
      ["Classifier", classifier.classifierKey],
      [
        "Status",
        `${classifier.status ?? "draft"}${classifier.publishedVersion ? ` v${classifier.publishedVersion}` : ""}`,
      ],
      ["Labels", String(classifier.definition.labels.length)],
    ];
    out.table(details);
    out.blank();
  }
}

async function publishClassifier(
  classifierKey: string,
  options: ClassifierCommandOptions,
): Promise<void> {
  const format = normalizeFormat(options);
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const draft = await findClassifier(context.client, classifierKey);
  if (!draft)
    throw new Error(`Classifier draft ${classifierKey} was not found.`);
  if (draft.status === "disabled") {
    throw new Error(`Enable classifier ${classifierKey} before publishing it.`);
  }
  const nextVersion = (draft.publishedVersion ?? 0) + 1;
  const response = await context.client.requestPublicApi(
    `/v4/data/documents/content-understanding/classifiers/${encodeURIComponent(classifierKey)}/publish`,
    {
      method: "POST",
      body: {
        tenantId: context.tenantId,
        classifierKey: draft.classifierKey,
        version: nextVersion,
        displayName: draft.displayName,
        description: draft.description,
        definition: draft.definition,
        sourceMode: draft.sourceMode ?? "local",
        sourceTenantId: draft.sourceTenantId,
        sourceClassifierKey: draft.sourceClassifierKey,
        sourceVersion: draft.sourceVersion,
      },
    },
  );
  const published = await requireJson(response, "Classifier publish");
  if (
    !isRecord(published) ||
    typeof published.version !== "number" ||
    typeof published.versionId !== "string"
  ) {
    throw new Error("Classifier publish returned an invalid response.");
  }
  printResult(
    format,
    published,
    `Published classifier ${classifierKey} version ${published.version}`,
  );
}

async function targetClassifier(
  classifierKey: string,
  options: ClassifierTargetOptions,
): Promise<void> {
  const format = normalizeFormat(options);
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const draft = await findClassifier(context.client, classifierKey);
  if (!draft) {
    throw new Error(`Classifier draft ${classifierKey} was not found.`);
  }
  if (draft.status === "disabled") {
    throw new Error(
      `Enable classifier ${classifierKey} before associating a target.`,
    );
  }
  const requestedVersion = options.version
    ? Number.parseInt(options.version, 10)
    : draft.publishedVersion;
  if (!requestedVersion || requestedVersion < 1) {
    throw new Error(
      `Classifier ${classifierKey} must be published before it can be targeted.`,
    );
  }
  const verticalKey = options.app.trim();
  const workflowKey = options.workflow.trim();
  if (!verticalKey || !workflowKey) {
    throw new Error("--app and --workflow are required.");
  }
  const response = await context.client.requestPublicApi(
    `/v4/data/documents/content-understanding/classifiers/${encodeURIComponent(classifierKey)}/targets`,
    {
      method: "POST",
      body: {
        tenantId: context.tenantId,
        classifierKey,
        classifierVersion: requestedVersion,
        verticalKey,
        workflowKey,
      },
    },
  );
  const targeted = await requireJson(response, "Classifier target association");
  printResult(
    format,
    targeted,
    `Associated classifier ${classifierKey} version ${requestedVersion} with ${verticalKey}/${workflowKey}`,
  );
}

async function changeClassifierLifecycle(
  classifierKey: string,
  operation: "disable" | "enable",
  options: ClassifierCommandOptions,
): Promise<void> {
  const format = normalizeFormat(options);
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const draft = await findClassifier(context.client, classifierKey);
  if (!draft) {
    throw new Error(`Classifier draft ${classifierKey} was not found.`);
  }
  const response = await context.client.requestPublicApi(
    `/v4/data/documents/content-understanding/classifiers/${encodeURIComponent(classifierKey)}/${operation}`,
    {
      method: "POST",
      body: {
        tenantId: context.tenantId,
        expectedVersion: draft.version,
      },
    },
  );
  const result = await requireJson(response, `Classifier ${operation}`);
  printResult(
    format,
    result,
    `${operation === "disable" ? "Disabled" : "Enabled"} classifier ${classifierKey}`,
  );
}

async function disableClassifier(
  classifierKey: string,
  options: ClassifierCommandOptions,
): Promise<void> {
  await changeClassifierLifecycle(classifierKey, "disable", options);
}

async function enableClassifier(
  classifierKey: string,
  options: ClassifierCommandOptions,
): Promise<void> {
  await changeClassifierLifecycle(classifierKey, "enable", options);
}

async function deleteClassifier(
  classifierKey: string,
  options: ClassifierDeleteOptions,
): Promise<void> {
  if (options.confirm !== classifierKey) {
    throw new Error(`--confirm must exactly match ${classifierKey}.`);
  }
  const format = normalizeFormat(options);
  const context = await resolveCommandContext({ tenantId: options.tenantId });
  const draft = await findClassifier(context.client, classifierKey);
  if (!draft) {
    throw new Error(`Classifier draft ${classifierKey} was not found.`);
  }
  if (draft.status !== "disabled") {
    throw new Error(`Disable classifier ${classifierKey} before deleting it.`);
  }
  if (draft.publishedVersion) {
    throw new Error(
      `Classifier ${classifierKey} has immutable publication history and cannot be deleted. Leave it disabled instead.`,
    );
  }
  const response = await context.client.requestPublicApi(
    `/v4/data/documents/content-understanding/classifiers/${encodeURIComponent(classifierKey)}`,
    {
      method: "DELETE",
      body: {
        tenantId: context.tenantId,
        expectedVersion: draft.version,
        confirmation: classifierKey,
      },
    },
  );
  const result = await requireJson(response, "Classifier delete");
  printResult(format, result, `Deleted classifier ${classifierKey}`);
}

export const classifierCommand = new Command("classifier")
  .description(
    "Create, inspect, publish, target, disable, enable, and delete tenant document classifiers",
  )
  .addHelpText(
    "after",
    `
Examples:
  eai classifier save --file classifier.json
  eai classifier list --format json
  eai classifier publish compliance-documents
  eai classifier target compliance-documents --app mysnm --workflow compliance-review
  eai classifier disable compliance-documents
  eai classifier enable compliance-documents
  eai classifier delete compliance-documents --confirm compliance-documents
`,
  );

classifierCommand
  .command("save")
  .description("Create or update a provider-neutral classifier draft from JSON")
  .requiredOption("--file <path>", "Classifier draft JSON file")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(saveClassifier);

classifierCommand
  .command("list")
  .description("List classifier drafts for the active tenant")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(listClassifiers);

classifierCommand
  .command("publish <classifier-key>")
  .description("Publish the next immutable reusable classifier version")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(publishClassifier);

classifierCommand
  .command("target <classifier-key>")
  .description("Associate a published classifier version with an app workflow")
  .requiredOption("--app <app-key>", "Target app key")
  .requiredOption("--workflow <workflow-key>", "Target workflow key")
  .option(
    "--version <number>",
    "Published version (defaults to the draft pointer)",
  )
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(targetClassifier);

classifierCommand
  .command("disable <classifier-key>")
  .description("Reversibly block publication, targets, and runtime use")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(disableClassifier);

classifierCommand
  .command("enable <classifier-key>")
  .description("Re-enable a disabled classifier")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(enableClassifier);

classifierCommand
  .command("delete <classifier-key>")
  .description(
    "Permanently delete a disabled classifier draft that was never published",
  )
  .requiredOption(
    "--confirm <classifier-key>",
    "Exact classifier key required for permanent deletion",
  )
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(deleteClassifier);
