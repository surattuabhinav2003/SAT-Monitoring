# Azure Entra ID setup — SAT Monitoring

Everything the app registration needs. Hand this to whoever administers the
CloudFuze tenant.

One registration covers both halves: the SPA signs in with it, and the API
validates tokens issued for it.

---

## 1. Create the app registration

**Entra ID → App registrations → New registration**

| Field | Value |
|---|---|
| Name | `SAT Monitoring` |
| Supported account types | **Accounts in this organizational directory only** (single tenant) |
| Redirect URI | leave blank here — added in step 2 |

Single tenant matches the app's "CloudFuze employees only" rule.

## 2. Add redirect URIs — platform must be SPA

**Authentication → Add a platform → Single-page application**

> ⚠️ It must be **Single-page application**, *not* **Web**. The app uses
> `@azure/msal-browser` v3 (authorization code + PKCE). Registering under Web
> produces `AADSTS9002326: Cross-origin token redemption is permitted only for
> the 'Single-Page Application' client-type` at sign-in.

Add:

| Environment | Redirect URI |
|---|---|
| Local development | `http://localhost:5180` |
| Local fallback port | `http://localhost:5181` |
| Production | the deployed URL, e.g. `https://sat.cloudfuze.com` |

Notes:

- **No trailing slash.** The app falls back to `window.location.origin`, which
  never emits one, and Entra ID matches exactly.
- The 5181 entry matters because `vite.config.js` sets `strictPort: false` — if
  5180 is busy Vite silently moves to 5181 and sign-in breaks confusingly.
- Sign-out reuses the same origin (`logoutPopup`), so no separate front-channel
  logout URL is needed.

**Implicit grant and hybrid flows:** leave *both* checkboxes **unchecked**.
PKCE does not use implicit flow.

## 3. Expose the API scope

This is what lets the backend verify that a token was issued *for this API*.

**Expose an API → Application ID URI → Set** — accept the default
`api://<client-id>`.

Then **Add a scope**:

| Field | Value |
|---|---|
| Scope name | `access_as_user` |
| Who can consent | Admins and users |
| Admin consent display name | `Access SAT Monitoring` |
| Admin consent description | `Allows the signed-in user to access the SAT Monitoring API on their behalf.` |
| State | Enabled |

The full scope becomes `api://<client-id>/access_as_user`, which is what the
frontend requests by default.

## 4. Pre-authorize the SPA (recommended)

**Expose an API → Add a client application** → enter the **same client id** and
tick `access_as_user`.

The SPA and API share one registration, so this suppresses the consent prompt
that users would otherwise see on first sign-in.

## 5. API permissions

**API permissions** should list:

| API | Permission | Type | Admin consent |
|---|---|---|---|
| Microsoft Graph | `openid` | Delegated | Not required |
| Microsoft Graph | `profile` | Delegated | Not required |
| Microsoft Graph | `email` | Delegated | Not required |
| This app | `access_as_user` | Delegated | Not required |

The app reads the user's name and email from the ID token and **never calls
Microsoft Graph**, so `User.Read` is not required. Add it only if a future
feature needs Graph.

## 6. No client secret

Do not create one. SPAs cannot hold secrets, and neither half of this app uses
one — the API only *validates* tokens, it never exchanges them.

---

## What to send back

From the registration **Overview** page:

```
Application (client) ID  ->  <client-id>
Directory (tenant) ID    ->  <tenant-id>
```

Put them in `.env`:

```bash
# Frontend (Vite) — setting the client id switches demo mode off
VITE_AZURE_CLIENT_ID=<client-id>
VITE_AZURE_TENANT_ID=<tenant-id>
VITE_AZURE_REDIRECT_URI=http://localhost:5180

# Backend — token verification
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<client-id>

# Turn the local escape hatch OFF once the above are set
DEV_AUTH_BYPASS=false
```

Then `docker compose up -d --build api` and confirm the boot log shows:

```
[auth] verifying Azure AD tokens for tenant <tenant-id>
```

…and **not** the `DEV_AUTH_BYPASS IS ON` warning.

---

## How authentication works

```
Browser                          API                        PostgreSQL
   |  MSAL loginPopup              |                             |
   |  (openid, profile, email,     |                             |
   |   api://<id>/access_as_user)  |                             |
   |                               |                             |
   |  acquireTokenSilent ->        |                             |
   |  Authorization: Bearer <jwt>  |                             |
   |------------------------------>|                             |
   |                               | verify vs tenant JWKS:      |
   |                               |  signature, issuer,         |
   |                               |  audience, expiry           |
   |                               |                             |
   |                               | role lookup ---------------->|
   |                               |<--- admins table            |
   |<------ 200 / 401 / 403 -------|                             |
```

- Identity comes **only** from the verified token. The client cannot assert who
  it is.
- The role comes **only** from the `admins` table, so revoking access takes
  effect on the next request rather than when a token expires.
- Tokens are cached by MSAL and refreshed silently, so a long-lived tab keeps
  working without re-prompting.

### Route protection

| Route | Requirement |
|---|---|
| `GET /api/health` | public (liveness probes) |
| `GET /api/users/me` | signed in |
| `GET /api/applications` | signed in |
| `POST`/`PUT`/`DELETE /api/applications` | **admin** |
| `GET`/`POST`/`DELETE /api/admins` | **admin** |

### The local escape hatch

`DEV_AUTH_BYPASS=true` skips verification entirely and treats every request as
`DEV_AUTH_EMAIL`. It exists so the app runs before a tenant is available.

Safeguards:

- Force-disabled when `NODE_ENV=production`, which `docker-compose.yml` defaults
  to — an accidental `true` in a deployed `.env` cannot open the API.
- Logs a loud warning on **every** boot while it is on.
- Ships as `false` in `.env.example`.

**It must be `false` in any shared, staging or production environment.**
