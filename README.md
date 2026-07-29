# SAT Monitoring

An enterprise portal for tracking CloudFuze's internal applications — status,
ownership, team usage and gstack implementation.

**Stack:** React (Vite) + React Router + MSAL (Azure Entra ID) + Recharts on the
frontend; **Node/Express + PostgreSQL** on the backend. Styled to the CloudFuze
brand guidelines (Poppins, brand blue `#0129AC`).

## Features

- 🐳 **Automatic discovery** — applications are found from the Docker containers
  running on the server, every 5 minutes. Nobody adds them by hand.
- 🔔 **Notifications** when a tool is discovered, stops responding, or recovers
- 🔐 **Microsoft-only login** via MSAL (Azure Entra ID) with role-based access (Admin / User)
- 🗄️ **PostgreSQL persistence** — applications and admins are stored server-side and
  shared by everyone who opens the portal
- 📊 **Dashboard** with an "Applications Requiring Review" call to action, plus
  Application Status and Gstack sections, two bar charts and a team pie chart.
  Every card drills down to the applications behind the number.
- 🗂️ **Applications table** with search, lifecycle / gstack filters and pagination
- ✏️ **Admins maintain business metadata only** — team, owner, gstack, decommission
  status and notes. Identity and liveness are owned by discovery.
- 🛡️ **Admin Access page** (admins only) — grant or revoke the Admin role by email
- 🧾 **Audit trail** for every status transition
- 📱 Responsive layout

## How discovery works

```
Docker containers  ->  Discovery worker  ->  API  ->  PostgreSQL  ->  Dashboard
```

The worker talks to the **local Docker socket only** — no SSH, no remote host, no
stored credentials. It runs every 5 minutes and reconciles the inventory:

| Situation | What happens |
|---|---|
| New container appears | Application created, `status=Active`, business metadata left blank for an admin |
| Container still running | `last_seen` refreshed; nothing else touched |
| Container stopped or gone | `status=Inactive`, one notification raised. **Never deleted, never auto-decommissioned.** |
| Container comes back | `status=Active`, recovery notification, outage notification resolved |

**Grouping:** containers in the same Compose project count as **one** application,
so a tool made of frontend + backend + db is a single entry. A `sat.url` or
`sat.name` label opts a container out of grouping and makes it its own tool.

**Exclusions:** databases, caches and reverse proxies are skipped by image, and
the portal never inventories itself. `DISCOVERY_EXCLUDE` adds names or projects.

**Field ownership — the rule discovery must never break:**

| Owned by discovery | Owned by admins |
|---|---|
| `name`, `url`, `status`, `source`, `first_seen`, `last_seen`, `discovery_status` | `team`, `developed_by`, `gstack_implemented`, `decommissioned`, `notes` |

Discovery never writes an admin-owned column, and the API ignores server-owned
fields sent to `PUT /applications/:id`. **Only an admin can decommission** — the
system never makes that call itself.

### Testing discovery locally

An isolated stack with three fake tools, its own database and its own ports:

```bash
docker compose -p sattest -f docker-compose.test.yml up -d --build
node scripts/test-discovery.mjs
docker compose -p sattest -f docker-compose.test.yml down -v
```

Covers all six acceptance scenarios: auto-create, stop → Inactive + notification,
restart → recovery, admin metadata surviving a sync, container removal not
deleting the record, and audit records. 54 assertions.

> If the normal stack is also running on the same machine, keep `sattest` in
> `DISCOVERY_EXCLUDE` so the harness does not appear in your real inventory.

## Getting started

The frontend needs the API, and the API needs PostgreSQL. Start the backend first.

### 1. Configure

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` and `SEED_ADMIN_EMAIL` (the first admin — without one,
nobody can grant access to anyone else).

### 2. Start PostgreSQL + the API

```bash
docker compose up -d --build
```

- API → http://localhost:4000 (health check: `/api/health`)
- PostgreSQL → `localhost:5433` (exposed so you can inspect it with psql/DBeaver)

The schema is applied on every boot and is idempotent, so restarts are safe. Data
lives in the `sat_pgdata` volume and survives `docker compose down`.

To run the API without Docker (needs a reachable PostgreSQL):

```bash
cd backend && npm install && npm run dev
```

### 3. Start the frontend

```bash
npm install
npm run dev
```

Opens at http://localhost:5180. The Vite dev server proxies `/api` to
`http://localhost:4000`, so there are no absolute URLs or CORS preflights in dev.

### Demo mode (no Azure tenant required)

While `VITE_AZURE_CLIENT_ID` is unset the app runs in **demo mode**: the Microsoft
popup is simulated and the login page offers "As Admin" / "As User" to preview
both roles.

Demo mode affects **authentication only** — application and admin data always come
from PostgreSQL, so the backend must be running either way.

### Connecting real Microsoft auth

1. Set `VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_ID` from your Azure App
   Registration. A real client ID automatically disables demo mode.
