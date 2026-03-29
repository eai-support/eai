---
title: EAI CLI - 100 Business Test Scenarios
version: 1.0.0
created: 2026-03-15
framework: Vitest
coverage_target: 100 scenarios across 14 command groups
status: defined
---

# EAI CLI - 100 Business Test Scenarios

## Overview

This document defines 100 comprehensive business scenarios for testing the EAI CLI across all command groups, workflows, and edge cases. Each scenario is designed to validate real-world developer usage patterns.

## Test Framework

- **Framework**: Vitest
- **Assertion Library**: Vitest expect
- **Test Structure**: Given-When-Then (implicit via blank lines)
- **DSL Location**: `tests/helpers/`
- **Fixtures**: `tests/fixtures/`

## Coverage Matrix

| Category | Scenarios | Priority | Status |
|----------|-----------|----------|--------|
| Init & Setup | 1-10 | P0 | Defined |
| Authentication | 11-20 | P0 | Defined |
| Environment Management | 21-30 | P1 | Defined |
| Object Types | 31-45 | P0 | Defined |
| Resources CRUD | 46-60 | P0 | Defined |
| Multi-Tenant | 61-70 | P1 | Defined |
| AI & Chat | 71-78 | P1 | Defined |
| Documents | 79-83 | P2 | Defined |
| Deployment | 84-91 | P1 | Defined |
| Diagnostics | 92-96 | P2 | Defined |
| CLI Updates | 97-100 | P2 | Defined |

---

## Category 1: Init & Project Setup (Scenarios 1-10)

### Scenario 1: Initialize New Vertical with Interactive Prompts
**Priority**: P0
**User Story**: As a developer, I want to scaffold a new vertical application with guided prompts

```javascript
// TC001: Initialize new vertical interactively
// Traces to: Init-US1-AC1
//
// workingDirectoryIs('/tmp/test-projects')
// gitIsInstalled()
// networkIsAvailable()
//
// runCommand('eai init my-vertical')
// respondToPrompt('Display Name', 'My Vertical')
// respondToPrompt('Description', 'Test vertical app')
// respondToPrompt('Tenant Structure', 'single')
// respondToPrompt('Include AI Chat', 'yes')
// respondToPrompt('Include Docs', 'yes')
// respondToPrompt('Auth Provider', 'ciam')
//
// expectDirectoryCreated('my-vertical')
// expectFileExists('my-vertical/package.json')
// expectFileContains('my-vertical/package.json', '"name": "my-vertical"')
// expectFileExists('my-vertical/.env.local')
// expectFileExists('my-vertical/src/eai.config/object-types.ts')
// expectGitRepoInitialized('my-vertical')
// expectSuccessMessage('Vertical "My Vertical" initialized')
```

### Scenario 2: Initialize with Skip Prompts
**Priority**: P0
**User Story**: As a developer, I want to quickly scaffold with defaults

```javascript
// TC002: Initialize with --skip-prompts flag
// Traces to: Init-US1-AC2
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init quick-app --skip-prompts')
//
// expectDirectoryCreated('quick-app')
// expectFileContains('quick-app/package.json', '"name": "quick-app"')
// expectFileContains('quick-app/package.json', '"displayName": "Quick App"')
// expectEnvVarSet('quick-app/.env.local', 'NEXT_PUBLIC_APP_NAME', 'quick-app')
// expectNoInteractivePrompts()
```

### Scenario 3: Initialize from Custom Template Repository
**Priority**: P1
**User Story**: As a developer, I want to use my organization's custom template

```javascript
// TC003: Initialize from custom repo
// Traces to: Init-US1-AC3
//
// customTemplateRepoExists('https://github.com/custom-org/custom-template.git')
//
// runCommand('eai init custom-app --from https://github.com/custom-org/custom-template.git')
//
// expectGitClonedFrom('https://github.com/custom-org/custom-template.git')
// expectDirectoryCreated('custom-app')
// expectCustomTemplateFilesPresent('custom-app')
```

### Scenario 4: Initialize Fails - Directory Already Exists
**Priority**: P0
**User Story**: As a developer, I should get clear error if directory exists

```javascript
// TC004: Init fails when directory exists
// Traces to: Init-US1-ERR1
//
// directoryExists('/tmp/test-projects/existing-app')
//
// runCommand('eai init existing-app')
//
// expectCommandFailed()
// expectErrorMessage('Directory "existing-app" already exists')
// expectExitCode(1)
// expectNoFilesModified('existing-app')
```

### Scenario 5: Initialize Fails - Git Not Installed
**Priority**: P1
**User Story**: As a developer, I should get helpful error if prerequisites missing

```javascript
// TC005: Init fails when git not installed
// Traces to: Init-US1-ERR2
//
// gitNotInstalled()
//
// runCommand('eai init my-app')
//
// expectCommandFailed()
// expectErrorMessage('Git is required')
// expectSuggestedFix('Install git: https://git-scm.com/downloads')
// expectExitCode(1)
```

### Scenario 6: Initialize Multi-Tenant Structure
**Priority**: P1
**User Story**: As a developer, I want to scaffold a multi-tenant vertical

```javascript
// TC006: Initialize multi-tenant vertical
// Traces to: Init-US2-AC1
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init multi-app')
// respondToPrompt('Tenant Structure', 'multi')
//
// expectEnvFileContains('multi-app/.env.local', 'TENANT_KEYS=multi-app,multi-app-staff,multi-app-admin')
// expectTenantConfigGenerated('multi-app', ['multi-app', 'multi-app-staff', 'multi-app-admin'])
```

### Scenario 7: Initialize Without AI Chat
**Priority**: P2
**User Story**: As a developer, I want to opt-out of AI features

```javascript
// TC007: Initialize without AI chat
// Traces to: Init-US1-AC4
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init simple-app')
// respondToPrompt('Include AI Chat', 'no')
//
// expectFileNotExists('simple-app/src/app/chat')
// expectEnvVarNotSet('simple-app/.env.local', 'WORKFLOW_*_ID')
```

### Scenario 8: Initialize Generates Valid Object Types Scaffold
**Priority**: P0
**User Story**: As a developer, I want example object types to learn from

```javascript
// TC008: Generated object-types.ts is valid
// Traces to: Init-US3-AC1
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init types-app --skip-prompts')
//
// expectFileExists('types-app/src/eai.config/object-types.ts')
// expectValidTypeScriptSyntax('types-app/src/eai.config/object-types.ts')
// expectObjectTypeHasProperty('Record', 'name', 'PascalCase')
// expectObjectTypeHasProperty('Record', 'displayName', 'string')
// expectExampleProperties(['title', 'status', 'description'])
```

### Scenario 9: Initialize Generates Deployment Workflow
**Priority**: P1
**User Story**: As a developer, I want CI/CD ready out-of-box

```javascript
// TC009: Generated deployment workflow is valid
// Traces to: Init-US4-AC1
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init deploy-app --skip-prompts')
//
// expectFileExists('deploy-app/.github/workflows/deploy-demo.yml')
// expectYamlValid('deploy-app/.github/workflows/deploy-demo.yml')
// expectWorkflowJobExists('build-and-deploy')
// expectWorkflowStepExists('Deploy to Azure App Service')
```

### Scenario 10: Initialize Creates Git Commit
**Priority**: P2
**User Story**: As a developer, I want initial commit created automatically

```javascript
// TC010: Init creates initial git commit
// Traces to: Init-US1-AC5
//
// workingDirectoryIs('/tmp/test-projects')
//
// runCommand('eai init git-app --skip-prompts')
//
// expectGitRepoInitialized('git-app')
// expectGitCommitExists('git-app', 'Initial commit from eai init')
// expectGitBranchIs('git-app', 'main')
```

---

## Category 2: Authentication (Scenarios 11-20)

### Scenario 11: Login with Device Code Flow
**Priority**: P0
**User Story**: As a developer, I want to authenticate via browser-based PKCE flow

```javascript
// TC011: Successful login with browser PKCE flow
// Traces to: Auth-US1-AC1
//
// entraDeviceCodeEndpointResponds({ device_code: 'DEV123', user_code: 'ABCD-1234' })
// entraTokenEndpointWillSucceed({ access_token: 'token123', expires_in: 3600 })
//
// runCommand('eai login')
//
// expectDisplayedMessage('Opening your browser to complete sign-in')
// expectDisplayedMessage('Enter code: ABCD-1234')
// waitForUserAuth()
// expectTokenStored('~/.eai/tokens.json')
// expectTokenEncrypted('~/.eai/tokens.json')
// expectSuccessMessage('Authenticated as user@company.com')
```

