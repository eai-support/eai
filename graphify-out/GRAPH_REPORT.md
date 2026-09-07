# Graph Report - eai-cli  (2026-08-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3349 nodes · 6740 edges · 174 communities (158 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 122 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `76f32365`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- block-catalog-normalize.ts
- init.ts
- PlatformAPIClient
- bash-scripts/common.sh
- update-check.ts
- workspace-bootstrap-lib.mjs
- package-agent-plugin.mjs
- output.ts
- generate-commands.mjs
- api.ts
- vertical.ts
- gofer-installer.ts
- docs-site/package.json
- ai-surfaces.ts
- workflow.ts
- gofer-refresh.ts
- eai-full-e2e-smoke.cjs
- init.test.ts
- test-env.ts
- profile.ts
- hook-scripts/agent-stop.mjs
- commands/types.ts
- auth.ts
- resources.ts
- tenant.ts
- tenant-context.ts
- smoke-resourceapi-schema-sync-lifecycle.sh
- sync-linked-sources.js
- node/generate-issues.js
- setup-dsl.ts
- scripts
- commands
- node-scripts/generate-issues.js
- hooks/agent-stop.mjs
- runCreateFlow
- gofer-closed-loop-audit.mjs
- properties
- classifier.ts
- template.ts
- ErrorCode
- deploy.ts
- provision.ts
- verify.ts
- hook-scripts/post-tool-use.mjs
- required
- bash/common.sh
- sync-gofer-resources.cjs
- index.ts
- runtime-contract.ts
- eval-agent-discovery.cjs
- compilerOptions
- gofer-loop-audit.mjs
- hooks/post-tool-use.mjs
- bash-scripts/update-agent-context.sh
- hook-scripts/user-prompt-submit.mjs
- generate-release-docs.cjs
- bash/update-agent-context.sh
- error-codes.ts
- properties
- generateAgentsMd
- env.ts
- user.ts
- gofer-performance-report.mjs
- issue-attachment-moderation.cjs
- config.ts
- package.json
- release.sh
- verify-public-hygiene.cjs
- agent.ts
- project-manifest.ts
- normalizeGoferResourcesCheckout
- codex-doctor.mjs
- provision.test.ts
- devDependencies
- hooks/user-prompt-submit.mjs
- update-maintenance.ts
- error-guidance/types.ts
- properties
- verify-release-terminology.cjs
- describe-contract.test.ts
- dependencies
- renovate.json
- properties
- sourceEndpoints
- path
- bash-scripts/install-optional-tools.sh
- bash-scripts/pipeline-state.sh
- bash-scripts/validate-artifact.sh
- mermaid-tabular-fallback.mjs
- bash/install-optional-tools.sh
- bash/pipeline-state.sh
- bash/validate-artifact.sh
- type
- $defs
- required
- build-npm-alias-package.cjs
- test-local-dedicated-tenant-lifecycle.sh
- enum
- PublicAPIMock
- keywords
- enum
- ObjectTypePaginationEvidence
- surfaces
- powershell-scripts/install-optional-tools.ps1
- items
- generate-registry.cjs
- smoke-gofer-refresh-cache.cjs
- update-release-doc-metadata.cjs
- verify-api-reference.cjs
- powershell/install-optional-tools.ps1
- render.ts
- objectTypePageCount
- enum
- repository
- check-version-alignment.mjs
- properties
- sync-extension-resources.mjs
- findingsSummary
- SourceLocation
- resourceapi-bundle.ts
- publicapi.ts
- object-type-defaults.ts
- index.tsx
- queued-input.mjs
- visual-pass-pipeline.mjs
- PersistedLocation
- next-route-exports.ts
- required
- enum
- description
- verify-registry.sh
- loadRuntimeContract
- chat-command.test.ts
- login.test.ts
- required
- log-stage-launch-time.mjs
- ai-leverage-tagger.mjs
- stage-command.schema.json
- findings
- bash-scripts/create-new-feature.sh
- object-type-identifier-audit-v1.schema.json
- bash/create-new-feature.sh
- docusaurus.config.js
- overrides
- enum
- args
- runtime-contract.test.ts
- files
- publishConfig
- enum
- release-preflight.sh
- full-e2e-smoke.test.ts
- assemble-stakeholder-pack.mjs
- objectTypeRecordCount
- releaseOwnerUserRef
- scannedTenantCount
- object-type-documentation.test.ts
- release-metadata.test.ts
- start.test.ts
- check-persona-pack.sh
- bash-scripts/mark-task-complete.sh
- sync-implementation-status.sh
- bash/mark-task-complete.sh
- agent-discovery-eval.test.ts
- inquirer-prompt-types.test.ts

