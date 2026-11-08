# Pharos

**Flare** is a resident phone hotline. **Beacon** is a responder website that organizes reported disaster needs by service area, changing urgency, and accountable ownership. Pressure Trace reviews suspicious wording separately so a scam warning never blocks a help request. Residents do not complete a website intake form.

The local Worker, persistent SQLite store, voice runtime, and optional warning PWA are implemented. The current revision awaits production deployment; **actual Photon calls, live speech recognition, and a phone notification banner are not yet verified**. The initial Devpost entry exists; final submission is November 8, 2026 at noon CST.

## Try the local demonstration

[The existing public demo](https://signalbridge-hackutd-2026.app.space) may lag this revision. Open `index.html` for a static preview, or build/run the Worker in `deepspace-host` for interactive behavior. Direct file access cannot call the backend.

Beacon's synthetic-call workbench processes fictional transcripts through the server rules, persists the call/case, and shows the matched area, urgency reason, eligible responders, and wording evidence. Refresh to check persistence. Synthetic reset preserves non-synthetic records. Demo-only mode exposes only synthetic records; protected live intake requires server secrets.

## What is implemented

- **Cases change during calls.** Ordered consented turns update partial cases before hang-up. Unknown safety/location remains visible; incomplete transcript delivery requests follow-up.
- **Conservative return-call retrieval.** Actual SIP intake metadata supplies a short-lived keyed number lookup, not caller identity. Updating an earlier open request additionally requires explicit same-situation intent, a substantial current-location match, and one eligible recent ended-call case. Ambiguity creates a separate case. The latest report, timestamped history, and reassessment state preserve evolving conditions without requiring a name. Repeat-case regressions pass in the local suite.
- **Human-owned coordination.** Area/capability/approval/availability/capacity determine claim eligibility. Unknown locations can have follow-up owners. Responders can resolve/reopen cases and record priority changes with reasons. Changed coverage flags assignment review; new danger prompts reassessment.
- **Content-grounded warnings.** Exact transcript spans explain psychological pressure such as authority, artificial deadlines, threats, isolation, and risky payment/code requests. Urgency alone is not fraud. No numeric fraud probability or identity claim is made.
- **Pre-enrolled recipient warnings.** A protected responder can pair a consenting test recipient before a guard call using a private 24-hour link. `guard.html` supports foreground warnings and permission-based Web Push. SMS is an optional disabled adapter. Availability, provider acceptance, and device-reported display are distinct states; actual phone delivery remains untested.
- **Consent and retention.** No raw audio enters the Worker. Transcript storage starts after clear consent; withdrawal stops collection and scrubs evidence/access/linkage. Scheduled expiry removes transcript/evidence and private access within at most 24 hours; minimal structured help facts may remain.

Most recent completed local verification: **93 Worker/client/domain/notification tests and 22 voice-runtime tests passed**. These use fictional inputs and local/mocked services, not real phone calls. See [the system plan](SYSTEM_PLAN.md) for the current integration gates and limitations.

## Phone architecture

```text
Photon number → SIP → LiveKit STT / consented intake
  → protected ordered text events → Worker + persistent SQLite
  → changing case / separate pressure warning → Beacon / enrolled recipient
```

The owner provisioned one Photon US number using **$2 existing credit**; the wallet is $98 and **$3 remains of the authorized $5 test budget, with $0 out of pocket**. The default SIP profile, one LiveKit inbound trunk, and intake dispatch rule exist. The owner must finish saving the prepared Photon TLS destination with the generated SIP authentication, and fill the consenting caller allowlist. Eleven selected server secrets were uploaded with merge semantics and apply at deployment. SMS activation/10DLC is pending; no SMS, paid-plan, or campaign upgrade is enabled. Follow [PHOTON_SETUP.md](PHOTON_SETUP.md) and [voice-agent/README.md](voice-agent/README.md); set route-ready only after real end-to-end testing.

Guard mode is a separate, explicitly enabled two-leg call to a fixed consenting test phone. Calls must reach the configured Photon number; Pharos cannot inspect arbitrary calls to a personal number. The optional resident PWA provides warnings and notification setup, not help intake. A telephone call supplies no reliable GPS; location comes from the caller's current report.

## Boundaries and sponsor scope

Urgency rules are not validated emergency triage or dispatch. Response zones/responders are fictional; shared demo passwords do not verify individuals or enforce per-responder area access. A human owns every real-world action. Pharos re-triages as reports arrive; it does not continuously sense rising water or guarantee assistance.

Core targets are State Farm, T-Mobile Safe Signal, Photon, and General/Beginner. Team-created synthetic scam scenarios are permitted by the supplied T-Mobile slide. MongoDB Atlas and Tiger Data are future options, not integrated services or claimed tracks. The LiveKit model choice is not a Gemini API integration.

## Project map

- `index.html`, `styles.css`, `app.js` — Beacon, synthetic workbench, Pressure Trace, animated local Guide.
- `guard.html`, `guard.js`, `guard-worker.js`, `guard.webmanifest` — private recipient warning PWA and notification handling.
- `deepspace-host/worker.ts`, `pharos-store.ts` — authenticated APIs, SQLite persistence, warnings, retention, audit.
- `deepspace-host/pharos-domain.ts`, `pharos-facts.ts`, `pharos-pressure.ts` — facts, routing, urgency, pressure evidence.
- `deepspace-host/pharos-push.ts`, `pharos-notify.ts` — Web Push and optional Photon SMS adapter.
- `voice-agent/agent.py`, `pharos_runtime.py` — LiveKit intake/guard, consent, ordered delivery, cleanup.
- [SYSTEM_PLAN.md](SYSTEM_PLAN.md), [PHOTON_SETUP.md](PHOTON_SETUP.md), [PROJECT_LOG.md](PROJECT_LOG.md) — plan, account gates, and ongoing implementation evidence.
