---
generated: true
generated_at: "2026-05-08T17:54:00Z"
source_commit: "825bd7f4db75d5f0be796914cc300b14969c2e74"
---

# EAI CLI — API Reference

## Overview

The CLI interacts with the **EAI Platform API v3 (PublicAPI)** and **AdminAPI**. All endpoints require Bearer token authentication obtained via Entra CIAM browser-based PKCE flow.

**Base URL (PublicAPI)**: Configured via profile or `BASE_URL_PUBLIC_API` environment variable (e.g., `https://api.ae.myenterprise.ai/public`)

**Base URL (AdminAPI)**: Resolved at runtime from PublicAPI environment (e.g., `https://api.ae.myenterprise.ai/admin`)

**Authentication**: `Authorization: Bearer {access_token}`

**Client Class**: `PlatformAPIClient` in `src/lib/api.ts`

---

## PublicAPI v3 Endpoints

### Resources API

#### List Resources
```
GET /v3/resources/{tenant_id}/{object_type}
```

**Query Parameters**:
- `page` (number) — Page number (default: 1)
- `limit` (number) — Items per page (default: 20, max: 100)
- `sort` (string) — Sort field (prefix with `-` for descending, e.g., `-created_at`)
- `where[field][equals]` — Filter by exact match

**Response**:
```json
{
  "docs": [
    {
      "id": "uuid",
      "data": { /* resource fields */ },
      "created_at": "2026-04-30T12:00:00Z",
      "updated_at": "2026-04-30T12:00:00Z",
      "version": 1,
      "tenant": "tenant-id",
      "object_type": "ObjectTypeName"
    }
  ],
  "totalDocs": 100,
  "page": 1,
  "totalPages": 5,
  "limit": 20
}
```

**CLI Command**: `eai resources list <type> --page 1 --limit 20 --sort -created_at`

**Client Method**: `client.listResources(type, params)`

---

#### Get Resource
```
GET /v3/resources/{tenant_id}/{object_type}/{id}
```

**Response**:
```json
{
  "id": "uuid",
  "data": { /* resource fields */ },
  "version": 1,
  "created_at": "2026-04-30T12:00:00Z",
  "updated_at": "2026-04-30T12:00:00Z",
  "tenant": "tenant-id",
  "object_type": "ObjectTypeName"
}
```

**CLI Command**: `eai resources get <type> <id>`

**Client Method**: `client.getResource(type, id)`

---

#### Create Resource
```
POST /v3/resources/{tenant_id}/{object_type}
Content-Type: application/json

{
  "data": {
    "field1": "value1",
    "field2": 123
  }
}
```

**Response**:
```json
{
  "id": "uuid",
  "data": { /* created resource */ },
  "version": 1,
  "created_at": "2026-04-30T12:00:00Z"
}
```

**CLI Command**: `eai resources create <type> --data '{"field1":"value1"}'` or `--file resource.json`

**Client Method**: `client.createResource(type, data)`

---

#### Update Resource
```
PUT /v3/resources/{tenant_id}/{object_type}/{id}
Content-Type: application/json

{
  "data": {
    "field1": "new_value"
  },
  "version": 1
}
```

**Notes**:
- Requires `version` field for optimistic locking
- Returns `409 Conflict` if version mismatch
- CLI auto-fetches current version before update

**Response**:
```json
{
  "id": "uuid",
  "data": { /* updated resource */ },
  "version": 2,
  "updated_at": "2026-04-30T12:05:00Z"
}
```

**CLI Command**: `eai resources update <type> <id> --data '{"field1":"new_value"}'`

**Client Method**: `client.updateResource(type, id, data, version)`

---

#### Delete Resource
```
DELETE /v3/resources/{tenant_id}/{object_type}/{id}
```

**Response**: `204 No Content`

**CLI Command**: `eai resources delete <type> <id>` (prompts for confirmation)

**Client Method**: `client.deleteResource(type, id)`

---

#### Query Resources (Cross-Type)
```
POST /v3/resources/{tenant_id}/query
Content-Type: application/json

{
  "types": ["User", "Organization"],
  "where": {
    "field1": "value1"
  },
  "limit": 50,
  "page": 1
}
```

