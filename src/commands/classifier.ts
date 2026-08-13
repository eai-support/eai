/**
 * eai classifier — author and publish tenant workflow document classifiers.
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
  verticalKey: string;
  workflowKey: string;
  status?: "draft" | "published" | "disabled";
  definition: {
    labels: ClassifierLabel[];
    instructions?: string;
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

/** Validates an untrusted JSON file before any tenant-scoped classifier mutation is attempted. */
export function parseClassifierDraft(value: unknown): ClassifierDraft {
  if (!isRecord(value))
    throw new Error("Classifier file must contain a JSON object.");
  const classifierKey = requiredString(value, "classifierKey");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(classifierKey)) {
    throw new Error(
      "classifierKey may contain only letters, numbers, dot, underscore, and hyphen.",
    );
  }
  if (!isRecord(value.definition) || !Array.isArray(value.definition.labels)) {
    throw new Error("definition.labels must be an array.");
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
  if (labels.length < 2)
    throw new Error("A classifier requires at least two labels.");
  if (new Set(labels.map((label) => label.key)).size !== labels.length) {
    throw new Error("Classifier label keys must be unique.");
  }
  if (
    new Set(labels.map((label) => label.documentTypeKey)).size !== labels.length
  ) {
    throw new Error("Classifier documentTypeKey values must be unique.");
  }

  return {
    classifierKey,
    displayName: requiredString(value, "displayName"),
    description:
      typeof value.description === "string"
        ? value.description.trim() || undefined
        : undefined,
    verticalKey: requiredString(value, "verticalKey"),
    workflowKey: requiredString(value, "workflowKey"),
    status:
      value.status === "published" || value.status === "disabled"
        ? value.status
        : "draft",
    definition: {
      labels,
      instructions:
        typeof value.definition.instructions === "string"
          ? value.definition.instructions.trim() || undefined
          : undefined,
      minimumConfidence:
        typeof value.definition.minimumConfidence === "number"
          ? value.definition.minimumConfidence
          : undefined,
    },
    sourceMode:
      value.sourceMode === "inherit" ||
      value.sourceMode === "extend" ||
      value.sourceMode === "fork"
        ? value.sourceMode
        : "local",
    sourceTenantId:
      typeof value.sourceTenantId === "string"
        ? value.sourceTenantId
        : undefined,
    sourceClassifierKey:
      typeof value.sourceClassifierKey === "string"
        ? value.sourceClassifierKey
        : undefined,
    sourceVersion:
      typeof value.sourceVersion === "number" ? value.sourceVersion : undefined,
    visibleToChildren: value.visibleToChildren !== false,
    publishedVersion:
      typeof value.publishedVersion === "number"
        ? value.publishedVersion
        : undefined,
    publishedVersionId:
      typeof value.publishedVersionId === "string"
        ? value.publishedVersionId
        : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
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
        { ...parseClassifierDraft(row.data), id: row.id, version: row.version },
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
  const data: Record<string, unknown> = {
    ...draft,
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
    out.table([
      ["Classifier", classifier.classifierKey],
      ["Workflow", `${classifier.verticalKey}/${classifier.workflowKey}`],
      [
        "Status",
        `${classifier.status ?? "draft"}${classifier.publishedVersion ? ` v${classifier.publishedVersion}` : ""}`,
      ],
      ["Labels", String(classifier.definition.labels.length)],
    ]);
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
        verticalKey: draft.verticalKey,
        workflowKey: draft.workflowKey,
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
  await requireJson(
    await context.client.updateResource(
      CLASSIFIER_OBJECT_TYPE,
      draft.id,
      {
        ...draft,
        tenantId: context.tenantId,
        status: "published",
        publishedVersion: published.version,
        publishedVersionId: published.versionId,
        updatedAt: new Date().toISOString(),
      },
      draft.version,
    ),
    "Classifier draft publication pointer update",
  );
  printResult(
    format,
    published,
    `Published classifier ${classifierKey} version ${published.version}`,
  );
}

export const classifierCommand = new Command("classifier")
  .description(
    "Create, inspect, and publish tenant workflow document classifiers",
  )
  .addHelpText(
    "after",
    `
Examples:
  eai classifier save --file classifier.json
  eai classifier list --format json
  eai classifier publish compliance-documents
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
  .description("Publish the next immutable version and bind it to its workflow")
  .option("--tenant-id <id>", "Target tenant ID")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Shortcut for --format json")
  .action(publishClassifier);