### Scenario 12: Login with Custom Tenant
**Priority**: P1
**User Story**: As a developer, I want to use a different Entra tenant

```javascript
// TC012: Login with custom tenant
// Traces to: Auth-US1-AC2
//
// customTenantExists('customtenant', 'tenant-id-456')
//
// runCommand('eai login --tenant-name customtenant --tenant-id tenant-id-456')
//
// expectEntraEndpointCalled('https://customtenant.ciamlogin.com/oauth2/v2.0/devicecode')
// expectTokenStoredWithTenant('customtenant', 'tenant-id-456')
```

### Scenario 13: Login Fails - Device Code Timeout
**Priority**: P1
**User Story**: As a developer, I should see clear error on timeout

```javascript
// TC013: Login fails when browser callback times out
// Traces to: Auth-US1-ERR1
//
// entraDeviceCodeEndpointResponds({ expires_in: 5 })
// entraTokenEndpointReturns('authorization_pending')
// waitSeconds(6)
//
// runCommand('eai login')
//
// expectCommandFailed()
// expectErrorMessage('Device code expired. Please try again.')
// expectNoTokenStored()
// expectExitCode(1)
```

### Scenario 14: Login Fails - Network Unreachable
**Priority**: P1
**User Story**: As a developer, I should get helpful error on network issues

```javascript
// TC014: Login fails on network error
// Traces to: Auth-US1-ERR2
//
// networkIsUnreachable()
//
// runCommand('eai login')
//
// expectCommandFailed()
// expectErrorMessage('Unable to reach authentication endpoint')
// expectSuggestedFix('Check network connection')
// expectExitCode(1)
```

### Scenario 15: Logout Clears Tokens
**Priority**: P0
**User Story**: As a developer, I want to logout and clear credentials

```javascript
// TC015: Logout clears stored tokens
// Traces to: Auth-US2-AC1
//
// userIsLoggedIn()
// tokenFileExists('~/.eai/tokens.json')
//
// runCommand('eai logout')
//
// expectTokenFileDeleted('~/.eai/tokens.json')
// expectSuccessMessage('Logged out successfully')
```

### Scenario 16: Whoami Shows Current User
**Priority**: P1
**User Story**: As a developer, I want to check my auth status

```javascript
// TC016: Whoami displays current user info
// Traces to: Auth-US3-AC1
//
// userIsLoggedIn({ email: 'dev@company.com', tenant: 'my-tenant' })
// tokenNotExpired()
//
// runCommand('eai whoami')
//
// expectDisplayedMessage('Logged in as: dev@company.com')
// expectDisplayedMessage('Tenant: my-tenant')
// expectDisplayedMessage('Token expiry:')
// expectDisplayedMessage('Status: Active')
```

### Scenario 17: Whoami Shows Expired Token
**Priority**: P1
**User Story**: As a developer, I should know if my token expired

```javascript
// TC017: Whoami shows expired token
// Traces to: Auth-US3-AC2
//
// userIsLoggedIn()
// tokenExpired()
//
// runCommand('eai whoami')
//
// expectWarningMessage('Token expired')
// expectSuggestedFix('Run: eai login')
```

### Scenario 18: Whoami Without Login
**Priority**: P1
**User Story**: As a developer, I should see clear message when not logged in

```javascript
// TC018: Whoami when not logged in
// Traces to: Auth-US3-ERR1
//
// userIsNotLoggedIn()
//
// runCommand('eai whoami')
//
// expectInfoMessage('Not logged in')
// expectSuggestedFix('Run: eai login')
```

### Scenario 19: Auto Token Refresh on API Call
**Priority**: P0
**User Story**: As a developer, expired tokens should refresh automatically

```javascript
// TC019: Token auto-refreshes on API call
// Traces to: Auth-US4-AC1
//
// userIsLoggedIn({ refresh_token: 'refresh123' })
// accessTokenExpired()
// entraTokenEndpointRespondsToRefresh({ access_token: 'new_token', expires_in: 3600 })
//
// runCommand('eai resources list MyType')
//
// expectTokenRefreshCalled()
// expectNewTokenStored('~/.eai/tokens.json')
// expectAPICalledWithNewToken()
// expectCommandSucceeded()
```

### Scenario 20: Login with Custom Scopes
**Priority**: P2
**User Story**: As a developer, I want to request custom OAuth scopes

```javascript
// TC020: Login with custom scopes
// Traces to: Auth-US1-AC3
//
// entraDeviceCodeEndpointResponds()
//
// runCommand('eai login --scope "openid profile email custom.scope"')
//
// expectDeviceCodeRequestIncludesScope('openid profile email custom.scope')
// expectTokenStoredWithScopes(['openid', 'profile', 'email', 'custom.scope'])
```

---

## Category 3: Environment Management (Scenarios 21-30)

### Scenario 21: Pull Environment from Azure App Config
**Priority**: P0
**User Story**: As a developer, I want to sync cloud config to local

```javascript
// TC021: Pull env from Azure App Config
// Traces to: Env-US1-AC1
//
// azureCLIInstalled()
// azureLoggedIn()
// appConfigHasKeys({ BASE_URL_PUBLIC_API: 'https://test-api.example.com', TENANT_DEFAULT_ID: 'tenant-123' })
//
// runCommand('eai env pull')
//
// expectFileWritten('.env.local')
// expectEnvVarSet('.env.local', 'BASE_URL_PUBLIC_API', 'https://test-api.example.com')
// expectEnvVarSet('.env.local', 'TENANT_DEFAULT_ID', 'tenant-123')
// expectSuccessMessage('Pulled N environment variables')
```

### Scenario 22: Pull Environment with Key Vault Secrets
**Priority**: P0
**User Story**: As a developer, I want to resolve Key Vault references

```javascript
// TC022: Pull env with --include-secrets
// Traces to: Env-US1-AC2
//
// azureCLIInstalled()
// keyVaultHasSecret('my-vault', 'auth-secret', 'super-secret-value')
// appConfigHasKeyVaultRef('AUTH_SECRET', 'https://my-vault.vault.azure.net/secrets/auth-secret')
//
// runCommand('eai env pull --include-secrets')
//
// expectKeyVaultSecretFetched('my-vault', 'auth-secret')
// expectEnvVarSet('.env.local', 'AUTH_SECRET', 'super-secret-value')
// expectWarningMessage('Secrets stored in .env.local. Do not commit!')
```

### Scenario 23: Pull Environment for Specific Label
**Priority**: P1
**User Story**: As a developer, I want to pull environment-specific config

```javascript
// TC023: Pull env for specific label
// Traces to: Env-US1-AC3
//
// appConfigHasLabelsFor('my-app', ['dev', 'test', 'prod'])
//
// runCommand('eai env pull --label my-app --env test')
//
// expectAppConfigQueriedWithLabel('my-app', 'test')
// expectEnvFileContains('.env.local', '# Environment: test')
```

### Scenario 24: List Environment Variables
**Priority**: P1
**User Story**: As a developer, I want to see loaded env vars

```javascript
// TC024: List loaded environment variables
// Traces to: Env-US2-AC1
//
// projectHasEnvFile({ BASE_URL_PUBLIC_API: 'https://api.example.com', TENANT_DEFAULT_ID: 'tenant-123' })
//
// runCommand('eai env list')
//
// expectDisplayedMessage('BASE_URL_PUBLIC_API=https://api.example.com')
// expectDisplayedMessage('TENANT_DEFAULT_ID=tenant-123')
// expectSecretsAreMasked('AUTH_SECRET')
```

### Scenario 25: List Environment with Secrets Unmasked
**Priority**: P2
**User Story**: As a developer, I want to view secret values when debugging

```javascript
// TC025: List env with --show-secrets
// Traces to: Env-US2-AC2
//
// projectHasEnvFile({ AUTH_SECRET: 'super-secret-value' })
//
// runCommand('eai env list --show-secrets')
//
// expectDisplayedMessage('AUTH_SECRET=super-secret-value')
// expectWarningMessage('Secrets are visible. Do not share this output.')
```

### Scenario 26: Push Environment to Azure App Config
**Priority**: P1
**User Story**: As a developer, I want to push local overrides to cloud

```javascript
// TC026: Push local env to App Config
// Traces to: Env-US3-AC1
//
// azureCLIInstalled()
// projectHasEnvFile({ CUSTOM_VAR: 'custom-value' })
//
// runCommand('eai env push --label my-app')
//
// expectAppConfigKeySet('CUSTOM_VAR', 'custom-value', 'my-app')
// expectSuccessMessage('Pushed N variables to App Config')
```