**Response**:
```json
{
  "results": [
    { "id": "...", "object_type": "User", "data": {...} },
    { "id": "...", "object_type": "Organization", "data": {...} }
  ],
  "totalDocs": 100,
  "page": 1
}
```

**CLI Command**: `eai resources query --types User,Organization --where '{"field1":"value1"}'`

**Client Method**: `client.queryResources(query)`

---

#### Get Published Schema
```
GET /v3/resources/schema/{tenant_id}
```

**Response**:
```json
{
  "objectTypes": [
    {
      "slug": "user",
      "schema": {
        "type": "object",
        "properties": {
          "email": { "type": "string" },
          "name": { "type": "string" }
        },
        "required": ["email"]
      }
    }
  ]
}
```

**CLI Command**: `eai resources schema`

**Client Method**: `client.getSchema()`

---

### Chat API

#### Send Chat Message
```
POST /v3/chat/{tenant_id}/{workflow}/{stage}
Content-Type: application/json

{
  "message": "Hello, how can I help?",
  "context": { "userId": "..." }
}
```

**Response**:
```json
{
  "response": "I can assist you with...",
  "conversationId": "uuid"
}
```

**CLI Command**: `eai chat send "Hello" --workflow default --stage initial`

**Client Method**: `client.sendChat(workflow, stage, message, context?)`

---

#### Stream Chat (SSE)
```
POST /v3/chat/stream/{tenant_id}/{workflow}/{stage}
Content-Type: application/json
Accept: text/event-stream

{
  "message": "Tell me a story",
  "context": {}
}
```

**Response**: Server-Sent Events stream
```
data: {"token": "Once"}
data: {"token": " upon"}
data: {"token": " a"}
data: {"done": true}
```

**CLI Command**: `eai chat stream "Tell me a story"`

**Client Method**: `client.streamChat(workflow, stage, message, context?)` → Returns `Response` with SSE body

---

### Documents API

#### Classify Document
```
POST /v3/documents/classify
Content-Type: application/json

{
  "document": {
    "id": "doc-id",
    "content": "..."
  }
}
```

**Response**:
```json
{
  "classification": "Invoice",
  "confidence": 0.95
}
```

**CLI Command**: `eai docs classify path/to/file.pdf`

**Client Method**: `client.classifyDocument(payload)`

---

#### Index Document for RAG
```
POST /v3/documents/rag-index
Content-Type: application/json

{
  "documentId": "doc-id",
  "chunks": [...]
}
```

**Response**:
```json
{
  "indexed": true,
  "chunkCount": 42
}
```

**CLI Command**: `eai docs index <document-id>`

**Client Method**: `client.indexDocument(payload)`

---

### Internal Orchestration

#### Platform Request (Internal Routing)
```
POST /v3/orchestrate
Content-Type: application/json

{
  "backend": "payload" | "admin" | "mid",
  "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  "path": "/api/collections/...",
  "body": { ... }
}
```

**Purpose**: Routes requests to backend services (Payload CMS, AdminAPI, etc.) through PublicAPI.

**Client Method**: `client.platformRequest(backend, method, path, body?)`

**Used By**: Type seeding, environment config, internal admin operations

---

## AdminAPI Endpoints

### User Management

#### Lookup User by Email
```
POST /api/admin/users/lookup
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response**:
```json
{
  "id": "user-oid",
  "email": "user@example.com",
  "username": "user@example.com",
  "user": {
    "id": "user-oid",
    "email": "user@example.com"
  }
}
```

**CLI Command**: `eai user invite --email user@example.com`

**Client Method**: `client.lookupUserByEmail(email)`

**Auth**: Requires `tenant-admin` role on target tenant

---

#### Provision User to Tenant
```
POST /api/admin/tenants/{tenant_id}/users
Content-Type: application/json

