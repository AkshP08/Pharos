# Pharos DeepSpace host

Beacon and its protected Worker use SQLite Durable Objects for current cases/history, consented calls, encrypted contacts, independent verification state, encrypted caller-audio chunks, response progress, and audit records. Maintained interface sources live in `Product/`; generated `public`/`dist` assets are not editing sources. Older Guard/PWA endpoints are future experiments outside the responder-only demo.

## Build, QA, and deploy

From this folder:

```sh
npm run typecheck
WRANGLER_LOG_PATH=/tmp/pharos-wrangler-build.log npm run build
npm test
```

Root's watcher has separate backend/build, offline voice, and UI-contract lanes. Check current liveness/fingerprints rather than using old pass counts. Before manual build/deploy:

```sh
node ../qa-watch.mjs --pause-backend
node ../qa-watch.mjs --status
```

Wait for paused:true AND active:false. After the intended files are committed and pushed, use the existing app/account:

```sh
node_modules/.bin/deepspace deploy --json
```

DeepSpace directly invokes Vite; asset synchronization and `/build.json` generation run from Vite configuration as well as the package build script. Verify served commit/dirty:false matches the intended clean revision. The platform's GitHub-source release metadata omits commit lineage even for clean trees; the explicit public stamp plus pushed source provides traceability. Generated local-secret files are removed by the package build/QA cleanup; never publish local variables, credentials, or the whole platform environment.

Verify health/auth, anonymous overview401, anonymous audio401, current UI, authenticated case/review/audio paths, and retention. Resume the watcher with `--resume-backend` after manual work. If a pause leaves an unchanged lane pending, relaunch one root-owned watcher with `--initial`; never start a second competing runner.

## Review and recording contract

All intake remains in the same urgency queue. `integrityReview` is independent of priority: pending, uncertain, unavailable, flagged, and dismissed states block normal claim/ETA server-side until reasoned current-source acceptance. Verification ownership remains possible. Decisions use optimistic version/call/sequence, preserve history/ownership, and never assert real-world truth. A new concern can invalidate an old ETA; later acceptance cannot resurrect it automatically.

Responder semantic reviews require strict `uncertain`, exact caller-only evidence, a current sequence, and consent. Supported unsafe-action pressure or explicit current fabrication+diversion can require review. Ordinary urgency/emotion/corrections and quoted victim reports cannot establish fraud. Invalid/unavailable output stays held, not clear.

Recording requires transcript consent AND explicit audioConsent. Caller-only16kHz monoPCM16 is limited180seconds/5,760,000bytes, ordered64KiB chunks, purpose/call/sequence-bound AES-GCM encryption, and immutable retries. Current clear completed calls discard audio; retained review evidence expires with the source call within24hours. Revocation/expiry removes chunks, evidence, and access. Playback is authenticated WAV with private/no-store caching; no URL credential or public demo fallback. The UI loads manually and clears audio on logout/case change.

## API map

| Endpoint | Contract |
| --- | --- |
| `GET /api/auth/ok`, `/api/health`, `/build.json` | Public liveness/configuration and source metadata; no records/credentials. |
| `POST /api/auth/login`, `/logout`; `GET /api/auth/status` | Shared responder/coordinator sessions. |
| `GET /api/overview`, `/api/cases?zone=<id>` | Protected current queue; synthetic-only fallback when access is unconfigured. |
| `POST /api/cases/<id>/integrity-review` | Reasoned accept/dismiss with expectedVersion/sourceCallId/sequence; server role, optimistic scope, audit. |
| `POST /api/cases/<id>/claim`, `/status`, `/priority`, `/followup-owner`, `/progress` | Guarded ownership, lifecycle, priority review, verification follow-up, and explicit versioned progress/ETA. |
| `POST /api/voice/ingest` | Ingest-bearer start, strict consent/audioConsent, ordered turns, review/unavailable, withdrawal, end. |
| `GET /api/voice/calls/<id>/progress` | Ingest-only minimal server-authored response message. |
| `POST /api/voice/calls/<id>/audio/chunks` | Ingest-only `{sequence,pcmBase64}`; fixed-format bounded PCM encrypted before storage. |
| `POST /api/voice/calls/<id>/audio/complete` | Ingest-only `{lastSequence}`; server retention/discard policy. |
| `GET /api/cases/<id>/audio` | Signed-in responder only; correct retained evidence source, consent/expiry rechecked, private WAV or404. |
| `POST /api/demo/calls`, `/api/scam/analyze` | Explicit fictional/rule-inspection workbench; not the live model or a phone result. |
| `POST /api/responders`, `/api/responders/<id>/approval` | Demo profile registration and coordinator approval. |

Shared passwords and area filters are prototype access, not individual responder identity or per-area authorization. Keep real phone numbers, credentials, caller audio/transcripts, and provider metadata out of Git and public screenshots. See [SYSTEM_PLAN.md](../SYSTEM_PLAN.md), [PROJECT_LOG.md](../PROJECT_LOG.md), and [DEMO_RUNBOOK.md](../DEMO_RUNBOOK.md).
