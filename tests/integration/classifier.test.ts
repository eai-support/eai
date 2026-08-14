import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/lib/context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/context.js")>();
  return { ...actual, resolveCommandContext: vi.fn() };
});

import {
  classifierCommand,
  parseClassifierDraft,
} from "../../src/commands/classifier.js";
import { resolveCommandContext } from "../../src/lib/context.js";

const draft = {
  classifierKey: "compliance",
  displayName: "Compliance documents",
  description: "Classifies compliance inputs",
  definition: {
    labels: [
      {
        key: "policy",
        displayName: "Policy",
        description: "A company policy",
        documentTypeKey: "policy",
      },
      {
        key: "procedure",
        displayName: "Procedure",
        description: "A company procedure",
        documentTypeKey: "procedure",
      },
    ],
  },
  sourceMode: "local" as const,
  visibleToChildren: true,
};

describe("eai classifier", () => {
  const listResources = vi.fn();
  const createResource = vi.fn();
  const requestPublicApi = vi.fn();
  const updateResource = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCommandContext).mockResolvedValue({
      tenantId: "tenant-1",
      client: {
        listResources,
        createResource,
        requestPublicApi,
        updateResource,
      },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("validates portable definitions before provider publication", () => {
    expect(parseClassifierDraft(draft)).toEqual(
      expect.objectContaining({
        classifierKey: "compliance",
        sourceMode: "local",
        visibleToChildren: true,
      }),
    );
    expect(() =>
      parseClassifierDraft({
        ...draft,
        definition: { labels: [draft.definition.labels[0]] },
      }),
    ).toThrow("at least two labels");
  });

  test("rejects server-managed publication fields in authoring files", () => {
    for (const serverFields of [
      { status: "published" },
      { publishedVersion: 99 },
      { publishedVersionId: "forged-version-id" },
    ]) {
      expect(() => parseClassifierDraft({ ...draft, ...serverFields })).toThrow(
        "cannot set server-managed publication fields",
      );
    }
  });

  test("matches PublicAPI source-mode lineage and label cardinality", () => {
    const oneLabelDefinition = { labels: [draft.definition.labels[0]] };
    const parentLineage = {
      sourceTenantId: "parent-tenant",
      sourceClassifierKey: "parent-compliance",
      sourceVersion: 2,
    };

    expect(parseClassifierDraft(draft).sourceMode).toBe("local");
    expect(() => parseClassifierDraft({ ...draft, ...parentLineage })).toThrow(
      "cannot declare parent lineage",
    );

    expect(
      parseClassifierDraft({
        ...draft,
        sourceMode: "inherit",
        ...parentLineage,
        definition: oneLabelDefinition,
      }),
    ).toEqual(
      expect.objectContaining({ sourceMode: "inherit", ...parentLineage }),
    );

    expect(
      parseClassifierDraft({
        ...draft,
        sourceMode: "extend",
        ...parentLineage,
        definition: oneLabelDefinition,
      }),
    ).toEqual(
      expect.objectContaining({ sourceMode: "extend", ...parentLineage }),
    );

    expect(
      parseClassifierDraft({ ...draft, sourceMode: "fork", ...parentLineage }),
    ).toEqual(
      expect.objectContaining({ sourceMode: "fork", ...parentLineage }),
    );
    expect(() =>
      parseClassifierDraft({
        ...draft,
        sourceMode: "fork",
        ...parentLineage,
        definition: oneLabelDefinition,
      }),
    ).toThrow("forked classifiers require at least two labels");
  });

  test("allows unique classifier labels to share a stable document type", () => {
    const parsed = parseClassifierDraft({
      ...draft,
      definition: {
        labels: [
          draft.definition.labels[0],
          {
            ...draft.definition.labels[1],
            documentTypeKey: draft.definition.labels[0].documentTypeKey,
          },
        ],
      },
    });

    expect(
      parsed.definition.labels.map((label) => label.documentTypeKey),
    ).toEqual(["policy", "policy"]);
    expect(() =>
      parseClassifierDraft({
        ...draft,
        definition: {
          labels: [
            draft.definition.labels[0],
            {
              ...draft.definition.labels[1],
              key: draft.definition.labels[0].key,
            },
          ],
        },
      }),
    ).toThrow("Classifier label keys must be unique");
  });

  test("rejects missing, partial, and malformed parent lineage", () => {
    expect(() =>
      parseClassifierDraft({ ...draft, sourceMode: "inherit" }),
    ).toThrow("require complete parent lineage");
    expect(() =>
      parseClassifierDraft({
        ...draft,
        sourceMode: "extend",
        sourceTenantId: "parent-tenant",
        sourceClassifierKey: "parent-compliance",
      }),
    ).toThrow("require complete parent lineage");
    expect(() =>
      parseClassifierDraft({
        ...draft,
        sourceMode: "fork",
        sourceTenantId: "parent-tenant",
        sourceClassifierKey: "parent-compliance",
        sourceVersion: 0,
      }),
    ).toThrow("sourceVersion must be a positive integer");
  });

  test("saves a validated tenant-owned draft from JSON", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "eai-classifier-"));
    const draftPath = join(tempDirectory, "classifier.json");
    await writeFile(draftPath, JSON.stringify(draft), "utf8");
    listResources.mockResolvedValue(
      new Response(JSON.stringify({ docs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    createResource.mockResolvedValue(
      new Response(JSON.stringify({ id: "draft-id", version: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await classifierCommand.parseAsync([
        "node",
        "classifier",
        "save",
        "--file",
        draftPath,
        "--format",
        "json",
      ]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }

    expect(createResource).toHaveBeenCalledWith(
      "shared-document-classifier",
      expect.objectContaining({
        tenantId: "tenant-1",
        classifierKey: "compliance",
        status: "draft",
      }),
    );
  });

  test("lists only valid classifier draft records for the active tenant", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [{ id: "draft-id", version: 1, data: draft }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await classifierCommand.parseAsync([
      "node",
      "classifier",
      "list",
      "--format",
      "json",
    ]);

    expect(listResources).toHaveBeenCalledWith("shared-document-classifier", {
      limit: 100,
      sort: "displayName",
    });
  });

  test("preserves the immutable publication pointer when saving revised draft content", async () => {
    const tempDirectory = await mkdtemp(
      join(tmpdir(), "eai-classifier-revision-"),
    );
    const draftPath = join(tempDirectory, "classifier.json");
    await writeFile(draftPath, JSON.stringify(draft), "utf8");
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 4,
              data: {
                ...draft,
                status: "published",
                publishedVersion: 2,
                publishedVersionId: "version-v2-id",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    updateResource.mockResolvedValue(
      new Response(JSON.stringify({ id: "draft-id", version: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await classifierCommand.parseAsync([
        "node",
        "classifier",
        "save",
        "--file",
        draftPath,
        "--format",
        "json",
      ]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }

    expect(updateResource).toHaveBeenCalledWith(
      "shared-document-classifier",
      "draft-id",
      expect.objectContaining({
        status: "draft",
        publishedVersion: 2,
        publishedVersionId: "version-v2-id",
      }),
      4,
    );
  });

  test("publishes the next immutable version and updates the draft pointer", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 4,
              data: { ...draft, publishedVersion: 2 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    requestPublicApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          classifierKey: "compliance",
          version: 3,
          versionId: "version-id",
          materializationId: "materialization-id",
          provider: "azure-content-understanding",
          providerAnalyzerId: "Classifier_opaque_compliance_v3",
          definitionDigest: "a".repeat(64),
          status: "published",
          workflowConfigKey: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    updateResource.mockResolvedValue(
      new Response(JSON.stringify({ id: "draft-id", version: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await classifierCommand.parseAsync([
      "node",
      "classifier",
      "publish",
      "compliance",
      "--format",
      "json",
    ]);

    expect(requestPublicApi).toHaveBeenCalledWith(
      "/v4/data/documents/content-understanding/classifiers/compliance/publish",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          tenantId: "tenant-1",
          version: 3,
        }),
      }),
    );
    expect(requestPublicApi.mock.calls[0]?.[1]?.body).not.toHaveProperty(
      "verticalKey",
    );
    expect(requestPublicApi.mock.calls[0]?.[1]?.body).not.toHaveProperty(
      "workflowKey",
    );
    expect(updateResource).not.toHaveBeenCalled();
  });

  test("associates an exact published version with an app workflow", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 4,
              data: { ...draft, publishedVersion: 3 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    requestPublicApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          classifierKey: "compliance",
          classifierVersion: 3,
          verticalKey: "mysnm",
          workflowKey: "compliance-review",
          workflowConfigKey: "document-classifier:compliance-review",
          status: "associated",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await classifierCommand.parseAsync([
      "node",
      "classifier",
      "target",
      "compliance",
      "--app",
      "mysnm",
      "--workflow",
      "compliance-review",
      "--format",
      "json",
    ]);

    expect(requestPublicApi).toHaveBeenCalledWith(
      "/v4/data/documents/content-understanding/classifiers/compliance/targets",
      {
        method: "POST",
        body: {
          tenantId: "tenant-1",
          classifierKey: "compliance",
          classifierVersion: 3,
          verticalKey: "mysnm",
          workflowKey: "compliance-review",
        },
      },
    );
  });

  test.each([
    ["disable", "disabled"],
    ["enable", "published"],
  ])(
    "HP001 CLASSIFIER-LIFECYCLE-001: %ss a classifier with its exact mutable version",
    async (operation, status) => {
      listResources.mockResolvedValue(
        new Response(
          JSON.stringify({
            docs: [
              {
                id: "draft-id",
                version: 7,
                data: {
                  ...draft,
                  status: operation === "enable" ? "disabled" : "published",
                  publishedVersion: 3,
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      requestPublicApi.mockResolvedValue(
        new Response(
          JSON.stringify({
            classifierKey: "compliance",
            status,
            affectedTargets: operation === "disable" ? 2 : 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await classifierCommand.parseAsync([
        "node",
        "classifier",
        operation,
        "compliance",
        "--format",
        "json",
      ]);

      expect(requestPublicApi).toHaveBeenCalledWith(
        `/v4/data/documents/content-understanding/classifiers/compliance/${operation}`,
        {
          method: "POST",
          body: { tenantId: "tenant-1", expectedVersion: 7 },
        },
      );
    },
  );

  test("HP002 CLASSIFIER-LIFECYCLE-001: deletes a disabled unpublished draft only after exact confirmation", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 8,
              data: { ...draft, status: "disabled" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    requestPublicApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          classifierKey: "compliance",
          status: "deleted",
          deleted: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await classifierCommand.parseAsync([
      "node",
      "classifier",
      "delete",
      "compliance",
      "--confirm",
      "compliance",
      "--format",
      "json",
    ]);

    expect(requestPublicApi).toHaveBeenCalledWith(
      "/v4/data/documents/content-understanding/classifiers/compliance",
      {
        method: "DELETE",
        body: {
          tenantId: "tenant-1",
          expectedVersion: 8,
          confirmation: "compliance",
        },
      },
    );
  });

  test("BP001 CLASSIFIER-LIFECYCLE-001: rejects mismatched delete confirmation before tenant or network access", async () => {
    await expect(
      classifierCommand.parseAsync([
        "node",
        "classifier",
        "delete",
        "compliance",
        "--confirm",
        "wrong-key",
      ]),
    ).rejects.toThrow("--confirm must exactly match compliance");

    expect(resolveCommandContext).not.toHaveBeenCalled();
    expect(listResources).not.toHaveBeenCalled();
    expect(requestPublicApi).not.toHaveBeenCalled();
  });

  test.each([
    [
      { ...draft, status: "published", publishedVersion: 2 },
      "Disable classifier compliance before deleting it",
    ],
    [
      { ...draft, status: "disabled", publishedVersion: 2 },
      "has immutable publication history and cannot be deleted",
    ],
  ])(
    "BP002 CLASSIFIER-LIFECYCLE-001: refuses unsafe permanent deletion",
    async (storedDraft, expectedMessage) => {
      listResources.mockResolvedValue(
        new Response(
          JSON.stringify({
            docs: [{ id: "draft-id", version: 8, data: storedDraft }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      await expect(
        classifierCommand.parseAsync([
          "node",
          "classifier",
          "delete",
          "compliance",
          "--confirm",
          "compliance",
        ]),
      ).rejects.toThrow(expectedMessage);
      expect(requestPublicApi).not.toHaveBeenCalled();
    },
  );

  test(
    "BP003 CLASSIFIER-LIFECYCLE-001: save refuses to overwrite an existing disabled classifier",
    async () => {
      const tempDirectory = await mkdtemp(
        join(tmpdir(), "eai-classifier-locked-"),
      );
      const draftPath = join(tempDirectory, "classifier.json");
      await writeFile(draftPath, JSON.stringify(draft), "utf8");
      listResources.mockResolvedValue(
        new Response(
          JSON.stringify({
            docs: [
              {
                id: "draft-id",
                version: 8,
                data: { ...draft, status: "disabled" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      try {
        await expect(
          classifierCommand.parseAsync([
            "node",
            "classifier",
            "save",
            "--file",
            draftPath,
          ]),
        ).rejects.toThrow(/Enable classifier/);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
      expect(updateResource).not.toHaveBeenCalled();
    },
  );

  test("BP004 CLASSIFIER-LIFECYCLE-001: targeting refuses a disabled classifier before any runtime request", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 8,
              data: {
                ...draft,
                status: "disabled",
                publishedVersion: 3,
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      classifierCommand.parseAsync([
        "node",
        "classifier",
        "target",
        "compliance",
        "--app",
        "mysnm",
        "--workflow",
        "compliance-review",
      ]),
    ).rejects.toThrow(
      "Enable classifier compliance before associating a target",
    );
    expect(requestPublicApi).not.toHaveBeenCalled();
  });

  test("BP004 CLASSIFIER-LIFECYCLE-001: renders lifecycle validation failures without rejected values or server detail", async () => {
    listResources.mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: "draft-id",
              version: 7,
              data: { ...draft, status: "published", publishedVersion: 3 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    requestPublicApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "expectedVersion rejected; secret=do-not-print",
          invalidFields: [
            {
              path: "body.expectedVersion",
              message: "secret=do-not-print",
              value: "do-not-print",
            },
          ],
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );

    let failure: Error | undefined;
    try {
      await classifierCommand.parseAsync([
        "node",
        "classifier",
        "disable",
        "compliance",
      ]);
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain("body.expectedVersion");
    expect(failure?.message).not.toContain("do-not-print");
    expect(failure?.message).not.toContain("secret");
  });
});