{
  "userId": "user-oid"
}
```

**Response**:
```json
{
  "success": true,
  "message": "User added to tenant"
}
```

**CLI Command**: `eai user invite --email user@example.com --tenant <id>`

**Client Method**: `client.provisionUserToTenant(tenantId, userId)`

**Auth**: Requires `tenant-admin` role on target tenant

---

### Tenant Management

#### Get Current User Tenant Memberships
```
GET /api/admin/current-user/tenant-memberships
```

**Response**:
```json
{
  "tenants": [
    {
      "tenant": {
        "id": "tenant-id",
        "displayName": "My Tenant",
        "slug": "my-tenant",
        "isActive": true
      },
      "roles": ["tenant-admin"],
      "isTenantAdmin": true
    }
  ]
}
```

**CLI Command**: `eai tenant list`, `eai tenant select`

**Client Method**: `client.getCurrentUserMemberships()`

**Auth**: Requires authenticated user

---

#### Create Tenant
```
POST /api/admin/tenants
Content-Type: application/json

{
  "displayName": "New Tenant",
  "slug": "new-tenant",
  "parent": "parent-tenant-id"
}
```

**Response**:
```json
{
  "id": "new-tenant-id",
  "displayName": "New Tenant",
  "slug": "new-tenant",
  "parent": "parent-tenant-id",
  "isActive": true
}
```

**CLI Command**: `eai tenant create --parent <id>`

**Client Method**: `client.createTenant(payload)`

**Auth**: Requires `tenant-admin` on parent tenant (for child creation)

---

#### Bootstrap Child Tenant First Admin
```
POST /api/admin/tenants/{child_tenant_id}/bootstrap-admin
Content-Type: application/json

{
  "userOid": "caller-oid",
  "userEmail": "caller@example.com"
}
```

**Purpose**: Constrained first-admin bootstrap flow for child tenants. Caller must be `tenant-admin` on direct parent.

**Response**:
```json
{
  "parentTenantId": "parent-id",
  "childTenantId": "child-id",
  "userOid": "caller-oid",
  "membershipCreated": true,
  "adminAssigned": true,
  "usable": true,
  "status": "bootstrapped"
}
```

**CLI Command**: Called internally by `eai tenant create`

**Client Method**: `client.bootstrapChildTenantAdmin(childTenantId, request)`

**Auth**: Requires `tenant-admin` on direct parent; child must not already have a tenant-admin

---

### Entra Provisioning

#### Confirm Entra App Registration
```
POST /api/admin/platform-ops/entra/confirm-app-registration
Content-Type: application/json

{
  "tenantId": "platform-tenant-id",
  "clientId": "vertical-client-id"
}
```

**Purpose**: Creates or confirms Entra app registration for the vertical in the platform's CIAM tenant.

**Response**:
```json
{
  "exists": true,
  "clientId": "client-id",
  "displayName": "My Vertical",
  "scopes": ["User.Read", "PublicAPI.All"],
  "redirectUris": ["http://localhost:3000/auth/callback"],
  "environment": "dev",
  "tenantId": "platform-tenant-id",
  "signinCompleteness": {
    "signinReady": true,
    "graphDelegatedPermsGranted": true,
    "publicApiDelegatedPermsGranted": true,
    "adminConsentGranted": true,
    "preAuthorizedConfigured": true,
    "warnings": []
  }
}
```

**New in v2.7.0**: The `signinCompleteness` field (also accepted as `signin_completeness`) provides a per-step rollup of post-provision sign-in wiring state. This prevents silent failures where the app registration is created but cannot reach PublicAPI from a user session.

**Sign-in Completeness Fields**:
- `signinReady` (boolean) — Overall readiness; true only when all four steps succeeded
- `graphDelegatedPermsGranted` (boolean) — Microsoft Graph delegated permissions added
- `publicApiDelegatedPermsGranted` (boolean) — PublicAPI delegated permissions added
- `adminConsentGranted` (boolean) — Admin consent granted for required permissions
- `preAuthorizedConfigured` (boolean) — PreAuthorizedApplications configured on PublicAPI app reg
- `warnings` (string[]) — Human-readable warnings for failed steps

**CLI Behavior (v2.7.0+)**:
- When `signinReady: true` → Prints success confirmation and exits 0
- When `signinReady: false` → Prints structured error table showing which step failed, displays warnings, provides portal remediation steps, and **exits with code 1**
- When field absent (older PublicAPI) → Silent (cannot determine readiness)

**CLI Command**: `eai provision entra`

**Client Method**: `client.confirmEntraAppRegistration(payload)`

**Auth**: Requires authenticated user; platform determines CIAM from active profile/environment

**Error Handling**: Sanitized errors; never exposes backend URLs, tenant IDs, or raw platform errors

---

## Authentication Endpoints

### Entra CIAM (OAuth 2.0 + PKCE)

#### Authorization URL
```
GET https://{ciamTenant}.ciamlogin.com/{tenantId}/oauth2/v2.0/authorize
  ?client_id={clientId}
  &response_type=code
  &redirect_uri=http://localhost:8888
  &scope={scope}
  &code_challenge={challenge}
  &code_challenge_method=S256
  &state={state}
