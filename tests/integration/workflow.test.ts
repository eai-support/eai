import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMockServer } from "../helpers/mock-server.js";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "../helpers/test-env.js";
import { clearTokens, storeTokens } from "../../src/lib/auth.js";
import {
  DEFAULT_PROD_AUTH_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  DEFAULT_PROD_AUTH_TENANT_NAME,
} from "../../src/lib/profile.js";
import { workflowCommand } from "../../src/commands/workflow.js";
import {
  buildWorkflowAiRuntimeBindingPayloads,
  buildWorkflowProvisionPayloads,
  parseEnvMapping,
  parseStagePrompt,
  parseStageSpec,
  SHARED_ASSET_ADOPTION_OBJECT_TYPE,
  SHARED_ASSET_DISPOSITION_OBJECT_TYPE,
  validateStageEnvMappings,
  validateStagePromptMappings,
} from "../../src/lib/workflow-provisioning.js";

const API_BASE = "https://test-api.example.com";

function setTestHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

async function setupProject(dir: string): Promise<void> {
  await mkdir(join(dir, "src", "eai.config"), { recursive: true });
  await writeFile(
    join(dir, "src", "eai.config", "object-types.ts"),
    "export const objectTypes = {};\n",
  );
  await writeFile(
    join(dir, ".env.local"),
    `BASE_URL_PUBLIC_API=${API_BASE}\nNEXT_PUBLIC_APP_NAME=my-app\n`,
  );
}

async function storeTestTokens(dir: string): Promise<void> {
  setTestHome(dir);
  await storeTokens({
    accessToken: "<fixture-access-token>",
    refreshToken: "<fixture-refresh-token>",
    expiresAt: Date.now() + 3600000,
    upn: "test@example.com",
    oid: "test-oid",
    tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
    tenantName: DEFAULT_PROD_AUTH_TENANT_NAME,
    clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
    activeTenantId: "test-tenant-id",
    activeTenantName: "Test Tenant",
    activeTenantSlug: "test-tenant",
    publicApiUrl: API_BASE,
    membershipsCachedAt: Date.now(),
  });
}

