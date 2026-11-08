# Pharos DeepSpace host

This folder builds Beacon, the private warning PWA, and the Worker API from maintained sources in `Product/`. The deployed app uses SQLite-backed Durable Objects for calls, current case snapshots/history, encrypted contacts, prior-risk observations, response progress, warnings, access, and audits.

The app has been published and checked for health 200, protected overview 401 without login, and recipient assets 200. One real consented fictional Photon intake persisted a three-person case. The protected two-phone relay/banner and live ETA announcement remain manual acceptance gates. **Hosted startup is RUNNING.** Synthetic WebRTC speech, case persistence, disconnect, and room cleanup worked, but overall audio acceptance remains open: a later generic library remark lost the precise area, and its fix needs a rerun. This is not new Photon-call proof; the old local worker is stopped.

## Build and QA

From this directory:

```sh
npm run typecheck
WRANGLER_LOG_PATH=/tmp/pharos-wrangler-build.log npm run build
npm test
```

The build copies maintained interface/PWA assets, compiles the Worker, removes generated local-secret files, and writes `build.json` with the source commit, dirty flag, and build time. Generated assets are not the editing source.

The last completed root-owned watcher checkpoint reported **152 backend, 76 offline voice, and 35 UI contract checks passing**. It rebuilds only in the backend lane; its tests use fixtures/mocked providers and its voice lane supplies dummy credentials with network denial. See [QA_WATCH.md](../QA_WATCH.md). Before a manual build/deployment, pause the backend lane and wait for `active:false`:

```sh
node ../qa-watch.mjs --pause-backend
node ../qa-watch.mjs --status
```

Resume afterward with `--resume-backend`. These local checks do not establish device push delivery, phone audio, model interpretation accuracy, or production emergency readiness.

## Deploy and verify

Use the existing authenticated DeepSpace account and app; do not create duplicates. App secrets have been uploaded using merge semantics. Keep `.dev.vars`, runtime env files, SIP credentials, test numbers, and private warning links out of Git/output. Never upload the whole local platform environment or replace unrelated secrets.

From this directory, after the intended source is committed and the watcher is idle/paused:

```sh
node_modules/.bin/deepspace auth whoami
node_modules/.bin/deepspace deploy --json
```

Check `/api/auth/ok`, `/api/health`, unauthorized `/api/overview`, `/guard.html`, and `/guard-worker.js`. After the next publish, check `/build.json` against the intended Git commit and require `dirty:false`. The deployment service reported no recoverable GitHub-source lineage even for a clean tree, so use the public source stamp plus the pushed repository as explicit evidence. Resume the watcher after manual build work ends.

Without responder/session secrets, the API exposes and mutates only synthetic demo records. Protected intake requires the responder password, session secret, and ingest token; use the separate coordinator password for approvals. Shared sessions and area filtering are prototype safeguards, not individual identity or per-area authorization.

## Behavior and API

- Atomic consented voice events are ordered/idempotent, update partial cases, and preserve incomplete-delivery follow-up. Guard sessions cannot create help cases.
- Repeat intake reports preserve the legacy keyed lookup and use explicit same-situation/current-location checks. Encrypted contacts and help/risk lookup domains are separate. Three distinct prior contextual guard warnings create a cautious history notice; current analysis remains required.
- Claims and follow-up ownership account for capacity. Reasoned priority changes remain auditable. Fresh danger, changed location, and invalid coverage trigger reassessment rather than losing the owner.
- Response progress requires an eligible physical assignee and the current case version. The desk supplies any ETA; expiry never means arrival. The voice service reads deterministic progress messages, not model-generated estimates.
- Semantic guard reviews require current consent, caller-only exact evidence, a current sequence, and supported action/pressure signals. Invalid/unavailable results remain unverified. Scheduled expiry and withdrawal scrub relevant text, evidence, contacts/risk history, access, and subscriptions.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/ok`, `/api/health` | Public deployment/route/retention status. |
| `GET /api/overview`, `/api/cases?zone=<id>` | Protected desk and ranked area cases; synthetic-only in demo mode. |
| `POST /api/demo/calls`, `/api/scam/analyze` | Fictional transcript workbench and rule-based message inspection; this is not the live semantic reviewer. |
| `POST /api/responders`, `/api/responders/<id>/approval` | Registration and coordinator approval. |
| `POST /api/cases/<id>/claim`, `/status`, `/priority`, `/followup-owner`, `/progress` | Assignment, lifecycle, reasoned priority, follow-up, and versioned desk-reported response progress. |
| `POST /api/voice/ingest` | Ingest-bearer events including start, consent/withdrawal, ordered turns, context review/unavailable, and completion. |
| `GET /api/voice/calls/<id>/progress` | Ingest-bearer-only minimal, consented intake response message. |
| `POST /api/guard/enrollment` | Authorized fixed test-recipient private 24-hour pairing. |
| `GET /api/guard/status`, `POST /api/guard/subscribe`, `/unsubscribe` | Recipient-scoped warning/review status and push subscriptions. |
| `POST /api/guard/received` | Signed warning-specific device-display receipt. |
| `POST /api/auth/login`, `/logout`, `GET /api/auth/status` | Responder/coordinator sessions. |

Web Push is configured server-side but requires Phone B setup and permission. SMS remains disabled with no campaign upgrade. For the four remaining manual calls and safe recording, follow [DEMO_RUNBOOK.md](../DEMO_RUNBOOK.md); use [SYSTEM_PLAN.md](../SYSTEM_PLAN.md) for architecture and boundaries.