### Scenario 27: Push Single Environment Variable
**Priority**: P2
**User Story**: As a developer, I want to push one variable at a time

```javascript
// TC027: Push single env var
// Traces to: Env-US3-AC2
//
// azureCLIInstalled()
// projectHasEnvFile({ SINGLE_VAR: 'value123' })
//
// runCommand('eai env push --label my-app --key SINGLE_VAR')
//
// expectAppConfigKeySet('SINGLE_VAR', 'value123', 'my-app')
// expectOnlyOneKeyPushed()
```

### Scenario 28: Pull Fails - Azure CLI Not Installed
**Priority**: P1
**User Story**: As a developer, I should get clear error if prerequisites missing

```javascript
// TC028: Pull fails when Azure CLI not installed
// Traces to: Env-US1-ERR1
//
// azureCLINotInstalled()
//
// runCommand('eai env pull')
//
// expectCommandFailed()
// expectErrorMessage('Azure CLI is required')
// expectSuggestedFix('Install: https://aka.ms/azure-cli')
// expectExitCode(1)
```

### Scenario 29: Pull Fails - Not Authenticated to Azure
**Priority**: P1
**User Story**: As a developer, I should get prompted to login to Azure

```javascript
// TC029: Pull fails when not authenticated to Azure
// Traces to: Env-US1-ERR2
//
// azureCLIInstalled()
// azureNotLoggedIn()
//
// runCommand('eai env pull')
//
// expectCommandFailed()
// expectErrorMessage('Not authenticated to Azure')
// expectSuggestedFix('Run: az login')
// expectExitCode(1)
```

### Scenario 30: Pull Fails - Key Vault Access Denied
**Priority**: P1
**User Story**: As a developer, I should get clear RBAC error

```javascript
// TC030: Pull fails when Key Vault access denied
// Traces to: Env-US1-ERR3
//
// azureCLIInstalled()
// keyVaultAccessDenied('my-vault')
//
// runCommand('eai env pull --include-secrets')
//
// expectCommandFailed()
// expectErrorMessage('Access denied to Key Vault: my-vault')
// expectSuggestedFix('Request "Key Vault Secrets User" role')
// expectExitCode(1)
```

---

## Category 4: Object Types (Scenarios 31-45)

### Scenario 31: Validate Object Types - All Valid
**Priority**: P0
**User Story**: As a developer, I want to validate my type definitions

```javascript
// TC031: Validate types - all pass
// Traces to: Types-US1-AC1
//
// projectHasValidObjectTypes([
//   { name: 'Customer', displayName: 'Customer', status: 'published' },
//   { name: 'Order', displayName: 'Order', status: 'draft' }
// ])
//
// runCommand('eai types validate')
//
// expectValidationPassed()
// expectSuccessMessage('All types are valid')
// expectNoErrorsOrWarnings()
```

### Scenario 32: Validate Fails - Invalid Name (Not PascalCase)
**Priority**: P0
**User Story**: As a developer, I should get clear error on naming violations

```javascript
// TC032: Validate fails on non-PascalCase name
// Traces to: Types-US1-ERR1
//
// projectHasObjectType({ name: 'customer_record', displayName: 'Customer' })
//
// runCommand('eai types validate')
//
// expectValidationFailed()
// expectErrorMessage('Type name "customer_record" must be PascalCase')
// expectSuggestedFix('Rename to "CustomerRecord"')
// expectExitCode(1)
```

### Scenario 33: Validate Fails - Missing displayName
**Priority**: P0
**User Story**: As a developer, I should be required to provide displayName

```javascript
// TC033: Validate fails when displayName missing
// Traces to: Types-US1-ERR2
//
// projectHasObjectType({ name: 'Customer', status: 'published' })
//
// runCommand('eai types validate')
//
// expectValidationFailed()
// expectErrorMessage('Type "Customer" missing required field: displayName')
// expectExitCode(1)
```

### Scenario 34: Validate Fails - Invalid Property Type
**Priority**: P1
**User Story**: As a developer, I should only use supported property types

```javascript
// TC034: Validate fails on invalid property type
// Traces to: Types-US1-ERR3
//
// projectHasObjectType({
//   name: 'Product',
//   displayName: 'Product',
//   properties: [{ name: 'price', type: 'currency', required: true }]
// })
//
// runCommand('eai types validate')
//
// expectValidationFailed()
// expectErrorMessage('Invalid property type "currency". Allowed: text, number, boolean, date, select, json, file, relationship')
```

### Scenario 35: Validate Fails - Invalid Link Cardinality
**Priority**: P1
**User Story**: As a developer, I should use valid cardinality

```javascript
// TC035: Validate fails on invalid cardinality
// Traces to: Types-US1-ERR4
//
// projectHasObjectType({
//   name: 'Order',
//   displayName: 'Order',
//   linkTypes: [{ name: 'customer', targetObjectType: 'Customer', cardinality: 'many-to-some' }]
// })
//
// runCommand('eai types validate')
//
// expectValidationFailed()
// expectErrorMessage('Invalid cardinality "many-to-some". Allowed: one-to-one, one-to-many, many-to-one, many-to-many')
```

### Scenario 36: Seed Object Types to Platform
**Priority**: P0
**User Story**: As a developer, I want to publish types to the platform

```javascript
// TC036: Seed types to platform
// Traces to: Types-US2-AC1
//
// userIsLoggedIn()
// projectHasValidObjectTypes([
//   { name: 'Customer', displayName: 'Customer', status: 'published' }
// ])
// publicAPIReachable()
// tenantConfigured('my-vertical')
//
// runCommand('eai types seed')
//
// expectAPICalledPOST('/object-types', { name: 'Customer', tenant: 'my-vertical' })
// expectSuccessMessage('Seeded 1 type(s) to platform')
```

### Scenario 37: Seed Updates Existing Types
**Priority**: P0
**User Story**: As a developer, updates should PATCH existing types

```javascript
// TC037: Seed updates existing types
// Traces to: Types-US2-AC2
//
// userIsLoggedIn()
// typeExistsOnPlatform('Customer', 'type-id-123', { version: 1 })
// projectHasObjectType({ name: 'Customer', displayName: 'Customer Updated' })
//
// runCommand('eai types seed')
//
// expectAPICalledGET('/object-types', { where: { name: { equals: 'Customer' } } })
// expectAPICalledPATCH('/object-types/type-id-123', { displayName: 'Customer Updated' })
// expectSuccessMessage('Updated 1 type(s)')
```

### Scenario 38: Seed with Dry Run
**Priority**: P1
**User Story**: As a developer, I want to preview what would be seeded

```javascript
// TC038: Seed with --dry-run flag
// Traces to: Types-US2-AC3
//
// projectHasValidObjectTypes([
//   { name: 'Customer', displayName: 'Customer' },
//   { name: 'Order', displayName: 'Order' }
// ])
//
// runCommand('eai types seed --dry-run')
//
// expectDisplayedMessage('Would create: Customer')
// expectDisplayedMessage('Would create: Order')
// expectNoAPICallsMade()
```

### Scenario 39: Seed for Specific Tenant
**Priority**: P1
**User Story**: As a developer, I want to seed to one tenant only

```javascript
// TC039: Seed for specific tenant
// Traces to: Types-US2-AC4
//
// projectHasMultiTenantConfig(['app', 'app-staff'])
// projectHasValidObjectTypes({ name: 'Customer', displayName: 'Customer' })
//
// runCommand('eai types seed --tenant-key app-staff')
//
// expectAPICalledWithTenant('app-staff')
// expectOnlyOneTenantSeeded('app-staff')
```

### Scenario 40: Seed Fails - Not Authenticated
**Priority**: P1
**User Story**: As a developer, I should be prompted to login

```javascript
// TC040: Seed fails when not authenticated
// Traces to: Types-US2-ERR1
//
// userIsNotLoggedIn()
// projectHasValidObjectTypes()
//
// runCommand('eai types seed')
//
// expectCommandFailed()
// expectErrorMessage('Not authenticated')
// expectSuggestedFix('Run: eai login')
// expectExitCode(1)
```

### Scenario 41: Diff Shows Local vs Remote Changes
**Priority**: P1
**User Story**: As a developer, I want to see what changed