describe("eai workflow", () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let originalCwd: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;

    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    process.env.EAI_ACCESS_TOKEN = "<fixture-access-token>";
    await storeTestTokens(env.dir);
    await setupProject(env.dir);
    process.chdir(env.dir);
  });

  test("exposes typed CRUD and logical app binding alongside provision/runtime commands", () => {
    expect(workflowCommand.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      "list",
      "show",
      "create",
      "update",
      "delete",
      "use",
      "provision",
      "readiness",
      "status",
      "request",
    ]));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    mockServer.stop();
    await clearTokens();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env.cleanup();
  });

  test(
    "status checks the public workflow status endpoint",
    { timeout: 10000 },
    async () => {
      let requestUrl = "";
      const outputSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      mockServer.server.use(
        http.get(
          `${API_BASE}/v4/workflows/runtime/strategy-monitor/status`,
          ({ request }) => {
            requestUrl = request.url;
            return HttpResponse.json({
              workflow_key: "strategy-monitor",
              tenant_id: "test-tenant-id",
              status: "operator_required",
              reason_code: "runtime_workflow_not_bound",
              reason_message: "Workflow is not bound.",
            });
          },
        ),
      );

      await workflowCommand.parseAsync(
        ["status", "strategy-monitor", "--format", "json"],
        { from: "user" },
      );

      expect(requestUrl).toContain("tenant_id=test-tenant-id");
      const output = outputSpy.mock.calls.flat().join("\n");
      expect(output).toContain('"workflowKey": "strategy-monitor"');
      expect(output).toContain('"status": "operator_required"');
    },
  );

  test(
    "readiness checks the public builder readiness endpoint",
    { timeout: 10000 },
    async () => {
      let requestUrl = "";
      const outputSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      mockServer.server.use(
        http.get(`${API_BASE}/v4/integrations/builder/readiness`, ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({
            tenant_id: "test-tenant-id",
            status: "operator_required",
            checks: [
              {
                key: "workflow:strategy-monitor",
                status: "operator_required",
                reason_code: "runtime_workflow_not_bound",
                reason_message: "Workflow is not bound.",
              },
            ],
          });
        }),
      );

      await workflowCommand.parseAsync(
        ["readiness", "strategy-monitor", "--format", "json"],
        { from: "user" },
      );

      expect(requestUrl).toContain("tenant_id=test-tenant-id");
      expect(requestUrl).toContain("workflow_keys=strategy-monitor");
      const output = outputSpy.mock.calls.flat().join("\n");
      expect(output).toContain('"tenantId": "test-tenant-id"');
      expect(output).toContain('"key": "workflow:strategy-monitor"');
    },
  );

  test(
    "request posts an operator-assisted workflow request",
    { timeout: 10000 },
    async () => {
      let requestBody: unknown;

      mockServer.server.use(
        http.post(
          `${API_BASE}/v4/workflows/runtime-requests`,
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({
              request_id: "rwf_123",
              workflow_key: "strategy-monitor",
              tenant_id: "test-tenant-id",
              status: "operator_required",
              reason_code: "runtime_workflow_operator_required",
              reason_message: "Operator required.",
            });
          },
        ),
      );

      await workflowCommand.parseAsync(
        [
          "request",
          "strategy-monitor",
          "--reason",
          "CEO strategy cockpit",
          "--format",
          "json",
        ],
        { from: "user" },
      );

      expect(requestBody).toEqual({
        tenant_id: "test-tenant-id",
        workflow_key: "strategy-monitor",
        reason: "CEO strategy cockpit",
      });
    },
  );

  test(
    "HP001 FL-WORKFLOW-001: provision creates shared workflow and vertical config records",
    { timeout: 10000 },
    async () => {
      const outputSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const lookupRequests: string[] = [];
      let sharedCreateBody: unknown;
      let verticalCreateBody: unknown;
      let capabilityBindingBody: unknown;

      mockServer.server.use(
        http.get(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/workflows/configurator`,
          ({ request }) => {
            lookupRequests.push(request.url);
            return HttpResponse.json({ detail: "workflow not found" }, { status: 404 });
          },
        ),
        http.get(
          `${API_BASE}/v4/data/resources/test-tenant-id/vertical-product-config`,
          () => {
            return HttpResponse.json({
              docs: [],
              totalDocs: 0,
              page: 1,
              totalPages: 0,
            });
          },
        ),
        http.post(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/workflows`,
          async ({ request }) => {
            sharedCreateBody = await request.json();
            return HttpResponse.json(
              { id: "workflow-record-1", key: "configurator", version: 1, data: {} },
              { status: 201 },
            );
          },
        ),
        http.put(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/apps/no-code-builder/capability-bindings`,
          async ({ request }) => {
            capabilityBindingBody = await request.json();
            return HttpResponse.json({ tenantId: "test-tenant-id", appKey: "no-code-builder", bindings: [] });
          },
        ),
        http.post(
          `${API_BASE}/v4/data/resources/test-tenant-id/vertical-product-config`,
          async ({ request }) => {
            verticalCreateBody = await request.json();
            return HttpResponse.json(
              { id: "vertical-config-1" },
              { status: 201 },
            );
          },
        ),
      );

      await workflowCommand.parseAsync(
        [
          "provision",
          "configurator",
          "--app",
          "no-code-builder",
          "--display-name",
          "Workflow Configurator",
          "--workflow-env-key",
          "NEXT_PUBLIC_WORKFLOW_CONFIGURATOR_ID",
          "--stage",
          "analyze-process:Analyze process",
          "--stage",
          "generate-workflow:Generate workflow",
          "--stage",
          "suggest-improvements:Suggest improvements",
          "--stage-env",
          "WORKFLOW_ANALYZE_STAGE=analyze-process",
          "--stage-env",
          "WORKFLOW_GENERATE_STAGE=generate-workflow",
          "--stage-env",
          "WORKFLOW_SUGGESTIONS_STAGE=suggest-improvements",
          "--format",
          "json",
        ],
        { from: "user" },
      );

      expect(lookupRequests).toEqual([
        `${API_BASE}/v4/platform/tenants/test-tenant-id/workflows/configurator`,
      ]);
      expect(sharedCreateBody).toEqual({
        data: expect.objectContaining({
          tenantId: "test-tenant-id",
          workflowKey: "configurator",
          usecase: "generic",
          scopeKey: "generic:configurator",
          displayName: "Workflow Configurator",
          consumedBy: ["no-code-builder"],
          definition: {
            workflowDefinition: expect.objectContaining({
              code: "configurator",
              stages: [
                expect.objectContaining({
                  id: "analyze-process",
                  code: "analyze-process",
                  name: "Analyze process",
                }),
                expect.objectContaining({
                  id: "generate-workflow",
                  code: "generate-workflow",
                  name: "Generate workflow",
                }),
                expect.objectContaining({
                  id: "suggest-improvements",
                  code: "suggest-improvements",
                  name: "Suggest improvements",
                }),
              ],
            }),
          },
        }),
      });
      expect(verticalCreateBody).toEqual({
        data: expect.objectContaining({
          tenantId: "test-tenant-id",
          verticalKey: "no-code-builder",
          configKey: "workflow:configurator",
          config: expect.objectContaining({
            workflowKey: "configurator",
            setupStatus: "completed",
          }),
        }),
      });
      expect(capabilityBindingBody).toEqual({
        bindings: [{
          bindingKey: "workflow:configurator",
          logicalAlias: "workflow:configurator",
          capabilityKey: "workflows.runtime",
          assetType: "shared-workflow-config",
          assetKey: "configurator",
          environment: "default",
        }],
      });

      const output = outputSpy.mock.calls.flat().join("\n");
      expect(output).toContain('"appKey": "no-code-builder"');
      expect(output).toContain(
        '"NEXT_PUBLIC_WORKFLOW_CONFIGURATOR_ID": "workflow-record-1"',
      );
      expect(output).toContain('"WORKFLOW_ANALYZE_STAGE": "analyze-process"');
    },
  );

  test(
    "HP002 FL-WORKFLOW-002: provision can bind AI runtime records for workflow stages",
    { timeout: 10000 },
    async () => {
      const outputSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const createdProfiles: unknown[] = [];
      const createdPrompts: unknown[] = [];

      mockServer.server.use(
        http.get(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/workflows/configurator`,
          () => HttpResponse.json({ detail: "workflow not found" }, { status: 404 }),
        ),
        http.get(
          `${API_BASE}/v4/data/resources/test-tenant-id/vertical-product-config`,
          () =>
            HttpResponse.json({
              docs: [],
              totalDocs: 0,
              page: 1,
              totalPages: 0,
            }),
        ),
        http.get(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/ai/profiles/configurator-runtime`,
          () => HttpResponse.json({ detail: "profile not found" }, { status: 404 }),
        ),
        http.get(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/ai/prompts/:key`,
          () => HttpResponse.json({ detail: "prompt not found" }, { status: 404 }),
        ),
        http.post(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/workflows`,
          () => HttpResponse.json({ id: "workflow-record-1", key: "configurator", version: 1, data: {} }, { status: 201 }),
        ),
        http.post(
          `${API_BASE}/v4/data/resources/test-tenant-id/vertical-product-config`,
          () => HttpResponse.json({ id: "vertical-config-1" }, { status: 201 }),
        ),
        http.post(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/ai/profiles`,
          async ({ request }) => {
            createdProfiles.push(await request.json());
            return HttpResponse.json({ id: "ai-profile-1", key: "configurator-runtime", version: 1, data: {} }, { status: 201 });
          },
        ),
        http.post(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/ai/prompts`,
          async ({ request }) => {
            createdPrompts.push(await request.json());
            return HttpResponse.json(
              { id: `prompt-${createdPrompts.length}`, key: `prompt-${createdPrompts.length}`, version: 1, data: {} },
              { status: 201 },
            );
          },
        ),
        http.put(
          `${API_BASE}/v4/platform/tenants/test-tenant-id/apps/no-code-builder/capability-bindings`,
          () => HttpResponse.json({ tenantId: "test-tenant-id", appKey: "no-code-builder", bindings: [] }),
        ),
      );

      await workflowCommand.parseAsync(
        [
          "provision",
          "configurator",
          "--vertical",
          "no-code-builder",
          "--display-name",
          "Workflow Configurator",
          "--stage",
          "analyze-process:Analyze process",
          "--stage",
          "generate-workflow:Generate workflow",
          "--stage",
          "suggest-improvements:Suggest improvements",
          "--bind-ai-runtime",
          "--ai-provider",
          "azure-openai",
          "--ai-model",
          "azure/gpt-5.1-chat",
          "--ai-profile-key",
          "configurator-runtime",
          "--stage-prompt",
          "analyze-process=Extract BusinessUnderstanding JSON from the conversation.",
          "--stage-prompt",
          "generate-workflow=Return WorkflowStructure JSON.",
          "--stage-prompt",
          "suggest-improvements=Return ImprovementSuggestion JSON array.",
          "--format",
          "json",
        ],
        { from: "user" },
      );

      expect(createdProfiles).toHaveLength(1);
      expect(createdProfiles[0]).toEqual({
        data: expect.objectContaining({
          tenantId: "test-tenant-id",
          profileKey: "configurator-runtime",
          providerIntegrationKey: "azure-openai",
          model: "azure/gpt-5.1-chat",
          status: "active",
        }),
      });
      expect(createdPrompts).toHaveLength(3);
      const deprecatedOverrideFieldsKey = ["allowed", "OverrideFields"].join("");
      for (const createdPrompt of createdPrompts) {
        expect(createdPrompt.data).toMatchObject({
          customizableFields: [
            "promptContent",
            "aiProfileKey",
            "ragPolicy",
            "toolPolicy",
          ],
        });
        expect(createdPrompt.data).not.toHaveProperty(deprecatedOverrideFieldsKey);
      }
      expect(createdPrompts).toEqual(
        expect.arrayContaining([
          {
            data: expect.objectContaining({
              configKey: "configurator-analyze-process",
              promptLevel: "workflow-stage",
              workflowKey: "configurator",
              workflowStageKey: "analyze-process",
              aiProfileKey: "configurator-runtime",
              assignmentRules: expect.objectContaining({
                appScope: "selected",
                adoption: "accept",
                disposition: "accept",
                adoptionObjectType: SHARED_ASSET_ADOPTION_OBJECT_TYPE,
                dispositionObjectType: SHARED_ASSET_DISPOSITION_OBJECT_TYPE,
                verticalKeys: ["no-code-builder"],
              }),
              promptContent:
                "Extract BusinessUnderstanding JSON from the conversation.",
            }),
          },
          {
            data: expect.objectContaining({
              configKey: "configurator-generate-workflow",
              workflowStageKey: "generate-workflow",
              promptContent: "Return WorkflowStructure JSON.",
            }),
          },
          {
            data: expect.objectContaining({
              configKey: "configurator-suggest-improvements",
              workflowStageKey: "suggest-improvements",
              promptContent: "Return ImprovementSuggestion JSON array.",
            }),
          },
        ]),
      );

      const output = outputSpy.mock.calls.flat().join("\n");
      expect(output).toContain('"objectType": "shared-ai-profile"');
      expect(output).toContain('"objectType": "shared-chatbot-config"');
    },
  );

  test.each([
    {
      label: "missing AI model",
      args: [
        "provision",
        "configurator",
        "--vertical",
        "no-code-builder",
        "--stage",
        "analyze-process:Analyze process",
        "--bind-ai-runtime",
        "--ai-provider",
        "azure-openai",
        "--format",
        "json",
      ],
      message: "--bind-ai-runtime requires --ai-provider and --ai-model.",
    },
    {
      label: "unknown stage prompt",
      args: [
        "provision",
        "configurator",
        "--vertical",
        "no-code-builder",
        "--stage",
        "analyze-process:Analyze process",
        "--bind-ai-runtime",
        "--ai-provider",
        "azure-openai",
        "--ai-model",
        "azure/gpt-5.1-chat",
        "--stage-prompt",
        "review=Return review JSON.",
        "--format",
        "json",
      ],
      message: 'Stage prompt points at unknown stage "review".',
    },
  ])(
    "BP002 FL-WORKFLOW-002: rejects invalid AI runtime flags before resource upserts ($label)",
    async ({ args, message }) => {
      const resourceRequests: string[] = [];
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockServer.server.use(
        http.all(
          `${API_BASE}/v4/data/resources/test-tenant-id/:objectType`,
          ({ request }) => {
            resourceRequests.push(`${request.method} ${request.url}`);
            if (request.method === "GET") {
              return HttpResponse.json({
                docs: [],
                totalDocs: 0,
                page: 1,
                totalPages: 0,
              });
            }
            return HttpResponse.json(
              { id: "unexpected-resource-write" },
              { status: request.method === "POST" ? 201 : 200 },
            );
          },
        ),
      );

      await expect(
        workflowCommand.parseAsync(args, { from: "user" }),
      ).rejects.toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errSpy.mock.calls.flat().join(" ")).toContain(message);
      expect(resourceRequests).toEqual([]);
    },
    10000,
  );

  test("BP001 FL-WORKFLOW-001: rejects stage env mappings that reference unknown stages", () => {
    const stages = [parseStageSpec("intake:Intake", 0)];

    expect(() =>
      validateStageEnvMappings(
        stages,
        Object.fromEntries([parseEnvMapping("WORKFLOW_REVIEW_STAGE=review")]),
      ),
    ).toThrow('WORKFLOW_REVIEW_STAGE points at unknown stage "review"');
    expect(() =>
      validateStagePromptMappings(stages, { review: "Return review JSON." }),
    ).toThrow('Stage prompt points at unknown stage "review"');

    expect(() =>
      buildWorkflowProvisionPayloads(
        {
          tenantId: "tenant-1",
          verticalKey: "any-vertical",
          workflowKey: "any-workflow",
          displayName: "Any Workflow",
          stages,
        },
        {
          stageEnv: Object.fromEntries([
            parseEnvMapping("WORKFLOW_INTAKE_STAGE=intake"),
          ]),
        },
      ),
    ).not.toThrow();

    expect(() => parseEnvMapping("workflow-review=review")).toThrow(
      "Invalid env key",
    );
    expect(() => parseStagePrompt("review")).toThrow("Stage prompts must use");
    expect(parseStagePrompt("intake=Collect intake JSON")).toEqual([
      "intake",
      "Collect intake JSON",
    ]);

    expect(
      buildWorkflowAiRuntimeBindingPayloads({
        tenantId: "tenant-1",
        verticalKey: "builder-app",
        workflowKey: "configurator",
        displayName: "Configurator",
        stages,
        providerIntegrationKey: "azure-openai",
        model: "azure/gpt-5.1-chat",
        stagePrompts: { intake: "Return intake JSON." },
      }),
    ).toMatchObject({
      aiProfile: {
        profileKey: "configurator-default-model",
        providerIntegrationKey: "azure-openai",
        model: "azure/gpt-5.1-chat",
      },
      chatbotConfigs: [
        expect.objectContaining({
          configKey: "configurator-intake",
          promptLevel: "workflow-stage",
          workflowStageKey: "intake",
          assignmentRules: expect.objectContaining({
            appScope: "selected",
            adoption: "accept",
            disposition: "accept",
            adoptionObjectType: SHARED_ASSET_ADOPTION_OBJECT_TYPE,
            dispositionObjectType: SHARED_ASSET_DISPOSITION_OBJECT_TYPE,
            verticalKeys: ["builder-app"],
          }),
          promptContent: "Return intake JSON.",
          customizableFields: [
            "promptContent",
            "aiProfileKey",
            "ragPolicy",
            "toolPolicy",
          ],
        }),
      ],
    });
  });
});
