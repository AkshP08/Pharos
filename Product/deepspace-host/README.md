# Pharos DeepSpace host

This folder builds the responder interface, private recipient warning PWA, and Worker API from maintained sources one level up in `Product/`. SQLite-backed Durable Object storage persists calls, changing cases, ownership, warnings, and audit events. The latest revision still awaits production deployment; actual Photon audio and phone-notification delivery remain unverified.

## Build, test, and deploy

```sh
npm run typecheck
WRANGLER_LOG_PATH=/tmp/pharos-wrangler-build.log npm run build
npm test
```

Build copies the maintained interface/PWA assets, compiles the Worker, and removes generated local secret files from output. Tests never load `.dev.vars` or call external services; Miniflare tests need local loopback sockets. Most recent completed verification: **93 Worker/client/domain/notification tests passed**, including repeat-case regressions. The separate voice suite passed **22 tests**. Local results do not prove real audio or notification delivery.

Check the existing authenticated account with `npx deepspace auth whoami`. Eleven selected app secrets have already been uploaded using merge semantics and apply at deployment; publish with `npx deepspace deploy`. Do not upload platform credentials from the local environment or replace unrelated deployment secrets. After deployment, check `/api/auth/ok`, `/api/health`, login protection, and the persisted synthetic workbench flow.

Without responder/session secrets, the API exposes and mutates only synthetic demo records. Protected intake requires `PHAROS_RESPONDER_PASSWORD`, `PHAROS_SESSION_SECRET`, and `PHAROS_INGEST_TOKEN`; use a separate `PHAROS_COORDINATOR_PASSWORD` for profile approval. Keep secrets server-side and untracked. Shared passwords and the area filter are not individual identity or per-area authorization.

## Behavior

- Consent-gated ordered events update partial cases during calls; retries are idempotent and incomplete delivery requests follow-up.
- Repeat SIP intake reports use an internal keyed phone-number hint plus explicit same-situation intent, a substantial current-location match, and one eligible recent open case from an ended call. Raw phone numbers are not persisted or returned. Unknown/ambiguous/shared-location and overlapping reports remain separate. Latest snapshots/history and reassessment pass local regression tests.
- Human priority changes require a reason. Claim/follow-up ownership and resolution/reopening account for responder capacity; changed coverage requires assignment review.
- Guard calls generate separate deduplicated warnings, never help cases. Recipient pre-enrollment supports later guard warnings; Web Push and optional disabled SMS distinguish provider acceptance from device display.
- Scheduled retention scrubs live text/evidence, access, and caller linkage within at most 24 hours. Minimal structured help facts may remain. Withdrawal stops collection and scrubs the relevant evidence/access.

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/ok`, `GET /api/health` | Deployment health, auth/retention, route status. |
| `GET /api/overview`, `GET /api/cases?zone=<id>` | Protected dashboard and ranked area cases; synthetic-only in demo mode. |
| `POST /api/demo/calls`, `POST /api/scam/analyze` | Fictional workbench and content-only pressure review. |
| `POST /api/responders`, `POST /api/responders/<id>/approval` | Profile registration and coordinator approval. |
| `POST /api/cases/<id>/claim`, `/status`, `/priority`, `/followup-owner` | Assignment, lifecycle, reasoned priority, and accountable follow-up. |
| `POST /api/voice/ingest` | Bearer-protected `call.started`, `consent`, ordered `turn`, `call.ended`, and `consent.revoked`. |
| `POST /api/guard/enrollment` | Authorized private 24-hour fixed test-recipient enrollment. |
| `GET /api/guard/status`, `POST /api/guard/subscribe`, `/unsubscribe` | Recipient-token-scoped warnings and push subscriptions. |
| `POST /api/guard/received` | Signed alert-specific device-display receipt. |
| `POST /api/auth/login`, `/logout`, `GET /api/auth/status` | Responder/coordinator sessions. |

Web Push needs server VAPID keys/subject and explicit recipient permission; SMS remains disabled without eligible credentials/sender and approved costs. The Photon number, default SIP profile, LiveKit inbound trunk, and intake dispatch exist. Saving Photon SIP authentication/destination and filling the consenting caller allowlist remain pending. Set `PHAROS_VOICE_ROUTE_READY=true` only after a real Photon call succeeds. MongoDB and Tiger Data are future options, not current dependencies.

See [the product README](../README.md), [system plan](../SYSTEM_PLAN.md), [Photon setup](../PHOTON_SETUP.md), and [voice runtime](../voice-agent/README.md) for setup, limits, and account gates.
