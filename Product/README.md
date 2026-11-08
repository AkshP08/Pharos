# Pharos

**Flare** is a resident phone hotline. **Beacon** is the responder website: it ranks changing reports by explainable urgency and service area, keeps accountable owners, and records human response updates. Residents do not fill out a help form or give a name. A separate protected-call mode reviews caller words for psychological pressure and can warn a paired resident phone.

**Start with [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).** It covers the two test phones, readiness checks, four manual calls, recipient setup, and a three-minute demonstration.

## Verified status

The [DeepSpace app](https://signalbridge-hackutd-2026.app.space) is deployed. Hosted health, authentication protection, and recipient assets were checked. One real consenting fictional Photon call reached LiveKit speech recognition and persisted a three-person case with 16 turns and no transcript-delivery failure. This is real phone-integration evidence; it is not a claim of operational emergency dispatch.

The last completed QA checkpoint reported passing lanes: **152 backend checks, 76 offline voice checks, and 35 Guard/Beacon UI contracts**. A root-owned file-change watcher is active; [QA_WATCH.md](QA_WATCH.md) explains its status and pause controls. These checks do not prove a phone banner, microphone performance, or a real-world fraud-detection accuracy rate.

**Hosted voice startup: RUNNING; audio acceptance: OPEN.** A synthetic WebRTC test reached speech recognition, persisted an urgent three-person shelter case, and completed disconnect/room cleanup. The overall test failed because a later generic library remark replaced the precise location and lost area routing; that regression is being fixed and must be rechecked. This test is not a new Photon call. The old local worker is stopped; confirm the current version and active mode before manual calls. The shorter phone opening, live responder announcement, real worsening callback, two-party relay, and actual Phone B banner still need their current-build manual checks.

## What the app does

- **Updates during and between calls.** Consented partial turns reach the desk before hangup. Conservative returning-call linkage requires the same-situation report, a substantial current-location match, and one eligible recent open case. The latest report replaces current facts while history and ownership remain visible.
- **Routes by urgency and area.** Explicit danger, time-sensitive needs, and missing facts produce explained suggestions. Unknown location stays visible, including immediate cases. Approved capability, coverage, availability, and capacity determine assignment eligibility.
- **Keeps humans accountable.** The desk can claim, own follow-up, review priority with a reason, resolve/reopen, and report travel, delay, arrival, or inability to attend. An ETA is supplied by the desk; new danger or changed coverage can invalidate it. A claim alone does not mean help was dispatched.
- **Reviews manipulation in context.** Guard mode uses bounded model review of consented caller text. Exact evidence and psychological labels explain the warning; invalid, stale, or unavailable output is withheld and explicitly unverified. Tone, accent, and caller identity are not model inputs.
- **Remembers contacts cautiously.** Phone contacts are encrypted at rest with purpose-separated keyed lookups and at most 24-hour retention. Three distinct prior flagged guard calls can produce a caller-ID-history caution. That does not prove identity, block help, or replace current speech analysis.
- **Warns a paired phone.** A private 24-hour link pairs the optional warning PWA before a guard call. Foreground display and permission-based Web Push are implemented. Actual notification delivery during a two-phone call remains unverified; provider acceptance, device-reported display, and human reading are separate facts. SMS is disabled.

## Runtime and limits

```text
Help mode: Phone A → Photon → LiveKit intake/STT → protected Worker → SQLite case → Beacon
Guard mode: Phone A → Photon/LiveKit → Phone B; caller transcript → context review → paired PWA
```

The single Photon number serves these test modes **sequentially**. The operator changes the runtime/dispatch deliberately between demonstrations. Pharos cannot screen arbitrary cellular calls to a personal number. Spoken location is matched to configured prototype areas; it is not GPS or flood sensing.

The approved spending boundary is **$5 existing Photon credit, no cash, one number, no paid-plan or SMS campaign upgrade**. The number used $2; test-call usage consumes the remainder and must be reconciled. LiveKit model checks have a separate **$0.25 existing-credit cap**. See [PHOTON_SETUP.md](PHOTON_SETUP.md) for observed rates and account state.

The Worker stores no raw audio. Transcript sharing starts after clear consent, withdrawal stops collection and scrubs relevant evidence/access/contact history, and scheduled retention is at most 24 hours. Minimal structured request facts may remain. Provider processing and recipient-device copies have separate limits.

## Build, evidence, and submission

Use [deepspace-host/README.md](deepspace-host/README.md) for builds, deployment, private server configuration, and API routes; [voice-agent/README.md](voice-agent/README.md) for runtime setup. The build generates a public `build.json` source stamp: after publishing, verify its commit and `dirty:false` against the intended Git revision. The deployment service's GitHub-source metadata does not itself provide reliable commit lineage.

[PROJECT_LOG.md](PROJECT_LOG.md) records failures, fixes, tests, and plan changes. [DELIVERY_CHECKLIST.md](DELIVERY_CHECKLIST.md) tracks remaining acceptance gates, and [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md) links judge recommendations to owners and verification. The canonical repository is [AkshP08/Pharos](https://github.com/AkshP08/Pharos).

State Farm, T-Mobile Safe Signal, Photon, and General/Beginner are the intended targets. The supplied T-Mobile slide permits team-created synthetic scenarios. MongoDB Atlas, Tiger Data, Gemini API, Solana, and Vultr are not integrated or claimed. Urgency suggestions are prototype rules, profiles/areas are demonstration data, and shared passwords are not verified responder identities. Final submission is November 8, 2026 at noon CST; the initial Devpost entry exists.
