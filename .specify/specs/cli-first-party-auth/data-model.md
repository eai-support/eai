# Data Model — CLI First-Party Auth

## No New Data Entities

This feature introduces **no new data entities, database tables, or persistent storage schemas**. It is a CLI-only change. All token storage uses the pre-existing `StoredTokens` structure, and the storage mechanism (encrypted file on disk) is unchanged.

---

## Existing: `StoredTokens` Interface

Defined in `src/lib/auth.ts`. Written to disk by `storeTokens()` and read by `loadTokens()` and `refreshAccessToken()`.

```typescript
interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tenantId: string;
  tenantName: string;
  clientId: string;
  upn?: string;
}
```

| Field          | Type             | Required | Description                                                                         |
|----------------|------------------|----------|-------------------------------------------------------------------------------------|
| `accessToken`  | `string`         | Yes      | JWT bearer token used in `Authorization: Bearer` headers for EAI API calls          |
| `refreshToken` | `string`         | No       | OAuth refresh token; present when `offline_access` scope is granted                 |
| `expiresAt`    | `number`         | Yes      | Unix timestamp (ms) after which `accessToken` should be considered expired          |
| `tenantId`     | `string`         | Yes      | Entra CIAM tenant ID GUID used to build the authority URL for refresh               |
| `tenantName`   | `string`         | Yes      | Entra CIAM tenant name used to build the authority URL for refresh                  |
| `clientId`     | `string`         | Yes      | **Retained — see note below.** The CLI App Registration GUID used for token refresh |
| `upn`          | `string`         | No       | User Principal Name parsed from the JWT `preferred_username` claim                  |

### `clientId` Field — RETAINED, Not Removed

Although this feature removes all _runtime resolution_ of a client ID from the environment or flags, the `clientId` field in `StoredTokens` **is intentionally kept**.

`refreshAccessToken()` (also in `src/lib/auth.ts`) reads `tokens.clientId` to construct the refresh token POST request:

```typescript
async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens | null> {
  if (!tokens.refreshToken || !tokens.clientId) return null;
  // ... uses tokens.clientId in the token endpoint body
}
```

After this feature ships, newly stored tokens will have `clientId` set to the hardcoded `DEFAULT_CLIENT_ID` constant. Existing stored tokens already contain a `clientId` value (set when they were originally written) and continue to work correctly with no migration required (see NFR-03 in `spec.md`).

---

## What Does NOT Change

| Item | Status |
|------|--------|
| `StoredTokens` field set | No fields added or removed |
| Token storage file location (`~/.eai/tokens`) | Unchanged |
| Token encryption mechanism | Unchanged |
| `DeviceCodeResponse` interface | Unchanged (internal to `auth.ts`) |
| `TokenResponse` interface | Unchanged (internal to `auth.ts`) |
| `EAIProjectConfig` in `src/lib/config.ts` | `entra.clientId` removed or marked optional per FR-08 |