```javascript
// TC041: Diff shows added/removed properties
// Traces to: Types-US3-AC1
//
// typeExistsOnPlatform('Customer', 'id-123', {
//   properties: [{ name: 'email', type: 'text' }]
// })
// projectHasObjectType('Customer', {
//   properties: [{ name: 'email', type: 'text' }, { name: 'phone', type: 'text' }]
// })
//
// runCommand('eai types diff')
//
// expectDisplayedMessage('Type: Customer')
// expectDisplayedMessage('+ Added: phone (text)')
// expectDisplayedMessage('  Unchanged: email (text)')
```

### Scenario 42: Diff Shows No Changes
**Priority**: P2
**User Story**: As a developer, I want confirmation when in sync

```javascript
// TC042: Diff shows no changes
// Traces to: Types-US3-AC2
//
// typeExistsOnPlatform('Customer', 'id-123', {
//   properties: [{ name: 'email', type: 'text' }]
// })
// projectHasObjectType('Customer', {
//   properties: [{ name: 'email', type: 'text' }]
// })
//
// runCommand('eai types diff')
//
// expectInfoMessage('No differences found')
```

### Scenario 43: Pull Remote Types to Local File
**Priority**: P1
**User Story**: As a developer, I want to download platform types

```javascript
// TC043: Pull remote types to local file
// Traces to: Types-US4-AC1
//
// userIsLoggedIn()
// platformHasTypes(['Customer', 'Order'], 'my-vertical')
//
// runCommand('eai types pull')
//
// expectFileWritten('src/eai.config/object-types.generated.ts')
// expectFileContains('object-types.generated.ts', 'export const Customer')
// expectFileContains('object-types.generated.ts', 'export const Order')
// expectSuccessMessage('Pulled 2 types')
```

### Scenario 44: Pull to Custom Output Path
**Priority**: P2
**User Story**: As a developer, I want to specify output location

```javascript
// TC044: Pull to custom output path
// Traces to: Types-US4-AC2
//
// userIsLoggedIn()
// platformHasTypes(['Customer'])
//
// runCommand('eai types pull --output src/types/platform.ts')
//
// expectFileWritten('src/types/platform.ts')
// expectSuccessMessage('Pulled 1 type(s) to src/types/platform.ts')
```

### Scenario 45: Seed with JSON Output
**Priority**: P2
**User Story**: As a developer, I want machine-readable output for CI

```javascript
// TC045: Seed with --json flag
// Traces to: Types-US2-AC5
//
// projectHasValidObjectTypes([{ name: 'Customer', displayName: 'Customer' }])
// userIsLoggedIn()
//
// runCommand('eai types seed --json')
//
// expectJSONOutput()
// expectJSONContains({ success: true, created: 1, updated: 0 })
```

---

## Category 5: Resources CRUD (Scenarios 46-60)

### Scenario 46: List Resources with Pagination
**Priority**: P0
**User Story**: As a developer, I want to browse resources

```javascript
// TC046: List resources with pagination
// Traces to: Resources-US1-AC1
//
// userIsLoggedIn()
// tenantHasResources('Customer', 50)
//
// runCommand('eai resources list Customer --page 1 --limit 20')
//
// expectAPICalledGET('/v3/resources/{tenantId}/Customer?page=1&limit=20')
// expectDisplayed20Resources()
// expectDisplayedMessage('Page 1 of 3')
// expectDisplayedMessage('Total: 50 resources')
```

### Scenario 47: List Resources with Sorting
**Priority**: P1
**User Story**: As a developer, I want to sort by field

```javascript
// TC047: List resources with sort
// Traces to: Resources-US1-AC2
//
// userIsLoggedIn()
// tenantHasResources('Order', 10)
//
// runCommand('eai resources list Order --sort -created_at')
//
// expectAPICalledGET('/v3/resources/{tenantId}/Order?sort=-created_at')
// expectResourcesSortedBy('created_at', 'desc')
```

### Scenario 48: Get Single Resource by ID
**Priority**: P0
**User Story**: As a developer, I want to view a resource

```javascript
// TC048: Get single resource
// Traces to: Resources-US2-AC1
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123', { data: { name: 'Acme Corp', email: 'acme@example.com' } })
//
// runCommand('eai resources get Customer cust-123')
//
// expectAPICalledGET('/v3/resources/{tenantId}/Customer/cust-123')
// expectDisplayedMessage('ID: cust-123')
// expectDisplayedMessage('Name: Acme Corp')
// expectDisplayedMessage('Email: acme@example.com')
```

### Scenario 49: Get Resource with JSON Output
**Priority**: P1
**User Story**: As a developer, I want machine-readable output

```javascript
// TC049: Get resource with --json flag
// Traces to: Resources-US2-AC2
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123', { data: { name: 'Acme' } })
//
// runCommand('eai resources get Customer cust-123 --json')
//
// expectJSONOutput()
// expectJSONContains({ id: 'cust-123', data: { name: 'Acme' } })
```

### Scenario 50: Create Resource from JSON Data
**Priority**: P0
**User Story**: As a developer, I want to create a resource

```javascript
// TC050: Create resource with --data
// Traces to: Resources-US3-AC1
//
// userIsLoggedIn()
// typePublished('Customer')
//
// runCommand('eai resources create Customer --data \'{"name":"New Corp","email":"new@example.com"}\'')
//
// expectAPICalledPOST('/v3/resources/{tenantId}/Customer', {
//   data: { name: 'New Corp', email: 'new@example.com' }
// })
// expectSuccessMessage('Created resource: cust-new-id')
```

### Scenario 51: Create Resource from File
**Priority**: P1
**User Story**: As a developer, I want to load data from file

```javascript
// TC051: Create resource with --file
// Traces to: Resources-US3-AC2
//
// userIsLoggedIn()
// fileExists('customer.json', { name: 'File Corp', email: 'file@example.com' })
//
// runCommand('eai resources create Customer --file customer.json')
//
// expectFileRead('customer.json')
// expectAPICalledPOST('/v3/resources/{tenantId}/Customer', {
//   data: { name: 'File Corp', email: 'file@example.com' }
// })
```

### Scenario 52: Create Fails - Invalid Data
**Priority**: P1
**User Story**: As a developer, I should see validation errors

```javascript
// TC052: Create fails on invalid data
// Traces to: Resources-US3-ERR1
//
// userIsLoggedIn()
// publicAPIReturns400({ error: 'Missing required field: email' })
//
// runCommand('eai resources create Customer --data \'{"name":"No Email"}\'')
//
// expectCommandFailed()
// expectErrorMessage('Missing required field: email')
// expectExitCode(1)
```

### Scenario 53: Update Resource with Version Locking
**Priority**: P0
**User Story**: As a developer, I want optimistic locking

```javascript
// TC053: Update resource with version
// Traces to: Resources-US4-AC1
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123', { version: 3 })
//
// runCommand('eai resources update Customer cust-123 --data \'{"status":"active"}\' --version 3')
//
// expectAPICalledPUT('/v3/resources/{tenantId}/Customer/cust-123', {
//   data: { status: 'active' },
//   version: 3
// })
// expectSuccessMessage('Updated resource: cust-123')
```

### Scenario 54: Update Auto-Fetches Version
**Priority**: P1
**User Story**: As a developer, version should be optional

```javascript
// TC054: Update auto-fetches version if omitted
// Traces to: Resources-US4-AC2
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123', { version: 5 })
//
// runCommand('eai resources update Customer cust-123 --data \'{"status":"active"}\'')
//
// expectAPICalledGET('/v3/resources/{tenantId}/Customer/cust-123')
// expectAPICalledPUT('/v3/resources/{tenantId}/Customer/cust-123', {
//   version: 5
// })
```

### Scenario 55: Update Fails - Version Mismatch
**Priority**: P1
**User Story**: As a developer, I should get conflict error

```javascript
// TC055: Update fails on version mismatch
// Traces to: Resources-US4-ERR1
//
// userIsLoggedIn()
// publicAPIReturns409({ error: 'Version mismatch. Expected 5, got 3.' })
//
// runCommand('eai resources update Customer cust-123 --data \'{"status":"active"}\' --version 3')
//
// expectCommandFailed()
// expectErrorMessage('Version mismatch')
// expectSuggestedFix('Fetch latest version or omit --version flag')
// expectExitCode(1)
```

### Scenario 56: Delete Resource with Confirmation
**Priority**: P0
**User Story**: As a developer, I should confirm delete

```javascript
// TC056: Delete resource with confirmation
// Traces to: Resources-US5-AC1
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123')
//
// runCommand('eai resources delete Customer cust-123')
// respondToPrompt('Confirm delete', 'yes')
//
// expectAPICalledDELETE('/v3/resources/{tenantId}/Customer/cust-123')
// expectSuccessMessage('Deleted resource: cust-123')
```

