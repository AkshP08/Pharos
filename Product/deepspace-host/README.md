# Pharos DeepSpace host

This folder builds the deployed Pharos interface and Worker API. Product sources live one level up in `Product/`. The Worker uses SQLite-backed Durable Object storage and serves both the API and static assets.

## Build and deploy

- `npm run build` copies the maintained `Product/` interface into the host and builds the Worker/assets.
- `npx deepspace auth whoami` checks the signed-in DeepSpace account.
- `npx deepspace deploy` publishes the working tree to `https://signalbridge-hackutd-2026.app.space`.
- After a deployment, check `/api/health` and open the app. The synthetic transcript workbench should create a persisted call and case.

The public app starts in demo-only mode until responder/session secrets are configured. In demo-only mode, API responses expose only synthetic records. Use fictional responder names/organizations in the public profile form. To enable protected live intake, configure the variables in `../.env.example` in DeepSpace's secret/variable settings. Never put real secrets in this repository, static assets, or frontend code.

Live voice events are accepted at `/api/voice/ingest` only with the shared `PHAROS_INGEST_TOKEN` and after responder authentication is configured. The route requires call start, explicit consent, ordered transcript turns, and call end. The Pharos API receives text only; the LiveKit agent receives the call audio.

## API surface

- `GET /api/health` — storage, auth mode, transcript retention, and route-config status.
- `GET /api/overview` and `GET /api/cases?zone=<id>` — responder dashboard data and area-filtered ranked cases.
- `POST /api/demo/calls` — process an explicitly synthetic transcript through the same analysis rules.
- `POST /api/scam/analyze` — run the transparent content-only wording review.
- `POST /api/responders` and `POST /api/responders/<id>/approval` — register and approve area/capability profiles.
- `POST /api/cases/<id>/claim` and `/status` — claim a matched case or set its review state.
- `POST /api/voice/ingest` — protected LiveKit events for `call.started`, `consent`, `turn`, and `call.ended`.
- `POST /api/auth/login` and `/logout`, `GET /api/auth/status` — responder/coordinator session handling.

See [the product README](../README.md), [system plan](../SYSTEM_PLAN.md), and [Photon setup](../PHOTON_SETUP.md) for the call path, triage rules, data limits, and remaining setup.