2. Add your deployed frontend URL to `CORS_ORIGINS`.
3. Set `VITE_API_BASE_URL` only if the API is served from a different origin than
   the SPA.

With real auth, a signed-in user's role is resolved from the `admins` table, so a
grant on the Admin Access page takes effect on that person's next sign-in.

## REST API

All routes are under `/api`. Errors return `{ "message": "..." }`.

| Method | Endpoint                              | Auth      | Purpose                            |
| ------ | ------------------------------------- | --------- | ---------------------------------- |
| GET    | `/api/health`                         | public    | Liveness + database + Docker check  |
| GET    | `/api/users/me`                       | signed in | Caller's identity + role            |
| GET    | `/api/applications`                   | signed in | List applications                   |
| PUT    | `/api/applications/:id`               | **admin** | Update **business metadata only**   |
| GET    | `/api/applications/:id/events`         | signed in | Audit trail                         |
| GET    | `/api/applications/discovery`          | signed in | Scheduler state + last result       |
| POST   | `/api/applications/discovery/run`      | **admin** | Trigger a discovery pass now        |
| GET    | `/api/notifications`                  | signed in | List (filter by `type`, `unread`)   |
| GET    | `/api/notifications/unread-count`      | signed in | Badge count                         |
| PUT    | `/api/notifications/:id/read`          | **admin** | Mark one read                       |
| PUT    | `/api/notifications/read-all`          | **admin** | Mark all read                       |
| GET    | `/api/admins`                         | **admin** | List admins                         |
| POST   | `/api/admins`                         | **admin** | Grant admin access `{ email }`      |
| DELETE | `/api/admins/:id`                     | **admin** | Revoke admin access                 |

There is deliberately **no `POST /api/applications`** (applications are discovered)
and **no `DELETE`** (inventory history is permanent). Both return `404`.

Server-side rules worth knowing:

- Application names are unique (case-insensitive) → `409` on a duplicate.
- The **last** admin cannot be removed → `409`, so the portal can't be orphaned.
- An admin **cannot revoke their own** access → `409`, enforced in the API as
  well as the UI.
- `ADMIN_ALLOWED_DOMAINS` (comma-separated, blank = any domain) restricts who may
  be granted admin access. Enforced in the API, not just the UI.
- "Added by" attribution is taken from the caller's token, never from the request
  body, so it can't be forged.

## Authentication

Every route except `/api/health` requires an Azure AD bearer token, verified
against the tenant's JWKS (signature, issuer, audience, expiry). Identity comes
only from the token; the role comes only from the `admins` table.

**Setup:** see [`docs/AZURE-SETUP.md`](docs/AZURE-SETUP.md) — the app must be
registered as a **single-page application** with an exposed
`api://<client-id>/access_as_user` scope.

**Before a tenant exists**, `DEV_AUTH_BYPASS=true` skips verification and treats
every request as `DEV_AUTH_EMAIL`. It is force-disabled when
`NODE_ENV=production`, warns loudly on every boot, and **must be `false` in any
shared or production environment**.

## Project structure

```
backend/
├── schema.sql              # Idempotent DDL
├── Dockerfile
└── src/
    ├── server.js           # Express app, CORS, health, shutdown
    ├── db.js               # pg Pool, boot-time schema + admin seed
    ├── auth.js             # Azure JWKS verification, requireAuth/requireAdmin
    ├── errors.js           # ApiError, asyncRoute, error handler
    ├── discovery/
    │   ├── docker.js       # local Docker socket wrapper
    │   ├── discovery.js    # container -> application mapping, grouping, filters
    │   ├── sync.js         # reconciliation, notifications, audit (ownership rules)
    │   ├── scheduler.js    # node-cron loop, overlap guard
    │   └── worker.js       # standalone worker entrypoint
    └── routes/             # applications, admins, users, notifications

scripts/
└── test-discovery.mjs      # discovery acceptance tests

docs/
└── AZURE-SETUP.md          # App registration guide for the tenant admin

src/
├── assets/                 # CloudFuze logo
├── components/             # Sidebar, Header, Table, Modal, Charts, …
├── context/                # Auth, Toast providers
├── hooks/                  # useApplications
├── layouts/                # MainLayout (app shell)
├── pages/                  # Login, Dashboard, Applications, AdminAccess, NotFound
├── services/              # Axios instance + API service layer
├── styles/                 # Brand design tokens + global styles
├── utils/                  # Helpers (validation, sorting, formatting)
├── authConfig.js           # MSAL configuration + DEMO_MODE flag
├── App.jsx                 # Route tree
└── main.jsx                # Entry point / provider composition

docker-compose.yml          # postgres:16 + api
```

## Available scripts

**Frontend** (repo root)

- `npm run dev` — start the dev server on :5180
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — run ESLint

**Backend** (`backend/`)

- `npm run dev` — start the API with file watching
- `npm start` — start the API