## God Nodes (most connected - your core abstractions)
1. `PlatformAPIClient` - 98 edges
2. `isRecord()` - 51 edges
3. `initCommand` - 41 edges
4. `ErrorCode` - 39 edges
5. `toObjectTypeSlug()` - 39 edges
6. `findProjectRoot()` - 32 edges
7. `resolvePublicApiUrl()` - 30 edges
8. `scripts` - 30 edges
9. `required` - 29 edges
10. `storeTokens()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `seedLoggedInTenant()` --calls--> `storeTokens()`  [EXTRACTED]
  tests/integration/vertical.test.ts → src/lib/auth.ts
- `createGoferFixture()` --calls--> `installGoferResources()`  [EXTRACTED]
  tests/integration/gofer.test.ts → src/lib/gofer-installer.ts
- `storeTestTokens()` --calls--> `storeTokens()`  [EXTRACTED]
  tests/integration/resources-command.test.ts → src/lib/auth.ts
- `storeTestTokens()` --calls--> `storeTokens()`  [EXTRACTED]
  tests/integration/workflow.test.ts → src/lib/auth.ts
- `storeTestTokens()` --calls--> `storeTokens()`  [EXTRACTED]
  tests/integration/dedicated-tenant-lifecycle.test.ts → src/lib/auth.ts

## Import Cycles
- None detected.

## Communities (174 total, 16 thin omitted)

### block-catalog-normalize.ts - "block-catalog-normalize.ts"
Cohesion: 0.06
Nodes (91): blocksCommand, buildManifestSchemaSummary(), formatBindings(), formatOverridePoints(), formatResources(), formatSource(), parseEnumOption(), parseFilterOptions() (+83 more)

### init.ts - "init.ts"
Cohesion: 0.06
Nodes (54): appOwnedSqlTableName(), assertTenantExists(), buildAuthProviderChoices(), buildInitialProjectManifest(), cloneTemplate(), copyTemplateIntoTargetDir(), CREATE_AI_TOOL_CHOICES, CREATE_AI_TOOL_LABELS (+46 more)

### bash-scripts/common.sh - "bash-scripts/common.sh"
Cohesion: 0.06
Nodes (50): calculate_spec_context(), calculate_system_context(), check_real_context_health(), estimate_tokens(), get_dir_chars(), get_file_chars(), main(), check-context-health.sh script (+42 more)

### update-check.ts - "update-check.ts"
Cohesion: 0.07
Nodes (51): buildUpdateInstallArgs(), buildUpdateInstallExecConfig(), buildUpdatePermissionGuidance(), exec, installedPackageName(), isUpdatePermissionError(), pkg, require (+43 more)

### workspace-bootstrap-lib.mjs - "workspace-bootstrap-lib.mjs"
Cohesion: 0.08
Nodes (54): main(), parseArgs(), main(), parseArgs(), archiveLegacyManagedPath(), bootstrapWorkspace(), buildAgentsMd(), buildArchiveStamp() (+46 more)

### package-agent-plugin.mjs - "package-agent-plugin.mjs"
Cohesion: 0.08
Nodes (49): loadStages(), assertNoPersonalPaths(), assertSemver(), assertWindowsPortablePaths(), buildBundleCodexMarketplace(), buildBundleMarketplace(), buildClaudeManifest(), buildCodexManifest() (+41 more)

### output.ts - "output.ts"
Cohesion: 0.07
Nodes (47): dim(), error(), formatOutput(), heading(), info(), isSimpleMode(), json(), nestedDim() (+39 more)

### generate-commands.mjs - "generate-commands.mjs"
Cohesion: 0.11
Nodes (50): CANONICAL_DESCRIPTIONS, validateDescriptions(), ALL_SURFACES, buildCopilotPromptContent(), buildEaiPlatformSessionPreflightSection(), buildGeminiExtensionManifest(), buildGithubAgentContent(), buildSkillContent() (+42 more)

### api.ts - "api.ts"
Cohesion: 0.05
Nodes (46): BatchDocumentSummary, BatchJobResponse, docsCommand, readResponseError(), appendParams(), BuilderReadinessCheck, CALLER_CONTROLLED_LOCATION_CODES, CapabilityDecision (+38 more)

### vertical.ts - "vertical.ts"
Cohesion: 0.07
Nodes (38): APP_DELETION_ENVIRONMENTS, AppAdoptObservedOptions, appAuthCommand, appCommand, AppConnectExistingOptions, AppDeploySourceUnknownOptions, AppDeploySourceUnknownStatusOptions, AppWorkflowEvidenceOptions (+30 more)

### gofer-installer.ts - "gofer-installer.ts"
Cohesion: 0.10
Nodes (35): asRecord(), assertDirectory(), copyDirectory(), copyResourceDirectory(), countFiles(), countFilesRecursive(), createGoferDirectories(), generateCopilotCliSkill() (+27 more)

### docs-site/package.json - "docs-site/package.json"
Cohesion: 0.04
Nodes (48): clsx, browserslist, development, production, dependencies, clsx, @docusaurus/core, @docusaurus/preset-classic (+40 more)

### ai-surfaces.ts - "ai-surfaces.ts"
Cohesion: 0.09
Nodes (35): isSurfaceId(), selectSurface(), startCommand, StartOptions, AI_SURFACES, AiPreferences, AiSurfaceDefinition, AiSurfaceId (+27 more)

### workflow.ts - "workflow.ts"
Cohesion: 0.08
Nodes (35): readDocs(), readResourceId(), readResponsePayload(), ResourceDoc, upsertWorkflowResource(), workflowCommand, WorkflowProvisionOptions, BuilderReadinessResult (+27 more)

### gofer-refresh.ts - "gofer-refresh.ts"
Cohesion: 0.10
Nodes (33): goferCommand, updateGitignore(), applyGoferRefresh(), backupFile(), buildSummary(), collectBundledCandidates(), collectDirectoryFiles(), collectGeneratedCandidates() (+25 more)

### eai-full-e2e-smoke.cjs - "eai-full-e2e-smoke.cjs"
Cohesion: 0.09
Nodes (44): aliasPaths(), ARTIFACT_CLEANUP, { basename, join, resolve }, checkTraceability(), cliInvocation(), COMMON_OPTION_DECISIONS, createJsonFile(), createResource() (+36 more)

### init.test.ts - "init.test.ts"
Cohesion: 0.06
Nodes (20): expectCommandFailed(), expectDirectoryCreated(), expectErrorMessage(), expectExitCode(), expectFileExists(), expectFileNotExists(), expectGitRepoInitialized(), expectNoPrompts() (+12 more)

### test-env.ts - "test-env.ts"
Cohesion: 0.12
Nodes (25): CommandResult, runCommand(), expectCommandSucceeded(), expectDisplayedMessage(), expectFileContains(), createMockServer(), MockAPIResponse, projectHasValidObjectTypes() (+17 more)

### profile.ts - "profile.ts"
Cohesion: 0.09
Nodes (24): provisionCommand, publicApiCommand, tenantCommand, userCommand, PlatformMethod, DEFAULT_AUTH_SCOPE, DEFAULT_PROD_AUTH_CLIENT_ID, DEFAULT_PROD_AUTH_SCOPE (+16 more)

### hook-scripts/agent-stop.mjs - "hook-scripts/agent-stop.mjs"
Cohesion: 0.08
Nodes (33): bridge, BRIDGE_PATH, CATEGORY_CONFIDENCE, CATEGORY_TAGS, CATEGORY_TYPES, debug(), DEBUG_LOG, deduplicateMemories() (+25 more)

### commands/types.ts - "commands/types.ts"
Cohesion: 0.05
Nodes (66): appObjectTypePublishFallbackReason(), appOwnedSqlTablePrefix(), appOwnedStoragePublishGuidance(), archiveDuplicateRemoteTypes(), buildTypeSeedDryRunResult(), collectMissingStorageFields(), collectTypeDefaultValueValidationIssues(), collectTypeStorageValidationIssues() (+58 more)

### auth.ts - "auth.ts"
Cohesion: 0.09
Nodes (48): ensureCreateAuthentication(), loginCommand, logoutCommand, parseCallbackPort(), base64UrlEncode(), browserLogin(), BrowserLoginOptions, BrowserLoginResult (+40 more)

### resources.ts - "resources.ts"
Cohesion: 0.08
Nodes (26): buildCreateResourceOutput(), buildMissingPublishedTypeMessage(), describeMissingPublishedType(), extractErrorPayload(), extractPublishedSchemaTypes(), fileCommand, formatResponseError(), matchPublishedType() (+18 more)

### tenant.ts - "tenant.ts"
Cohesion: 0.08
Nodes (43): buildTenantBootstrapAdminStatusMessages(), buildTenantCreateStatusMessages(), buildTenantListZeroState(), extractCreatedTenantRecord(), HOME_REGION_CHOICES, normalizeTenantCreateHomeRegion(), reportPublicApiEnvSync(), resolveChildTenantHomeRegion() (+35 more)

### tenant-context.ts - "tenant-context.ts"
Cohesion: 0.08
Nodes (37): hydrateEnvFromLoginContext(), InitTenantContext, StoredTokens, CommandContext, loadProfileConfig(), ActiveTenantContext, AdminTenantMembership, buildSessionResolveUrl() (+29 more)

### smoke-resourceapi-schema-sync-lifecycle.sh - "smoke-resourceapi-schema-sync-lifecycle.sh"
Cohesion: 0.22
Nodes (29): app_enrollment_is_ready(), cleanup_created_resources_from_run_dir(), cleanup_delete_resource_records(), cleanup_run_command(), cleanup_smoke_artifacts(), create_and_delete_resource(), ensure_app_provisioning_ready(), ensure_vertical_exists() (+21 more)

### sync-linked-sources.js - "sync-linked-sources.js"
Cohesion: 0.12
Nodes (29): assertCrossPlatformTemplateLifecycleScripts(), buildTemplateMetadata(), cloneDefaultBranch(), copyDir(), extractEnterprisePackageVersions(), GOFER_BASE_RESOURCE_DIR, GOFER_EXTRA_RESOURCE_MAPPINGS, GOFER_PIN_FILE (+21 more)

### node/generate-issues.js - "node/generate-issues.js"
Cohesion: 0.13
Nodes (30): args, determinePriority(), __dirname, estimateEffort(), featureIdMatch, featureNameMatch, __filename, findRelatedTasks() (+22 more)

### setup-dsl.ts - "setup-dsl.ts"
Cohesion: 0.08
Nodes (10): projectHasEnvFile(), projectHasMultiTenantConfig(), projectHasObjectType(), requireCurrentHome(), resolveTestHome(), tokenExpired(), tokenNotExpired(), userIsLoggedIn() (+2 more)

### scripts - "scripts"
Cohesion: 0.07
Nodes (30): scripts, build, dev, docs:error-guidance, docs:error-guidance:check, docs:release-assets, docs:release-assets:check, docs:verify-api (+22 more)

### commands - "commands"
Cohesion: 0.07
Nodes (29): 0_gofer_start, 0a_problem_validation, 10_gofer_cloud, 1_gofer_research, 2_gofer_specify, 3_gofer_plan, 4_gofer_tasks, 5_gofer_implement (+21 more)

### node-scripts/generate-issues.js - "node-scripts/generate-issues.js"
Cohesion: 0.14
Nodes (28): args, determinePriority(), __dirname, estimateEffort(), featureIdMatch, featureNameMatch, __filename, findRelatedTasks() (+20 more)

### hooks/agent-stop.mjs - "hooks/agent-stop.mjs"
Cohesion: 0.10
Nodes (24): bridge, BRIDGE_PATH, debug(), DEBUG_LOG, deduplicateMemories(), existing, extractContentText(), extractConversation() (+16 more)

### runCreateFlow - "runCreateFlow"
Cohesion: 0.12
Nodes (18): buildCreateCompletionSummary(), buildForwardedInitArgs(), buildTemplateInstallArgs(), canRunTemplateScripts(), consumeLastInitBinding(), createCommand, CreateCommandOptions, promptCreateOnboarding() (+10 more)

### gofer-closed-loop-audit.mjs - "gofer-closed-loop-audit.mjs"
Cohesion: 0.15
Nodes (27): addFinding(), analyzeFeature(), extractAcceptanceCriteria(), extractRequirementIds(), findAssumptionDriftTable(), findTraceabilityTable(), formatList(), getColumn() (+19 more)

### properties - "properties"
Cohesion: 0.04
Nodes (51): ae, cc, gwc, server_snapshot, stable_pre_post_enumeration, $ref, const, minimum (+43 more)

### classifier.ts - "classifier.ts"
Cohesion: 0.19
Nodes (26): changeClassifierLifecycle(), classifierCommand, ClassifierCommandOptions, ClassifierDeleteOptions, ClassifierDraft, ClassifierLabel, ClassifierResource, classifierResources() (+18 more)

### template.ts - "template.ts"
Cohesion: 0.11
Nodes (25): describeCloneFailure(), cloneTemplateSnapshot(), collectFiles(), describeTemplateSnapshot(), exec, fileExists(), hashContents(), IGNORE_EXACT_PATHS (+17 more)

### ErrorCode - "ErrorCode"
Cohesion: 0.07
Nodes (28): ErrorCode, E001, E002, E003, E004, E005, E006, E101 (+20 more)

### deploy.ts - "deploy.ts"
Cohesion: 0.11
Nodes (24): buildDeployEnvPlan(), classifyStatus(), coerceDoctorCategory(), combineUrl(), dedupeSmokeTests(), DEPLOY_PROVIDERS, deployCommand, DeployDoctorCategory (+16 more)

### provision.ts - "provision.ts"
Cohesion: 0.12
Nodes (21): DiagnosticsContext, ErrorContext, handleDeprovisionError(), handleProvisionError(), handleSecretRotationError(), hasUsableLocalEntraClientId(), hasUsableLocalEntraSecret(), normaliseBasePath() (+13 more)

### verify.ts - "verify.ts"
Cohesion: 0.13
Nodes (36): resolveClient(), addCheck(), collectPublishedStorageBackends(), ContractAuditOptions, ContractAuditReport, ContractCheckResult, describeShape(), doctorCommand (+28 more)

### hook-scripts/post-tool-use.mjs - "hook-scripts/post-tool-use.mjs"
Cohesion: 0.10
Nodes (22): atomicWriteIfChanged(), bridge, BRIDGE_PATH, bridgeEquivalent(), debug(), DEBUG_LOG, existing, extractLatestUsage() (+14 more)

### required - "required"
Cohesion: 0.07
Nodes (28): digest, digestAlgorithm, environment, expectedActiveTenantCount, expectedTenantSetDigest, findings, findingsSummary, identityKind (+20 more)

### bash/common.sh - "bash/common.sh"
Cohesion: 0.06
Nodes (48): calculate_spec_context(), calculate_system_context(), check_real_context_health(), estimate_tokens(), get_dir_chars(), get_file_chars(), main(), check-context-health.sh script (+40 more)

### sync-gofer-resources.cjs - "sync-gofer-resources.cjs"
Cohesion: 0.13
Nodes (23): BASE_RESOURCE_DIR, cloneAtRef(), copyTrackedFiles(), countFiles(), { execFileSync }, EXTRA_RESOURCE_MAPPINGS, fs, hasUncommittedChanges() (+15 more)

### index.ts - "index.ts"
Cohesion: 0.16
Nodes (16): chatCommand, buildDevServerArgs(), devCommand, getDevServerSpawnConfig(), normalizeDevPort(), envCommand, typesCommand, cliArgs (+8 more)

### runtime-contract.ts - "runtime-contract.ts"
Cohesion: 0.12
Nodes (20): runtimeCommand, exec, findTrackedSecretFiles(), interpolatePattern(), NormalizedRuntimeContract, normalizeTenantEnvKey(), readEnvFile(), RUNTIME_CONTRACT_FILE (+12 more)

### eval-agent-discovery.cjs - "eval-agent-discovery.cjs"
Cohesion: 0.14
Nodes (20): createRegexSmallAgent(), { execFileSync, spawnSync }, extractKnownError(), fs, isAllowedCommand(), lastObservation(), main(), normalizeCommand() (+12 more)

### compilerOptions - "compilerOptions"
Cohesion: 0.09
Nodes (21): node, node_modules, src/**/*, compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames (+13 more)

### gofer-loop-audit.mjs - "gofer-loop-audit.mjs"
Cohesion: 0.19
Nodes (21): analyze(), appendRecord(), createDefaultContract(), formatList(), hasMaterialText(), initContract(), isObject(), main() (+13 more)

### hooks/post-tool-use.mjs - "hooks/post-tool-use.mjs"
Cohesion: 0.11
Nodes (18): atomicWrite(), bridge, BRIDGE_PATH, debug(), DEBUG_LOG, existing, extractLatestUsage(), HOOKS_DIR (+10 more)

### bash-scripts/update-agent-context.sh - "bash-scripts/update-agent-context.sh"
Cohesion: 0.26
Nodes (19): create_new_agent_file(), extract_plan_field(), format_technology_stack(), get_commands_for_language(), get_language_conventions(), get_project_structure(), log_error(), log_info() (+11 more)

### hook-scripts/user-prompt-submit.mjs - "hook-scripts/user-prompt-submit.mjs"
Cohesion: 0.12
Nodes (17): additionalContext, atomicWriteIfChanged(), BRIDGE_PATH, bridgeEquivalent(), debug(), DEBUG_LOG, hookStart, input (+9 more)

### generate-release-docs.cjs - "generate-release-docs.cjs"
Cohesion: 0.12
Nodes (17): buildContext(), DOC_ORDER, DOCS_DIR, { execFileSync }, fs, HELP_COMMANDS, main(), OUTPUTS (+9 more)

### bash/update-agent-context.sh - "bash/update-agent-context.sh"
Cohesion: 0.26
Nodes (19): create_new_agent_file(), extract_plan_field(), format_technology_stack(), get_commands_for_language(), get_language_conventions(), get_project_structure(), log_error(), log_info() (+11 more)

### error-codes.ts - "error-codes.ts"
Cohesion: 0.24
Nodes (17): errorCatalog, ErrorDefinition, exitWithError(), formatError(), formatErrorJSON(), interpolate(), errorGuidanceCatalog, findGuidanceByCode() (+9 more)

### properties - "properties"
Cohesion: 0.08
Nodes (25): error, info, OBJECT_TYPE_DIRECT_ROUTE_CONSTRUCTION, OBJECT_TYPE_INVENTORY_INCOMPLETE, OBJECT_TYPE_NAME_NON_CANONICAL, OBJECT_TYPE_SLUG_DERIVATION_MISMATCH, OBJECT_TYPE_SLUG_MISSING, OBJECT_TYPE_SLUG_NON_CANONICAL (+17 more)

### generateAgentsMd - "generateAgentsMd"
Cohesion: 0.19
Nodes (15): buildBoundariesSection(), buildCommandsSection(), buildGitWorkflowSection(), buildTestingSection(), detectPackageManager(), detectProjectInfo(), ensureClaudeMd(), ensureDefaultInstructions() (+7 more)

### env.ts - "env.ts"
Cohesion: 0.19
Nodes (15): exec, execAzureCli(), hydrateCloudSecret(), CommandInvocation, getAzureCliInvocation(), CloudEnvPullOptions, CloudEnvPullResult, CloudEnvSetOptions (+7 more)

### user.ts - "user.ts"
Cohesion: 0.13
Nodes (13): InviteUserCommandOptions, isTenantBaseRole(), ListUsersCommandOptions, MEMBER_ID_ROLE_UPDATE_ROLES, SetUserRoleCommandOptions, TENANT_BASE_ROLES, TenantMember, TenantMemberListResponse (+5 more)

### gofer-performance-report.mjs - "gofer-performance-report.mjs"
Cohesion: 0.17
Nodes (15): BUCKETS, collectBucket(), DEFAULT_ROOT, __dirname, estimateTokens(), FILE_EXTENSIONS, __filename, generatePerformanceReport() (+7 more)

### issue-attachment-moderation.cjs - "issue-attachment-moderation.cjs"
Cohesion: 0.20
Nodes (16): applyModerationPlan(), buildModerationPlan(), DEFAULT_TRUSTED_ASSOCIATIONS, findUnsafeAttachments(), githubRequest(), graphql(), issueAlreadyWarned(), isTrustedAssociation() (+8 more)

### config.ts - "config.ts"
Cohesion: 0.09
Nodes (30): applyTemporaryEnv(), BlobStorageBinding, canonicalizeObjectTypeRelationshipTargets(), DocumentDbStorageBinding, JsonValue, loadObjectTypeEvaluationEnv(), loadObjectTypes(), ObjectTypeAction (+22 more)

### package.json - "package.json"
Cohesion: 0.12
Nodes (16): author, bin, eai, bugs, url, description, engines, node (+8 more)

### release.sh - "release.sh"
Cohesion: 0.24
Nodes (16): create_release_pr(), ensure_no_existing_release_pr(), ensure_no_stale_local_tag(), latest_release_tag(), local_tag_exists(), remote_tag_exists(), require_command(), section() (+8 more)

### verify-public-hygiene.cjs - "verify-public-hygiene.cjs"
Cohesion: 0.12
Nodes (12): { execFileSync }, files, findings, FORBIDDEN_FIXTURE_LITERALS, FORBIDDEN_PUBLIC_SURFACE_PATTERNS, fs, HIGH_CONFIDENCE_PATTERNS, INTERNAL_DOC_PATHS (+4 more)

### agent.ts - "agent.ts"
Cohesion: 0.20
Nodes (14): agentCommand, formatCommand(), formatSteps(), printGuideText(), AgentGuide, AgentGuideCommand, AgentGuideStep, getAgentGuide() (+6 more)

### project-manifest.ts - "project-manifest.ts"
Cohesion: 0.25
Nodes (13): coerceTemplateRepoFromDisplaySource(), execFileAsync, fileExists(), getProjectManifestPath(), GoferManagedFileState, inferManifestFromLegacyInitCommit(), inferManifestFromLegacyProjectStructure(), loadProjectManifest() (+5 more)

### normalizeGoferResourcesCheckout - "normalizeGoferResourcesCheckout"
Cohesion: 0.23
Nodes (13): resolveGoferResourcesPath(), assertCompleteGoferResources(), copyDirectoryIfPresent(), directoryContainsFile(), fetchLatestGoferVersion(), findIncompleteGoferResourceDirectories(), getLatestManifestUrl(), isDirectoryPath() (+5 more)

### codex-doctor.mjs - "codex-doctor.mjs"
Cohesion: 0.21
Nodes (15): buildBundles(), buildSuggestedConfig(), CANONICAL_GOFER_STAGES, collectSkillRows(), FORBIDDEN_FS_METHODS, main(), parseArgs(), parseFrontmatter() (+7 more)

### provision.test.ts - "provision.test.ts"
Cohesion: 0.20
Nodes (6): setActiveProfile(), DEFAULT_PUBLIC_API_URL, setTestHome(), storeTestTokens(), TENANT_AUTH_ADDED, TENANT_AUTH_EXISTING

### devDependencies - "devDependencies"
Cohesion: 0.13
Nodes (15): eslint, @eslint/js, msw, devDependencies, eslint, @eslint/js, msw, @types/node (+7 more)

### hooks/user-prompt-submit.mjs - "hooks/user-prompt-submit.mjs"
Cohesion: 0.15
Nodes (11): additionalContext, BRIDGE_PATH, debug(), DEBUG_LOG, input, memories, MEMORY_PATH, relevant (+3 more)

### update-maintenance.ts - "update-maintenance.ts"
Cohesion: 0.18
Nodes (17): describeTemplateSource(), isDefaultTemplateSource(), resolveTemplateClonePlan(), describeReleaseChannel(), describeTemplateSnapshot(), renderDoctorUpdateStatus(), describeTemplateSnapshot(), hasGoferWork() (+9 more)

### error-guidance/types.ts - "error-guidance/types.ts"
Cohesion: 0.15
Nodes (13): ErrorGuidance, ErrorGuidanceCategory, ErrorGuidanceEscalation, ErrorGuidanceJson, ErrorGuidanceMatch, ErrorGuidanceRetryPolicy, ErrorGuidanceSafety, ErrorGuidanceSeverity (+5 more)

### properties - "properties"
Cohesion: 0.12
Nodes (17): A0, A1, P0, P1, pattern, type, enum, properties (+9 more)

### verify-release-terminology.cjs - "verify-release-terminology.cjs"
Cohesion: 0.22
Nodes (12): ALLOWED_OCCURRENCES, collectFiles(), findInternalTerminologyLeaks(), fs, inspectLine(), isAllowedOccurrence(), normalizeRelativePath(), path (+4 more)

### describe-contract.test.ts - "describe-contract.test.ts"
Cohesion: 0.21
Nodes (12): childCommands(), cliEntry, CliResult, DescribeCommand, DescribeOption, findCommand(), isRecord(), optionNames() (+4 more)

### dependencies - "dependencies"
Cohesion: 0.15
Nodes (13): chalk, commander, dotenv, ora, dependencies, chalk, commander, dotenv (+5 more)

### renovate.json - "renovate.json"
Cohesion: 0.15
Nodes (12): before 8:30am on the first monday of the month, config:recommended, automerge, dependencyDashboard, extends, minimumReleaseAge, packageRules, prConcurrentLimit (+4 more)

### properties - "properties"
Cohesion: 0.17
Nodes (12): oneOf, type, pattern, type, properties, minLength, pattern, type (+4 more)

### sourceEndpoints - "sourceEndpoints"
Cohesion: 0.15
Nodes (13): objectTypes, tenants, pattern, type, objectTypes, sourceEndpoints, tenants, additionalProperties (+5 more)

### path - "path"
Cohesion: 0.15
Nodes (7): path, BRIDGE_PATH, input, now, BRIDGE_PATH, input, now

### bash-scripts/install-optional-tools.sh - "bash-scripts/install-optional-tools.sh"
Cohesion: 0.47
Nodes (12): detect_js_package_manager(), has_command(), install_azure_cli(), install_gh_cli(), install_playwright_browsers(), install_repo_package(), install_with_npm_global(), log_error() (+4 more)

### bash-scripts/pipeline-state.sh - "bash-scripts/pipeline-state.sh"
Cohesion: 0.38
Nodes (12): cmd_init(), cmd_read(), cmd_status(), cmd_update(), detect_feature_dir(), generate_uuid(), get_state_path(), json_read() (+4 more)

### bash-scripts/validate-artifact.sh - "bash-scripts/validate-artifact.sh"
Cohesion: 0.36
Nodes (12): extract_frontmatter(), has_pattern(), has_section(), validate-artifact.sh script, validate_plan_frontmatter(), validate_plan_sections(), validate_spec_frontmatter(), validate_spec_sections() (+4 more)

### mermaid-tabular-fallback.mjs - "mermaid-tabular-fallback.mjs"
Cohesion: 0.33
Nodes (12): escapeCell(), nonEmptyLines(), quadrantOf(), renderC4(), renderQuadrant(), renderXyChart(), rescue(), splitArray() (+4 more)

### bash/install-optional-tools.sh - "bash/install-optional-tools.sh"
Cohesion: 0.47
Nodes (12): detect_js_package_manager(), has_command(), install_azure_cli(), install_gh_cli(), install_playwright_browsers(), install_repo_package(), install_with_npm_global(), log_error() (+4 more)

### bash/pipeline-state.sh - "bash/pipeline-state.sh"
Cohesion: 0.38
Nodes (12): cmd_init(), cmd_read(), cmd_status(), cmd_update(), detect_feature_dir(), generate_uuid(), get_state_path(), json_read() (+4 more)

### bash/validate-artifact.sh - "bash/validate-artifact.sh"
Cohesion: 0.36
Nodes (12): extract_frontmatter(), has_pattern(), has_section(), validate-artifact.sh script, validate_plan_frontmatter(), validate_plan_sections(), validate_spec_frontmatter(), validate_spec_sections() (+4 more)

### type - "type"
Cohesion: 0.18
Nodes (12): boolean, integer, number, JsonScalar, type, null, string, type (+4 more)

### $defs - "$defs"
Cohesion: 0.09
Nodes (23): classification, contractVersion, field, location, offendingValue, remediation, rule, severity (+15 more)

### required - "required"
Cohesion: 0.29
Nodes (7): contentBase64, contentDigest, deleted, entryDigest, mode, required, kind

### build-npm-alias-package.cjs - "build-npm-alias-package.cjs"
Cohesion: 0.24
Nodes (11): aliasPackageJson(), copyOptionalFile(), copyRequiredPath(), fs, main(), path, pkg, PUBLIC_ALIAS_DIR (+3 more)

### test-local-dedicated-tenant-lifecycle.sh - "test-local-dedicated-tenant-lifecycle.sh"
Cohesion: 0.30
Nodes (11): assert_json(), cleanup(), cleanup_prior_test_tenants(), cleanup_storage(), create_test_tenant(), ensure_local_search_key_loaded(), json_field(), retry_search() (+3 more)

### enum - "enum"
Cohesion: 0.40
Nodes (5): deletion, symlink, file, enum, kind

### keywords - "keywords"
Cohesion: 0.18
Nodes (11): keywords, ai, application, automation, cli, deployment, developer-tools, eai (+3 more)

### enum - "enum"
Cohesion: 0.50
Nodes (4): dev, prod, test, enum

### ObjectTypePaginationEvidence - "ObjectTypePaginationEvidence"
Cohesion: 0.11
Nodes (22): pageCount, recordCount, tenantRef, terminal, ObjectTypePaginationEvidence, PaginationEvidence, additionalProperties, properties (+14 more)

### surfaces - "surfaces"
Cohesion: 0.18
Nodes (11): description, items, type, type, includes, surfaces, description, items (+3 more)

### powershell-scripts/install-optional-tools.ps1 - "powershell-scripts/install-optional-tools.ps1"
Cohesion: 0.49
Nodes (9): Install-AzureCli(), Install-GitHubCli(), Install-NpmGlobalPackage(), Install-PlaywrightBrowsers(), Install-RepoPackage(), Invoke-Step(), Test-CommandExists(), Write-Info() (+1 more)

### items - "items"
Cohesion: 0.40
Nodes (5): items, type, additionalProperties, type, entries

### generate-registry.cjs - "generate-registry.cjs"
Cohesion: 0.25
Nodes (10): crypto, findTarball(), fs, generatePackageRegistry(), generateVersionListing(), main(), packageTarballPrefix(), path (+2 more)

### smoke-gofer-refresh-cache.cjs - "smoke-gofer-refresh-cache.cjs"
Cohesion: 0.18
Nodes (8): { execFileSync, spawnSync }, fs, normalizedMappings, os, path, requiredDirectories, root, workspace

### update-release-doc-metadata.cjs - "update-release-doc-metadata.cjs"
Cohesion: 0.22
Nodes (9): escapeRegExp(), { execSync }, fs, path, releaseMessage, today, updateExistingFile(), updateFile() (+1 more)

### verify-api-reference.cjs - "verify-api-reference.cjs"
Cohesion: 0.25
Nodes (10): API_TS, DOC_FILES, extractCodeContract(), extractRouteTemplates(), fs, main(), path, readApiSource() (+2 more)

### powershell/install-optional-tools.ps1 - "powershell/install-optional-tools.ps1"
Cohesion: 0.49
Nodes (9): Install-AzureCli(), Install-GitHubCli(), Install-NpmGlobalPackage(), Install-PlaywrightBrowsers(), Install-RepoPackage(), Invoke-Step(), Test-CommandExists(), Write-Info() (+1 more)

### render.ts - "render.ts"
Cohesion: 0.40
Nodes (9): errorsCommand, failResponse(), formatGuidanceExplanation(), formatGuidanceText(), guidanceToJSON(), interpolate(), interpolateCommand(), interpolateList() (+1 more)

### objectTypePageCount - "objectTypePageCount"
Cohesion: 0.67
Nodes (3): minimum, type, objectTypePageCount

### enum - "enum"
Cohesion: 0.20
Nodes (10): agents-skills, claude, claude-mirror, codex, copilot, gemini, github-prompts, system-skills (+2 more)

### repository - "repository"
Cohesion: 0.67
Nodes (3): repository, minLength, type

### check-version-alignment.mjs - "check-version-alignment.mjs"
Cohesion: 0.27
Nodes (7): checkVersionAlignment(), collectVersions(), DEFAULT_ROOT, __dirname, __filename, readJson(), readText()

### properties - "properties"
Cohesion: 0.20
Nodes (10): description, type, description, type, properties, body, name, title (+2 more)

### sync-extension-resources.mjs - "sync-extension-resources.mjs"
Cohesion: 0.31
Nodes (9): copyFileWithMode(), __dirname, __filename, isNodeErrorWithCode(), main(), pathExists(), REPO_ROOT, SYNC_PAIRS (+1 more)

### findingsSummary - "findingsSummary"
Cohesion: 0.12
Nodes (19): activation_blocker, blocking_source_drift, report_only_persisted_legacy_drift, minimum, type, minimum, type, enum (+11 more)

### SourceLocation - "SourceLocation"
Cohesion: 0.12
Nodes (16): line, minimum, type, SourceLocation, minLength, type, file, minimum (+8 more)

### resourceapi-bundle.ts - "resourceapi-bundle.ts"
Cohesion: 0.33
Nodes (8): readObjectTypeSlugsFromSchema(), buildPassiveResourceApiBundle(), extractObjectTypesForPassiveBundle(), isPublishedObjectType(), normalizeStorageBackend(), PASSIVE_RESOURCEAPI_BUNDLE_SCHEMA, PassiveResourceApiBundle, PassiveResourceApiBundleOptions

### publicapi.ts - "publicapi.ts"
Cohesion: 0.31
Nodes (9): DecodedResponseBody, decodeResponseBody(), METHODS, normalizePath(), parseQueryParams(), parseRequestBody(), PublicApiCommandOptions, runPublicApiRequest() (+1 more)

### object-type-defaults.ts - "object-type-defaults.ts"
Cohesion: 0.36
Nodes (8): ObjectTypeDefinition, ObjectTypeProperty, describeValueType(), hasDefaultValue(), isFiniteNumber(), isJsonValue(), STRING_DEFAULT_PROPERTY_TYPES, validateObjectTypePropertyDefaultValue()

### index.tsx - "index.tsx"
Cohesion: 0.22
Nodes (4): AsideProps, CardGridProps, LinkCardProps, StepsProps

### queued-input.mjs - "queued-input.mjs"
Cohesion: 0.47
Nodes (8): countLines(), countPending(), ensureDir(), main(), readQueue(), readStdin(), replayQueue(), resolveQueuePath()

### visual-pass-pipeline.mjs - "visual-pass-pipeline.mjs"
Cohesion: 0.33
Nodes (7): renderString(), renderVisual(), buildRisksBlock(), __dirname, runPass1(), runPass2(), TEMPLATE_PATH

### PersistedLocation - "PersistedLocation"
Cohesion: 0.13
Nodes (15): recordRef, PersistedLocation, kind, const, additionalProperties, properties, required, type (+7 more)

### next-route-exports.ts - "next-route-exports.ts"
Cohesion: 0.36
Nodes (8): ALLOWED_ROUTE_EXPORTS, collectBindingNames(), collectInvalidExports(), collectNamedExports(), hasExportModifier(), RouteExportViolation, scanAppRouterRouteExports(), walkRouteFiles()

### required - "required"
Cohesion: 0.14
Nodes (13): baselineSha, entries, phase, repository, rootDigest, semantics, schemaVersion, additionalProperties (+5 more)

### enum - "enum"
Cohesion: 0.25
Nodes (8): control, diagnostic, pipeline, utility, description, enum, type, category

### description - "description"
Cohesion: 0.25
Nodes (8): properties, description, maxLength, type, default, description, required, type

### verify-registry.sh - "verify-registry.sh"
Cohesion: 0.46
Nodes (7): contains(), fail(), omits(), pass(), section(), verify-registry.sh script, skip()

### loadRuntimeContract - "loadRuntimeContract"
Cohesion: 0.43
Nodes (8): isRecord(), loadRuntimeContract(), normalizePublicEndpoint(), normalizeRuntimeContract(), normalizeSmokeTest(), readJsonFile(), readPath(), stringArray()

### chat-command.test.ts - "chat-command.test.ts"
Cohesion: 0.39
Nodes (6): createTestProject(), createChatFetchMock(), findChatRequest(), jsonResponse(), requestUrl(), tenantListPayload()

### required - "required"
Cohesion: 0.29
Nodes (7): body, category, description, name, surfaces, title, required

### log-stage-launch-time.mjs - "log-stage-launch-time.mjs"
Cohesion: 0.48
Nodes (6): ensureDir(), main(), resolveLogPath(), resolveMode(), resolveStage(), T0

### ai-leverage-tagger.mjs - "ai-leverage-tagger.mjs"
Cohesion: 0.43
Nodes (4): KEYWORD_RULES, validateVerb(), VERBS, countVerbs()

### stage-command.schema.json - "stage-command.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### findings - "findings"
Cohesion: 0.29
Nodes (7): items, type, $ref, items, type, findings, objectTypePagination

### bash-scripts/create-new-feature.sh - "bash-scripts/create-new-feature.sh"
Cohesion: 0.53
Nodes (5): check_existing_branches(), find_repo_root(), generate_branch_name(), create-new-feature.sh script, SPECIFY_FEATURE

### object-type-identifier-audit-v1.schema.json - "object-type-identifier-audit-v1.schema.json"
Cohesion: 0.33
Nodes (5): description, $id, oneOf, $schema, title

### bash/create-new-feature.sh - "bash/create-new-feature.sh"
Cohesion: 0.53
Nodes (5): check_existing_branches(), find_repo_root(), generate_branch_name(), create-new-feature.sh script, SPECIFY_FEATURE

### overrides - "overrides"
Cohesion: 0.40
Nodes (5): overrides, graphql, @napi-rs/wasm-runtime, obug, semver

### enum - "enum"
Cohesion: 0.40
Nodes (5): 100644, 100755, 120000, enum, mode

### args - "args"
Cohesion: 0.40
Nodes (5): type, additionalProperties, description, type, args

### files - "files"
Cohesion: 0.50
Nodes (4): files, dist, NOTICE, resources

### publishConfig - "publishConfig"
Cohesion: 0.50
Nodes (4): publishConfig, access, provenance, registry

### enum - "enum"
Cohesion: 0.50
Nodes (4): complete, incomplete, status, enum

### full-e2e-smoke.test.ts - "full-e2e-smoke.test.ts"
Cohesion: 0.50
Nodes (3): cliPath, root, scriptPath

### objectTypeRecordCount - "objectTypeRecordCount"
Cohesion: 0.67
Nodes (3): minimum, type, objectTypeRecordCount

### releaseOwnerUserRef - "releaseOwnerUserRef"
Cohesion: 0.67
Nodes (3): releaseOwnerUserRef, minLength, type

### scannedTenantCount - "scannedTenantCount"
Cohesion: 0.67
Nodes (3): scannedTenantCount, minimum, type

## Knowledge Gaps
- **952 isolated node(s):** `BlockSourceType`, `CreateAiTool`, `CreateOnboardingAnswers`, `ExistingAppSelection`, `InitCapabilityKey` (+947 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `path` connect `path` to `node-scripts/generate-issues.js`, `hooks/agent-stop.mjs`, `gofer-closed-loop-audit.mjs`, `workspace-bootstrap-lib.mjs`, `package-agent-plugin.mjs`, `generate-commands.mjs`, `hooks/user-prompt-submit.mjs`, `hook-scripts/post-tool-use.mjs`, `log-stage-launch-time.mjs`, `gofer-loop-audit.mjs`, `hook-scripts/agent-stop.mjs`, `sync-extension-resources.mjs`, `hook-scripts/user-prompt-submit.mjs`, `hooks/post-tool-use.mjs`, `node/generate-issues.js`, `required`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `typescript` connect `dependencies` to `next-route-exports.ts`, `keywords`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `required` connect `required` to `items`, `path`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `isRecord()` (e.g. with `selectExistingAppSelection()` and `summarizeAppObjectTypePublish()`) actually correct?**
  _`isRecord()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `toObjectTypeSlug()` (e.g. with `.queryResources()` and `.searchResources()`) actually correct?**
  _`toObjectTypeSlug()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `BlockSourceType`, `CreateAiTool`, `CreateOnboardingAnswers` to the rest of the system?**
  _952 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `block-catalog-normalize.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06464776632302406 - nodes in this community are weakly interconnected._

## Build Provenance

- Graphify: 0.9.50
- Source commit: 76f3236504ca46f67332a0fe7dd0c0e419e8a4e2
- Built at: 2026-08-31T03:28:13Z
- Nodes: 3349
- Edges: 6740
- graph.json SHA-256: 35580e63a9b48d83f6a34b1c58e74841c715ad348bbd54714f009fcd8dce03d3
- Scope: code-only canonical full extraction
- Validation: PASS
- Accepted external module identifiers: @docusaurus/types, inquirer, node:child_process, node:crypto, node:fs/promises, node:http, node:path
- Deferred semantic scope: docs, media, and semantic-only formats are intentionally excluded.
- Coverage note: no primary coverage is claimed for unsupported Rego or Bicep sources.
- Unsupported tracked extensions: .rego=0; .bicep=0
- Exclusions: none