### Scenario 57: Delete Resource with Force Flag
**Priority**: P1
**User Story**: As a developer, I want to skip confirmation

```javascript
// TC057: Delete resource with --force
// Traces to: Resources-US5-AC2
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123')
//
// runCommand('eai resources delete Customer cust-123 --force')
//
// expectNoPrompts()
// expectAPICalledDELETE('/v3/resources/{tenantId}/Customer/cust-123')
```

### Scenario 58: Delete Cancelled by User
**Priority**: P1
**User Story**: As a developer, I can cancel delete

```javascript
// TC058: Delete cancelled on confirmation
// Traces to: Resources-US5-AC3
//
// userIsLoggedIn()
// resourceExists('Customer', 'cust-123')
//
// runCommand('eai resources delete Customer cust-123')
// respondToPrompt('Confirm delete', 'no')
//
// expectInfoMessage('Delete cancelled')
// expectNoAPICallsMade()
```

### Scenario 59: Query Resources Across Types
**Priority**: P1
**User Story**: As a developer, I want cross-type queries

```javascript
// TC059: Query across multiple types
// Traces to: Resources-US6-AC1
//
// userIsLoggedIn()
// tenantHasTypes(['Customer', 'Order'])
//
// runCommand('eai resources query --types Customer,Order --where \'{"status":{"equals":"active"}}\' --limit 50')
//
// expectAPICalledPOST('/v3/resources/{tenantId}/query', {
//   object_types: ['Customer', 'Order'],
//   where: { status: { equals: 'active' } },
//   limit: 50
// })
// expectResourcesFromMultipleTypes()
```

### Scenario 60: Get Resource Schema
**Priority**: P2
**User Story**: As a developer, I want to see available types

```javascript
// TC060: Get resource schema
// Traces to: Resources-US7-AC1
//
// userIsLoggedIn()
// tenantHasPublishedTypes(['Customer', 'Order', 'Product'])
//
// runCommand('eai resources schema')
//
// expectAPICalledGET('/v3/resources/schema/{tenantId}')
// expectDisplayedMessage('Published types: Customer, Order, Product')
```

---

## Category 6: Multi-Tenant (Scenarios 61-70)

### Scenario 61: List All Tenants
**Priority**: P1
**User Story**: As a developer, I want to view all tenants

```javascript
// TC061: List all tenants
// Traces to: Tenant-US1-AC1
//
// userIsLoggedIn()
// platformHasTenants([
//   { id: 't1', name: 'Acme Corp', slug: 'acme-corp' },
//   { id: 't2', name: 'Beta Inc', slug: 'beta-inc' }
// ])
//
// runCommand('eai tenant list')
//
// expectAPICalledGET('/tenants')
// expectDisplayedMessage('Acme Corp (acme-corp)')
// expectDisplayedMessage('Beta Inc (beta-inc)')
```

### Scenario 62: List Tenants by Parent
**Priority**: P1
**User Story**: As a developer, I want to filter by parent

```javascript
// TC062: List tenants by parent
// Traces to: Tenant-US1-AC2
//
// userIsLoggedIn()
// tenantHasChildren('parent-id', ['child-1', 'child-2'])
//
// runCommand('eai tenant list --parent parent-id')
//
// expectAPICalledGET('/tenants', { where: { parent: { equals: 'parent-id' } } })
// expectDisplayedTenants(['child-1', 'child-2'])
```

### Scenario 63: Get Tenant Info
**Priority**: P1
**User Story**: As a developer, I want detailed tenant info

```javascript
// TC063: Get single tenant info
// Traces to: Tenant-US2-AC1
//
// userIsLoggedIn()
// tenantExists('tenant-123', {
//   name: 'Acme Corp',
//   slug: 'acme-corp',
//   domain: ['acme.com', 'acme-dev.com']
// })
//
// runCommand('eai tenant info tenant-123')
//
// expectAPICalledGET('/tenants/tenant-123')
// expectDisplayedMessage('Name: Acme Corp')
// expectDisplayedMessage('Slug: acme-corp')
// expectDisplayedMessage('Domains: acme.com, acme-dev.com')
```

### Scenario 64: Create New Tenant
**Priority**: P1
**User Story**: As a developer, I want to create a tenant

```javascript
// TC064: Create tenant
// Traces to: Tenant-US3-AC1
//
// userIsLoggedIn()
//
// runCommand('eai tenant create --name "New Corp" --slug new-corp --domain new-corp.com')
//
// expectAPICalledPOST('/tenants', {
//   name: 'New Corp',
//   slug: 'new-corp',
//   domain: ['new-corp.com']
// })
// expectSuccessMessage('Created tenant: new-corp')
```

### Scenario 65: Create Tenant with Parent
**Priority**: P1
**User Story**: As a developer, I want to create child tenant

```javascript
// TC065: Create tenant with parent
// Traces to: Tenant-US3-AC2
//
// userIsLoggedIn()
// tenantExists('parent-id')
//
// runCommand('eai tenant create --name "Child Tenant" --slug child-tenant --parent parent-id')
//
// expectAPICalledPOST('/tenants', {
//   name: 'Child Tenant',
//   slug: 'child-tenant',
//   parent: 'parent-id'
// })
```

### Scenario 66: Create Fails - Duplicate Slug
**Priority**: P1
**User Story**: As a developer, I should see conflict error

```javascript
// TC066: Create tenant fails on duplicate slug
// Traces to: Tenant-US3-ERR1
//
// userIsLoggedIn()
// tenantExistsWithSlug('acme-corp')
// publicAPIReturns409({ error: 'Slug "acme-corp" already exists' })
//
// runCommand('eai tenant create --name "Acme" --slug acme-corp')
//
// expectCommandFailed()
// expectErrorMessage('Slug "acme-corp" already exists')
// expectExitCode(1)
```

### Scenario 67: Seed Types to Multi-Tenant Project
**Priority**: P0
**User Story**: As a developer, I want to seed to all tenants

```javascript
// TC067: Seed types to all tenants
// Traces to: Types-US2-MT1
//
// userIsLoggedIn()
// projectHasMultiTenantConfig(['app', 'app-staff', 'app-admin'])
// projectHasValidObjectTypes([{ name: 'Customer', displayName: 'Customer' }])
//
// runCommand('eai types seed')
//
// expectAPICalledForTenant('app', 'Customer')
// expectAPICalledForTenant('app-staff', 'Customer')
// expectAPICalledForTenant('app-admin', 'Customer')
// expectSuccessMessage('Seeded to 3 tenants')
```

### Scenario 68: Query Resources from Specific Tenant
**Priority**: P1
**User Story**: As a developer, I want tenant-scoped queries

```javascript
// TC068: Query resources with tenant override
// Traces to: Resources-US6-MT1
//
// userIsLoggedIn()
// projectHasMultiTenantConfig(['app', 'app-staff'])
// setEnvVar('TENANT_DEFAULT_ID', 'app-id')
//
// runCommand('eai resources list Customer')
//
// expectAPICalledWithTenantID('app-id')
// expectResourcesFromTenant('app-id')
```

### Scenario 69: Invite User to Tenant
**Priority**: P1
**User Story**: As a developer, I want to provision users

```javascript
// TC069: Invite user to tenant
// Traces to: User-US1-AC1
//
// userIsLoggedIn()
// entraUserExists('new.user@company.com', 'user-oid-123')
//
// runCommand('eai user invite --email new.user@company.com --tenant tenant-id')
//
// expectAPICalledGET('/custom-users/by-email?email=new.user@company.com')
// expectAPICalledPOST('/custom-users/provisionme', {
//   tenant_id: 'tenant-id',
//   user_oid: 'user-oid-123'
// })
// expectSuccessMessage('User new.user@company.com invited to tenant')
```

### Scenario 70: Invite Fails - User Not Found
**Priority**: P1
**User Story**: As a developer, I should see clear error

```javascript
// TC070: Invite fails when user not found
// Traces to: User-US1-ERR1
//
// userIsLoggedIn()
// entraUserNotFound('unknown@company.com')
// publicAPIReturns404({ error: 'User not found' })
//
// runCommand('eai user invite --email unknown@company.com --tenant tenant-id')
//
// expectCommandFailed()
// expectErrorMessage('User not found: unknown@company.com')
// expectSuggestedFix('Ensure user exists in Entra ID')
// expectExitCode(1)
```

---

## Category 7: AI & Chat (Scenarios 71-78)

### Scenario 71: Send Chat Message
**Priority**: P1
**User Story**: As a developer, I want to send AI messages

