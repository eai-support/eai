# API Contracts: Browser PKCE Auth

## Authorization Endpoint

### `GET /oauth2/v2.0/authorize`

Purpose:

- start browser-based sign-in
- receive an authorization code through the localhost redirect URI

Required query parameters:

- `client_id`
- `response_type=code`
- `redirect_uri`
- `response_mode=query`
- `scope`
- `state`
- `code_challenge`
- `code_challenge_method=S256`

## Token Endpoint

### `POST /oauth2/v2.0/token`

Used for:

- authorization-code exchange
- refresh-token exchange

Authorization-code exchange form fields:

- `client_id`
- `grant_type=authorization_code`
- `code`
- `redirect_uri`
- `code_verifier`
- `scope`

Refresh-token exchange form fields:

- `client_id`
- `grant_type=refresh_token`
- `refresh_token`

Expected success fields:

- `access_token`
- `refresh_token` when issued
- `expires_in`
- `token_type`

## Local Storage Contract

Stored token shape:

- `accessToken`
- `refreshToken`
- `expiresAt`
- `tenantId`
- `tenantName`
- `clientId`
- `upn`
- `oid`
