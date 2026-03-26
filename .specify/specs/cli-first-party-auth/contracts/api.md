# API Contracts — CLI First-Party Auth

## No New REST API Endpoints

This feature introduces **no new REST API endpoints**. It is a CLI-only change that modifies how the `eai login` command resolves a client ID. No new routes, no new HTTP contracts, and no backend changes are required or planned.

---

## Reference: Entra CIAM Device Code Flow Endpoints

The following endpoints are already called by `src/lib/auth.ts:deviceCodeLogin()`. They are documented here for reference only — no changes are made to these calls as part of this feature (other than the bug fix that adds the missing user-facing message display).

The base authority is constructed at runtime:

```
https://{tenantName}.ciamlogin.com/{tenantId}
```

Default values (from `src/commands/login.ts`):
- `tenantName`: `eaidevmyentepriseai`
- `tenantId`: `50808ce0-f31b-4fd0-9861-74b83b8c112a`

---

### POST `/oauth2/v2.0/devicecode`

Initiates the device code flow. Returns a user code and verification URL that must be displayed to the user.

**Request**

```
Content-Type: application/x-www-form-urlencoded
```

| Field       | Type   | Description                                                    |
|-------------|--------|----------------------------------------------------------------|
| `client_id` | string | The EAI CLI App Registration GUID (hardcoded `DEFAULT_CLIENT_ID`) |
| `scope`     | string | Space-separated OAuth scopes (defaults to `DEFAULT_SCOPE`)     |

**Response** `200 OK`

```json
{
  "device_code":        "BAQABAAEAAAD...",
  "user_code":          "ABCD-EFGH",
  "verification_uri":   "https://microsoft.com/devicelogin",
  "expires_in":         900,
  "interval":           5,
  "message":            "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate."
}
```

| Field              | Type    | Description                                                             |
|--------------------|---------|-------------------------------------------------------------------------|
| `device_code`      | string  | Opaque code used when polling for a token; never shown to the user      |
| `user_code`        | string  | Short alphanumeric code the user types at `verification_uri`            |
| `verification_uri` | string  | URL the user must navigate to in a browser                              |
| `expires_in`       | integer | Seconds until the device code and user code expire                      |
| `interval`         | integer | Minimum seconds to wait between token poll attempts                     |
| `message`          | string  | Human-readable instruction string — **must be displayed to the user** (this was the bug fixed by FR-04) |

**Error responses** return a non-2xx status with a plain-text body.

---

### POST `/oauth2/v2.0/token`

Polls for an access token after the user has completed authentication in the browser. Also used for refresh token exchanges.

**Request (device code grant)**

```
Content-Type: application/x-www-form-urlencoded
```

| Field         | Type   | Description                                                        |
|---------------|--------|--------------------------------------------------------------------|
| `client_id`   | string | The EAI CLI App Registration GUID                                  |
| `grant_type`  | string | `urn:ietf:params:oauth:grant-type:device_code`                     |
| `device_code` | string | The `device_code` value received from the `/devicecode` endpoint   |

**Request (refresh token grant)**

| Field           | Type   | Description                                       |
|-----------------|--------|---------------------------------------------------|
| `client_id`     | string | The EAI CLI App Registration GUID                 |
| `grant_type`    | string | `refresh_token`                                   |
| `refresh_token` | string | The stored refresh token                          |
| `scope`         | string | The original scope string                         |

**Response** `200 OK`

```json
{
  "access_token":  "eyJ0eXAiOiJKV1Q...",
  "refresh_token": "0.AQEA...",
  "expires_in":    3600,
  "token_type":    "Bearer"
}
```

| Field           | Type    | Description                                         |
|-----------------|---------|-----------------------------------------------------|
| `access_token`  | string  | JWT bearer token for EAI API calls                  |
| `refresh_token` | string  | Optional; present when `offline_access` scope is granted |
| `expires_in`    | integer | Seconds until the access token expires              |
| `token_type`    | string  | Always `"Bearer"`                                   |

**Polling error responses** (while user has not yet authenticated):

```json
{ "error": "authorization_pending", "error_description": "..." }
```

The CLI continues polling on `authorization_pending`. Any other error terminates polling and throws.