```javascript
// TC071: Send chat message
// Traces to: Chat-US1-AC1
//
// userIsLoggedIn()
// workflowExists('workflow-123')
//
// runCommand('eai chat send "What is the status?" --workflow workflow-123')
//
// expectAPICalledPOST('/v3/chat/{tenantId}/workflow-123/chat', {
//   message: 'What is the status?',
//   conversation_id: expectUUID()
// })
// expectDisplayedMessage('Response: The status is...')
```

### Scenario 72: Stream Chat Message
**Priority**: P1
**User Story**: As a developer, I want streaming responses

```javascript
// TC072: Stream chat message
// Traces to: Chat-US1-AC2
//
// userIsLoggedIn()
// workflowExists('workflow-123')
// serverSentEventsWillReturn(['data: {"content":"Hello "}', 'data: {"content":"world"}', 'data: [DONE]'])
//
// runCommand('eai chat stream "Hello" --workflow workflow-123')
//
// expectSSEStreamOpened('/v3/chat/stream/{tenantId}/workflow-123/chat')
// expectStreamedOutput('Hello world')
// expectStreamStoppedOn('[DONE]')
```

### Scenario 73: Chat with Custom Conversation ID
**Priority**: P2
**User Story**: As a developer, I want to continue conversations

```javascript
// TC073: Chat with custom conversation ID
// Traces to: Chat-US1-AC3
//
// userIsLoggedIn()
// conversationExists('conv-456')
//
// runCommand('eai chat send "Follow up" --workflow workflow-123 --conversation conv-456')
//
// expectAPICalledWithConversationID('conv-456')
// expectConversationContextPreserved()
```

### Scenario 74: Chat with Custom Stage
**Priority**: P2
**User Story**: As a developer, I want multi-stage workflows

```javascript
// TC074: Chat with custom stage
// Traces to: Chat-US1-AC4
//
// userIsLoggedIn()
// workflowHasStages(['intake', 'analysis', 'response'])
//
// runCommand('eai chat send "Analyze this" --workflow workflow-123 --stage analysis')
//
// expectAPICalledPOST('/v3/chat/{tenantId}/workflow-123/analysis')
```

### Scenario 75: Chat Fails - Workflow Not Found
**Priority**: P1
**User Story**: As a developer, I should see clear error

```javascript
// TC075: Chat fails when workflow not found
// Traces to: Chat-US1-ERR1
//
// userIsLoggedIn()
// publicAPIReturns404({ error: 'Workflow not found' })
//
// runCommand('eai chat send "Hello" --workflow invalid-workflow')
//
// expectCommandFailed()
// expectErrorMessage('Workflow not found: invalid-workflow')
// expectSuggestedFix('Check WORKFLOW_*_ID in .env.local')
// expectExitCode(1)
```

### Scenario 76: Chat Fails - No Workflow ID Configured
**Priority**: P1
**User Story**: As a developer, I should be prompted to configure

```javascript
// TC076: Chat fails when no workflow ID
// Traces to: Chat-US1-ERR2
//
// userIsLoggedIn()
// projectHasNoWorkflowID()
//
// runCommand('eai chat send "Hello"')
//
// expectCommandFailed()
// expectErrorMessage('No workflow ID configured')
// expectSuggestedFix('Set WORKFLOW_DEFAULT_ID or WORKFLOW_{APP}_ID in .env.local')
// expectExitCode(1)
```

### Scenario 77: Stream Fails - SSE Parsing Error
**Priority**: P2
**User Story**: As a developer, I should see parse errors

```javascript
// TC077: Stream fails on invalid SSE
// Traces to: Chat-US1-ERR3
//
// userIsLoggedIn()
// serverSentEventsWillReturn(['invalid json'])
//
// runCommand('eai chat stream "Hello" --workflow workflow-123')
//
// expectCommandFailed()
// expectErrorMessage('Failed to parse SSE stream')
// expectPartialOutputDisplayed()
```

### Scenario 78: Chat Auto-Generates Conversation ID
**Priority**: P2
**User Story**: As a developer, conversation ID should be optional

```javascript
// TC078: Chat auto-generates conversation ID
// Traces to: Chat-US1-AC5
//
// userIsLoggedIn()
//
// runCommand('eai chat send "Hello" --workflow workflow-123')
//
// expectAPICalledWithConversationID(expectUUID())
// expectConversationIDLogged()
```

---

## Category 8: Documents (Scenarios 79-83)

### Scenario 79: Upload Document
**Priority**: P1
**User Story**: As a developer, I want to upload files

```javascript
// TC079: Upload document
// Traces to: Docs-US1-AC1
//
// userIsLoggedIn()
// fileExists('/tmp/contract.pdf')
//
// runCommand('eai docs upload /tmp/contract.pdf')
//
// expectAPICalledPOST('/v3/documents/upload', FormData({ file: '/tmp/contract.pdf' }))
// expectSuccessMessage('Uploaded document: doc-id-123')
```

### Scenario 80: Upload Fails - File Not Found
**Priority**: P1
**User Story**: As a developer, I should see clear file error

```javascript
// TC080: Upload fails when file not found
// Traces to: Docs-US1-ERR1
//
// userIsLoggedIn()
// fileNotExists('/tmp/missing.pdf')
//
// runCommand('eai docs upload /tmp/missing.pdf')
//
// expectCommandFailed()
// expectErrorMessage('File not found: /tmp/missing.pdf')
// expectExitCode(1)
```

### Scenario 81: Classify Document
**Priority**: P2
**User Story**: As a developer, I want AI classification

```javascript
// TC081: Classify document
// Traces to: Docs-US2-AC1
//
// userIsLoggedIn()
// fileExists('/tmp/invoice.pdf')
// publicAPIReturnsClassification({ category: 'invoice', confidence: 0.95 })
//
// runCommand('eai docs classify /tmp/invoice.pdf')
//
// expectAPICalledPOST('/v3/documents/classify', FormData({ file: '/tmp/invoice.pdf' }))
// expectDisplayedMessage('Category: invoice')
// expectDisplayedMessage('Confidence: 95%')
```

### Scenario 82: Index Document for RAG
**Priority**: P2
**User Story**: As a developer, I want to index docs

```javascript
// TC082: Index document for RAG
// Traces to: Docs-US3-AC1
//
// userIsLoggedIn()
// documentExists('doc-id-123')
//
// runCommand('eai docs index doc-id-123')
//
// expectAPICalledPOST('/v3/documents/rag-index', { document_id: 'doc-id-123' })
// expectSuccessMessage('Document indexed for RAG')
```

### Scenario 83: Index Fails - Document Not Found
**Priority**: P2
**User Story**: As a developer, I should see clear error

```javascript
// TC083: Index fails when document not found
// Traces to: Docs-US3-ERR1
//
// userIsLoggedIn()
// publicAPIReturns404({ error: 'Document not found' })
//
// runCommand('eai docs index invalid-doc-id')
//
// expectCommandFailed()
// expectErrorMessage('Document not found: invalid-doc-id')
// expectExitCode(1)
```

---

## Category 9: Deployment (Scenarios 84-91)

### Scenario 84: Setup Deployment Workflow
**Priority**: P1
**User Story**: As a developer, I want CI/CD setup

```javascript
// TC084: Setup deployment workflow
// Traces to: Deploy-US1-AC1
//
// projectIsGitRepo()
// gitHubRepoExists('org/my-app')
//
// runCommand('eai deploy setup --repo org/my-app')
//
// expectFileCreated('.github/workflows/deploy-demo.yml')
// expectWorkflowHasJob('build-and-deploy')
// expectWorkflowHasStep('Deploy to Azure App Service')
// expectDisplayedSecretsNeeded([
//   'AZUREAPPSERVICE_CLIENTID',
//   'AZUREAPPSERVICE_TENANTID',
//   'AZUREAPPSERVICE_SUBSCRIPTIONID',
//   'AZURE_RESOURCE_GROUP',
//   'AZURE_WEBAPP_NAME'
// ])
```

### Scenario 85: Trigger Deployment Workflow
**Priority**: P1
**User Story**: As a developer, I want to trigger deploys

```javascript
// TC085: Trigger deployment
// Traces to: Deploy-US2-AC1
//
// gitHubCLIInstalled()
// gitRepoHasRemote('origin', 'https://github.com/org/my-app.git')
// workflowExists('deploy-demo.yml')
//
// runCommand('eai deploy trigger')
//
// expectGitHubCLICalled('gh workflow run deploy-demo.yml --repo org/my-app --ref main')
// expectSuccessMessage('Deployment triggered')
```

