# Security review — SAT Monitoring discovery

Reviewed: the Docker discovery subsystem after production hardening.
Scope: `backend/src/discovery/*`, `backend/src/auth.js`, the API routes it feeds,
and the compose topology.

---

## 1. Trust boundaries

```
   Internet / LAN
        │
        ▼
   ┌──────────┐   Bearer token verified against Azure JWKS
   │   API    │   No Docker access · read-only FS · no-new-privileges
   └────┬─────┘
        │ SQL + NOTIFY               (no direct call path to the worker)
        ▼
   ┌──────────┐
   │ Postgres │   internal network only, port bound to 127.0.0.1
   └────┬─────┘
        │ SQL + LISTEN
        ▼
   ┌──────────┐   /var/run/docker.sock:ro   ← the only privileged component
   │  Worker  │   No ports published · unreachable from the network
   └────┬─────┘
        │ read-only
        ▼
   Docker daemon · nginx config
```

The security case rests on one property: **the component with Docker privilege
has no network listener.** The worker cannot be reached by a user at all; the
only way to influence it is a row/notification in Postgres, which requires
already having database access.

## 2. What the hardening changed

| Before | After | Why it matters |
|---|---|---|
| API mounted `docker.sock` | **API has no Docker access**; worker only | The API is the internet-facing, user-authenticated process. Socket access there means any RCE in the API — a dependency CVE, a deserialisation bug — is immediately host root. |
| API executed discovery synchronously | API sends `NOTIFY`, worker executes | Removes the privileged code path from the request/response cycle entirely. |
| URL guessed from container name | Label → nginx → **flag "Needs Mapping"** | A guessed hostname is a *false statement in a monitoring tool*. Operators trusted `aicommunication.cftools.live` because the portal displayed it, even when nothing was there. |
| New containers auto-tracked | `pending_review` until approved | An unexpected container appearing on the host no longer silently becomes a tracked application. Gives a human a checkpoint. |
| In-process overlap flag | **Postgres advisory lock** | The old flag was per-process; with a separate worker and API it guaranteed nothing. |
| Postgres published on `0.0.0.0:5433` | Bound to `127.0.0.1:5433` | Was reachable from the LAN with the DB password as the only control. |
| Writable container FS | `read_only: true`, `no-new-privileges` | Reduces what a foothold can persist or escalate. |

## 3. Remaining risks

### R1 — Docker socket access is root-equivalent (HIGH, accepted)

`:ro` restricts writes *to the socket file*, **not** what the daemon will do when
asked. Anything that can talk to the daemon can start a privileged container that
mounts the host filesystem — i.e. full host compromise.

This is inherent to Docker-based discovery. Mitigations in place:

- Confined to the worker, which publishes no ports
- Worker runs read-only with `no-new-privileges`
- Worker performs only `listContainers` and `inspect` — no create/exec/attach

**Residual:** a supply-chain compromise of `dockerode`, `pg`, `node-cron` or the
Node base image would inherit that privilege. Recommended further steps, in order
of value:

1. Put a **socket proxy** in front of it (e.g. `tecnativa/docker-socket-proxy`)
   allowing only `GET /containers/json` and `GET /containers/*/json`. This turns
   "root-equivalent" into "read-only container listing" and is the single highest
   -value change available.
2. Pin base images by digest and enable automated dependency scanning.
3. Run the worker as a non-root user in the `docker` group rather than root.

### R2 — Worker runs as root inside the container (MEDIUM)

The image sets no `USER`, so the worker is uid 0. Combined with R1 this widens
the blast radius of any code-execution bug. Not exploitable on its own, since
nothing reaches the worker over the network.

**Fix:** add a non-root user to the Dockerfile and grant it the host `docker`
group GID. Left undone because the GID varies per host and a wrong value silently
breaks discovery — it needs a deployment-time decision.

### R3 — nginx config is parsed with a hand-written parser (MEDIUM)

`nginx.js` does brace-matching and regex extraction, not real nginx grammar. Two
consequences:

- **Wrong URL attribution.** A config shape it misreads could map a hostname to
  the wrong container, so the portal would link tool A at tool B's address. It
  fails closed to "no match" in most cases, but a mis-parse producing a *wrong*
  match is possible.
- The mount is `:ro` and nothing is executed, so there is no injection path.

**Mitigation:** `sat.url` labels take priority and are exact. Prefer labels for
anything security-relevant; treat nginx resolution as a convenience.

### R4 — `DEV_AUTH_BYPASS` exists (MEDIUM, mitigated)

Setting it true disables all token verification. Guards: force-disabled when
`NODE_ENV=production`, ships `false`, and logs a warning on every boot. It is
still a single environment variable between "authenticated" and "open", and
`NODE_ENV` is itself operator-supplied.

**Recommendation:** delete the bypass entirely once the Azure app registration is
final. It exists only because the app had to run before the tenant existed.

### R5 — Postgres is the trust channel between API and worker (LOW/MEDIUM)

Anyone who can execute SQL as the app user can `NOTIFY sat_discovery_run` and
force scans, or write directly to `applications` bypassing every ownership rule
and audit record. The database credential is therefore as sensitive as the API's
auth.

Mitigations: internal network, `127.0.0.1`-bound port, password in `.env` only.
**Not mitigated:** the API and worker share one database role. A stricter design
would give the worker write access only to the tables it owns and the API no
write access to `discovery_runs`.

### R6 — Notification and audit tables grow without bound (LOW)

`notifications`, `application_events` and `discovery_runs` only ever grow; a
flapping container produces a row pair per transition. At 5-minute intervals this
is slow, but there is no retention policy. Audit rows are deliberately permanent;
`discovery_runs` is the one that should be pruned.

**Fix:** a retention job for `discovery_runs` older than ~90 days.

### R7 — Unauthenticated health endpoint reveals discovery state (LOW)

`GET /api/health` returns `discovery: ok|stale|failing`. That is a small
information leak about internal health to anyone who can reach the API. Judged
acceptable because load balancers need an unauthenticated probe, and it exposes
no application names, URLs or counts.

### R8 — No rate limiting (LOW)

Any authenticated operator can request scans in a loop. The advisory lock and
request coalescing mean this cannot stack passes, so the practical impact is
bounded — but there is no explicit limit.

### R9 — Container labels are attacker-controlled if container creation is (LOW)

`sat.url` and `sat.name` come from labels. Whoever can start a container on the
host can therefore choose an application's displayed name and URL, including
pointing it at an external site. This requires host access, which already implies
far more serious compromise, and `pending_review` puts a human in the loop before
such an entry becomes active. Worth knowing rather than fixing.

## 4. Properties verified by test, not assumption

The 98-assertion suite (`scripts/test-discovery.mjs`) covers:

- API reports `dockerAccess: false`; its scheduler is disabled; a scan is a
  *request* (202), executed by the worker
- URL priority: label → nginx → `needsMapping` with **no invented hostname**
  (explicitly asserts the old name-derived URLs no longer appear)
- Infrastructure exclusions for all ten named types
- `pending_review` on creation; discovery does **not** self-approve; approval is
  audited against the admin; re-approval rejected
- Sending `name`, `url`, `status`, `source`, `discoveryStatus` to the metadata
  route is **ignored**; admin metadata survives repeated passes
- Container removal never deletes; never auto-decommissions; history preserved
- `POST` and `DELETE /applications` return 404
- Concurrent scan requests leave no unfinished or errored run and no duplicate
  applications

## 5. Verdict

The design is sound for an internal tool. The material improvement is removing
Docker privilege from the network-facing process — that closes the most direct
path from "authenticated user" to "host root".

**R1 is the risk that matters.** Everything else is defence in depth or
housekeeping. If one further change is made, it should be the read-only Docker
socket proxy; that reduces the worst case from host compromise to information
disclosure.

**Not addressed here** (outside discovery, still open from the deployment audit):
no frontend container or TLS story, placeholder database password, and
`ADMIN_ALLOWED_DOMAINS`/`DISCOVERY_OPERATORS` needing to be set in the production
environment rather than inherited from a developer's `.env`.
