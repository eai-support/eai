import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  verticalKey: "mysnm",
  workflowKey: "compliance-review",
  status: "draft" as const,
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
  const requestPublicApi = vi.fn();
  const updateResource = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCommandContext).mockResolvedValue({
      tenantId: "tenant-1",
      client: {
        listResources,
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
          workflowConfigKey: "document-classifier:compliance-review",
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
          verticalKey: "mysnm",
          workflowKey: "compliance-review",
        }),
      }),
    );
    expect(updateResource).toHaveBeenCalledWith(
      "shared-document-classifier",
      "draft-id",
      expect.objectContaining({
        status: "published",
        publishedVersion: 3,
        publishedVersionId: "version-id",
      }),
      4,
    );
  });
});