### Scenario 86: Trigger with Custom Branch
**Priority**: P2
**User Story**: As a developer, I want to deploy from branch

```javascript
// TC086: Trigger deployment from branch
// Traces to: Deploy-US2-AC2
//
// gitHubCLIInstalled()
// gitRepoHasRemote('origin', 'https://github.com/org/my-app.git')
//
// runCommand('eai deploy trigger --branch feature-x')
//
// expectGitHubCLICalled('gh workflow run deploy-demo.yml --ref feature-x')
```

### Scenario 87: Check Deployment Status
**Priority**: P1
**User Story**: As a developer, I want to see run status

```javascript
// TC087: Check deployment status
// Traces to: Deploy-US3-AC1
//
// gitHubCLIInstalled()
// gitHubWorkflowRunsExist([
//   { id: 'run-1', status: 'completed', conclusion: 'success' },
//   { id: 'run-2', status: 'in_progress' }
// ])
//
// runCommand('eai deploy status')
//
// expectGitHubCLICalled('gh run list --workflow deploy-demo.yml')
// expectDisplayedMessage('run-1: completed (success)')
// expectDisplayedMessage('run-2: in_progress')
```

### Scenario 88: Trigger Fails - GitHub CLI Not Installed
**Priority**: P1
**User Story**: As a developer, I should see prerequisite error

```javascript
// TC088: Trigger fails when gh CLI not found
// Traces to: Deploy-US2-ERR1
//
// gitHubCLINotInstalled()
//
// runCommand('eai deploy trigger')
//
// expectCommandFailed()
// expectErrorMessage('GitHub CLI (gh) is required')
// expectSuggestedFix('Install: https://cli.github.com/')
// expectExitCode(1)
```

### Scenario 89: Trigger Fails - Not a Git Repo
**Priority**: P1
**User Story**: As a developer, I should see git error

```javascript
// TC089: Trigger fails when not a git repo
// Traces to: Deploy-US2-ERR2
//
// gitHubCLIInstalled()
// projectIsNotGitRepo()
//
// runCommand('eai deploy trigger')
//
// expectCommandFailed()
// expectErrorMessage('Not a git repository')
// expectSuggestedFix('Run: git init && git remote add origin <url>')
// expectExitCode(1)
```

### Scenario 90: Trigger Fails - No Remote Origin
**Priority**: P1
**User Story**: As a developer, I should see remote error

```javascript
// TC090: Trigger fails when no remote origin
// Traces to: Deploy-US2-ERR3
//
// gitHubCLIInstalled()
// projectIsGitRepo()
// gitRepoHasNoRemote('origin')
//
// runCommand('eai deploy trigger')
//
// expectCommandFailed()
// expectErrorMessage('No remote "origin" found')
// expectSuggestedFix('Run: git remote add origin <url>')
// expectExitCode(1)
```

### Scenario 91: Setup Generates Secrets Instructions
**Priority**: P2
**User Story**: As a developer, I want copy-paste commands

```javascript
// TC091: Setup provides gh secret set commands
// Traces to: Deploy-US1-AC2
//
// projectIsGitRepo()
//
// runCommand('eai deploy setup --repo org/my-app')
//
// expectDisplayedMessage('gh secret set AZUREAPPSERVICE_CLIENTID')
// expectDisplayedMessage('gh secret set AZUREAPPSERVICE_TENANTID')
// expectDisplayedMessage('gh secret set AZUREAPPSERVICE_SUBSCRIPTIONID')
// expectCopyableCommands()
```

---

## Category 10: Diagnostics (Scenarios 92-96)

### Scenario 92: Verify All Checks Pass
**Priority**: P1
**User Story**: As a developer, I want to verify setup

```javascript
// TC092: Verify all checks pass
// Traces to: Verify-US1-AC1
//
// userIsLoggedIn()
// publicAPIReachable()
// projectHasValidObjectTypes()
// tenantConfigured()
//
// runCommand('eai verify')
//
// expectCheckPassed('PublicAPI reachable')
// expectCheckPassed('Authentication status')
// expectCheckPassed('Platform service reachable')
// expectCheckPassed('Data service schema')
// expectCheckPassed('Local Object Types loadable')
// expectSuccessMessage('All checks passed')
```

### Scenario 93: Verify Fails - PublicAPI Unreachable
**Priority**: P1
**User Story**: As a developer, I should see connectivity errors

```javascript
// TC093: Verify fails on API unreachable
// Traces to: Verify-US1-ERR1
//
// publicAPIUnreachable()
//
// runCommand('eai verify')
//
// expectCheckFailed('PublicAPI reachable')
// expectErrorMessage('Unable to reach PublicAPI')
// expectSuggestedFix('Check BASE_URL_PUBLIC_API in .env.local')
// expectRemainingChecksSkipped()
```

### Scenario 94: Doctor Shows Comprehensive Diagnostics
**Priority**: P1
**User Story**: As a developer, I want detailed health check

```javascript
// TC094: Doctor runs all diagnostics
// Traces to: Doctor-US1-AC1
//
// projectRootDetected()
// envFileExists()
// requiredEnvVarsSet()
// userIsLoggedIn()
// objectTypesLoadable()
// deploymentWorkflowExists()
// dependenciesInstalled()
//
// runCommand('eai doctor')
//
// expectCheckPassed('Project root detected', 'info')
// expectCheckPassed('.env.local exists', 'info')
// expectCheckPassed('Required env vars set', 'info')
// expectCheckPassed('Authentication status', 'info')
// expectCheckPassed('Object Types loadable', 'info')
// expectCheckPassed('Deployment workflow exists', 'info')
// expectCheckPassed('Dependencies installed', 'info')
// expectSuccessMessage('No issues found')
```

### Scenario 95: Doctor Shows Errors and Warnings
**Priority**: P1
**User Story**: As a developer, I want actionable fixes

```javascript
// TC095: Doctor shows issues with suggested fixes
// Traces to: Doctor-US1-AC2
//
// projectRootDetected()
// envFileHasPlaceholders()
// tokenExpired()
// objectTypesSyntaxError()
//
// runCommand('eai doctor')
//
// expectCheckWarning('.env.local has placeholders', 'Run: eai env pull --include-secrets')
// expectCheckError('Authentication expired', 'Run: eai login')
// expectCheckError('Object Types not loadable', 'Fix syntax errors in src/eai.config/object-types.ts')
// expectSeveritySummary({ errors: 2, warnings: 1, info: 5 })
```

### Scenario 96: Doctor Outside Project
**Priority**: P2
**User Story**: As a developer, doctor should work anywhere

```javascript
// TC096: Doctor runs outside project
// Traces to: Doctor-US1-AC3
//
// notInEAIProject()
//
// runCommand('eai doctor')
//
// expectCheckFailed('Project root detected')
// expectInfoMessage('Not in an EAI project')
// expectCheckSkipped('Object Types loadable')
// expectLimitedDiagnostics()
```

---

## Category 11: CLI Updates (Scenarios 97-100)

### Scenario 97: Check for Updates
**Priority**: P2
**User Story**: As a developer, I want to know about updates

```javascript
// TC097: Check for CLI updates
// Traces to: Update-US1-AC1
//
// currentVersion('0.1.4')
// registryHasVersion('0.2.0')
//
// runCommand('eai update --check')
//
// expectRegistryFetched('https://eai-tools.github.io/eai-cli/registry')
// expectDisplayedMessage('Current version: 0.1.4')
// expectDisplayedMessage('Latest version: 0.2.0')
// expectDisplayedMessage('Update available')
// expectNoInstallTriggered()
```

### Scenario 98: Update to Latest Version
**Priority**: P2
**User Story**: As a developer, I want to update CLI

```javascript
// TC098: Update to latest version
// Traces to: Update-US1-AC2
//
// currentVersion('0.1.4')
// registryHasVersion('0.2.0')
//
// runCommand('eai update')
// respondToPrompt('Install v0.2.0?', 'yes')
//
// expectNPMCalled('npm install -g @eai-tools/cli@0.2.0 --@eai-tools:registry=https://eai-tools.github.io/eai-cli/registry')
// expectSuccessMessage('Updated to v0.2.0')
```

### Scenario 99: Update Skipped - Already Latest
**Priority**: P2
**User Story**: As a developer, I should know if already latest

```javascript
// TC099: Update skipped when already latest
// Traces to: Update-US1-AC3
//
// currentVersion('0.2.0')
// registryHasVersion('0.2.0')
//
// runCommand('eai update')
//
// expectInfoMessage('Already on latest version: 0.2.0')
// expectNoInstallTriggered()
```