```

**Flow**:
1. CLI generates PKCE `code_verifier` and `code_challenge`
2. CLI opens browser to authorization URL
3. User authenticates in browser
4. Browser redirects to `localhost:8888?code=...&state=...`
5. CLI exchanges `code` + `code_verifier` for tokens

---

#### Token Exchange
```
POST https://{ciamTenant}.ciamlogin.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id={clientId}
&code={authCode}
&redirect_uri=http://localhost:8888
&code_verifier={codeVerifier}
&scope={scope}
```

**Response**:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "0.A...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**CLI Command**: `eai login`

**Client Function**: `browserLogin()` in `src/lib/auth.ts`

---

#### Token Refresh
```
POST https://{ciamTenant}.ciamlogin.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id={clientId}
&refresh_token={refreshToken}
&scope={scope}
```

**Response**: Same as token exchange

**Automatic**: Triggered when token has <5min remaining

**Client Function**: `getToken()` in `src/lib/auth.ts`

---

## Error Responses

All API endpoints may return structured error responses:

### Standard Error Format
```json
{
  "detail": {
    "error": "RESOURCE_NOT_FOUND",
    "message": "Resource User:123 not found"
  }
}
```

**Alternative Formats**:
```json
{
  "detail": "Not found"
}
```

```json
{
  "message": "Validation error",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

### Common Error Codes

| Status | Error Code | Description | CLI Action |
|--------|-----------|-------------|-----------|
| 401 | `UNAUTHORIZED` | Invalid or expired token | Prompts re-login |
| 403 | `FORBIDDEN` | Insufficient permissions | Displays error, suggests checking roles |
| 404 | `RESOURCE_NOT_FOUND` | Resource not found | Displays E202 error |
| 409 | `VERSION_CONFLICT` | Optimistic locking failure | Re-fetches and retries |
| 422 | `VALIDATION_ERROR` | Invalid request payload | Displays E301-E305 validation error |
| 500 | `INTERNAL_ERROR` | Server error | Displays E201 platform error |

**Client Error Handling**: `extractServerErrorContext()` and `parseApiError()` functions in `src/lib/api.ts`

**Structured CLI Errors**: See `src/lib/error-codes.ts` for E001-E305 catalog

---

## Rate Limiting

- **Limit**: 100 requests per minute per token (subject to change)
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Status**: `429 Too Many Requests`
- **CLI Behavior**: Displays error; does not auto-retry

---

## Request Correlation

All responses include correlation headers for debugging:

- `X-Request-ID` — Unique request identifier
- `X-Correlation-ID` — Cross-service correlation ID

**CLI Debug Mode**: `--debug` flag logs request/response details including correlation IDs (not yet implemented)

---

## Machine-Readable Output

All CLI commands support `--format json` for automation:

```bash
eai resources list User --format json | jq '.docs[0].data.email'
eai tenant list --format json | jq -r '.tenants[].tenant.slug'
eai verify calls --format json
```

**JSON Output Structure**:
- Successful responses: Mirrors API response structure
- Errors: Structured error object with `code`, `message`, `suggestion`, `exitCode`

---

## Contract Verification

The `eai verify calls` command audits which platform API routes the CLI actually uses:

```bash
eai verify calls --format json
```

**Output**:
```json
{
  "publicApiCalls": [
    "GET /v3/resources/{tenant}/{type}",
    "POST /v3/chat/stream/{tenant}/{workflow}/{stage}"
  ],
  "adminApiCalls": [
    "GET /api/admin/current-user/tenant-memberships",
    "POST /api/admin/tenants/{id}/users"
  ]
}
```

**Purpose**: Helps platform maintainers understand CLI's API contract surface