### Scenario 100: Update Fails - Registry Unreachable
**Priority**: P2
**User Story**: As a developer, I should see network error

```javascript
// TC100: Update fails when registry unreachable
// Traces to: Update-US1-ERR1
//
// registryUnreachable()
//
// runCommand('eai update --check')
//
// expectCommandFailed()
// expectErrorMessage('Unable to check for updates')
// expectSuggestedFix('Check network connection')
// expectExitCode(1)
```

---

## DSL Functions Required

### Setup Functions (Arrange)

| Function | Purpose | Priority |
|----------|---------|----------|
| `workingDirectoryIs(path)` | Set current working directory | P0 |
| `userIsLoggedIn(opts?)` | Create auth tokens | P0 |
| `userIsNotLoggedIn()` | Clear auth tokens | P0 |
| `tokenExpired()` | Set token expiry to past | P1 |
| `tokenNotExpired()` | Set token expiry to future | P1 |
| `projectHasEnvFile(vars)` | Create .env.local with vars | P0 |
| `projectHasValidObjectTypes(types)` | Create object-types.ts | P0 |
| `projectHasObjectType(name, def)` | Add single type | P1 |
| `projectHasMultiTenantConfig(keys)` | Set TENANT_KEYS | P1 |
| `publicAPIReachable()` | Mock /health endpoint | P0 |
| `publicAPIUnreachable()` | Mock network error | P1 |
| `publicAPIReturns400(err)` | Mock 400 error | P1 |
| `publicAPIReturns404(err)` | Mock 404 error | P1 |
| `publicAPIReturns409(err)` | Mock 409 error | P1 |
| `typeExistsOnPlatform(name, id, def)` | Mock GET /object-types | P0 |
| `resourceExists(type, id, data)` | Mock GET /resources | P0 |
| `tenantHasResources(type, count)` | Mock resource list | P1 |
| `tenantExists(id, def)` | Mock GET /tenants/{id} | P1 |
| `platformHasTenants(tenants)` | Mock GET /tenants | P1 |
| `workflowExists(id)` | Set WORKFLOW_*_ID | P1 |
| `fileExists(path, content?)` | Create temp file | P1 |
| `fileNotExists(path)` | Ensure file doesn't exist | P1 |
| `directoryExists(path)` | Create directory | P1 |
| `gitIsInstalled()` | Mock git availability | P0 |
| `gitNotInstalled()` | Mock git not found | P1 |
| `azureCLIInstalled()` | Mock az CLI | P1 |
| `azureCLINotInstalled()` | Mock az not found | P1 |
| `gitHubCLIInstalled()` | Mock gh CLI | P1 |
| `gitHubCLINotInstalled()` | Mock gh not found | P1 |
| `networkIsAvailable()` | Mock network up | P1 |
| `networkIsUnreachable()` | Mock network down | P1 |

### Action Functions (Act)

| Function | Purpose | Priority |
|----------|---------|----------|
| `runCommand(cmd)` | Execute CLI command | P0 |
| `respondToPrompt(question, answer)` | Mock user input | P0 |
| `waitForUserAuth()` | Simulate browser sign-in completion | P1 |
| `waitSeconds(n)` | Advance time | P2 |

### Assertion Functions (Assert)

| Function | Purpose | Priority |
|----------|---------|----------|
| `expectCommandSucceeded()` | Exit code 0 | P0 |
| `expectCommandFailed()` | Exit code 1 | P0 |
| `expectExitCode(code)` | Specific exit code | P0 |
| `expectSuccessMessage(msg)` | Check success output | P0 |
| `expectErrorMessage(msg)` | Check error output | P0 |
| `expectWarningMessage(msg)` | Check warning output | P1 |
| `expectInfoMessage(msg)` | Check info output | P1 |
| `expectDisplayedMessage(msg)` | Check stdout contains | P0 |
| `expectSuggestedFix(msg)` | Check suggested action | P1 |
| `expectFileExists(path)` | File created | P0 |
| `expectFileNotExists(path)` | File not created | P1 |
| `expectFileContains(path, content)` | File has content | P0 |
| `expectEnvVarSet(file, key, value)` | .env has key=value | P0 |
| `expectEnvVarNotSet(file, key)` | .env missing key | P1 |
| `expectDirectoryCreated(path)` | Directory exists | P0 |
| `expectAPICalledGET(endpoint, params?)` | Mock GET called | P0 |
| `expectAPICalledPOST(endpoint, body?)` | Mock POST called | P0 |
| `expectAPICalledPUT(endpoint, body?)` | Mock PUT called | P0 |
| `expectAPICalledPATCH(endpoint, body?)` | Mock PATCH called | P1 |
| `expectAPICalledDELETE(endpoint)` | Mock DELETE called | P0 |
| `expectNoAPICallsMade()` | No API calls | P1 |
| `expectTokenStored(path)` | Token file exists | P0 |
| `expectTokenEncrypted(path)` | Token is encrypted | P1 |
| `expectTokenFileDeleted(path)` | Token removed | P0 |
| `expectJSONOutput()` | stdout is valid JSON | P1 |
| `expectJSONContains(obj)` | JSON has properties | P1 |
| `expectValidationPassed()` | No errors | P0 |
| `expectValidationFailed()` | Has errors | P0 |
| `expectNoErrorsOrWarnings()` | Clean validation | P1 |
| `expectGitRepoInitialized(path)` | .git exists | P1 |
| `expectGitCommitExists(path, msg)` | Commit with message | P2 |
| `expectNoPrompts()` | No interactive input | P1 |
| `expectCheckPassed(name, severity?)` | Diagnostic passed | P1 |
| `expectCheckFailed(name)` | Diagnostic failed | P1 |
| `expectCheckWarning(name, fix)` | Diagnostic warning | P1 |

---

## Test Organization

```
tests/
├── integration/          # Full CLI command tests (Scenarios 1-100)
│   ├── init.test.ts      # TC001-TC010
│   ├── auth.test.ts      # TC011-TC020
│   ├── env.test.ts       # TC021-TC030
│   ├── types.test.ts     # TC031-TC045
│   ├── resources.test.ts # TC046-TC060
│   ├── tenant.test.ts    # TC061-TC070
│   ├── chat.test.ts      # TC071-TC078
│   ├── docs.test.ts      # TC079-TC083
│   ├── deploy.test.ts    # TC084-TC091
│   ├── verify.test.ts    # TC092-TC096
│   └── update.test.ts    # TC097-TC100
├── e2e/                  # End-to-end workflow tests
│   ├── onboarding.test.ts    # init → login → env pull → types seed → dev
│   ├── resource-lifecycle.test.ts  # create → update → delete
│   └── deployment.test.ts    # setup → trigger → status
├── unit/                 # Unit tests for lib/ utilities
│   ├── auth.test.ts
│   ├── api-client.test.ts
│   └── config.test.ts
├── helpers/              # DSL functions
│   ├── setup-dsl.ts      # Setup functions
│   ├── action-dsl.ts     # Action functions
│   ├── assert-dsl.ts     # Assertion functions
│   ├── mock-server.ts    # API mocking
│   └── test-env.ts       # Test environment setup
└── fixtures/             # Test data
    ├── object-types.ts
    ├── resources.json
    └── env-vars.ts
```

---

## Next Steps

1. ✅ **Scenarios Defined** (100 scenarios documented)
2. ⬜ **Install Vitest** (`npm install -D vitest @vitest/ui`)
3. ⬜ **Create DSL Functions** (setup, action, assert)
4. ⬜ **Implement Test Scaffolds** (write actual test files)
5. ⬜ **Run Tests** (expect failures - red phase)
6. ⬜ **Fix Implementation** (make tests pass)
7. ⬜ **CI Integration** (add test step to ci.yml)

---

## Summary

- **Total Scenarios**: 100
- **Command Groups Covered**: 14
- **Priority P0 (Critical)**: 35 scenarios
- **Priority P1 (High)**: 51 scenarios
- **Priority P2 (Medium)**: 14 scenarios
- **DSL Functions Required**: ~80 functions
- **Test Files**: 11 integration + 3 e2e + 3 unit = 17 files
- **Estimated Test Count**: ~100 integration + ~15 e2e + ~30 unit = 145+ tests

---

**Test Coverage Goals:**
- Command execution: 100%
- Error handling: 100%
- API interactions: 95%
- Multi-tenant scenarios: 100%
- Authentication flows: 100%
- File I/O operations: 90%
- Network error handling: 100%
