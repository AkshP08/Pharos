# Pharos

Pharos is a **responder-facing disaster intake desk**. A resident calls the hotline; Pharos collects a brief consented report. Beacon keeps requests ranked by reported urgency and area while separately highlighting requests that need human verification.

[Open Beacon](https://signalbridge-hackutd-2026.app.space) · [Demo runbook](DEMO_RUNBOOK.md) · [Delivery checklist](DELIVERY_CHECKLIST.md)

## The current product

```text
Caller → Photon → LiveKit speech/intake → protected Worker + SQLite → Beacon
                                    ├─ urgency, location, needs, changing history
                                    └─ bounded caller-text review → review badge
```

- Every intake request remains in the urgency queue, including concerning or incomplete reports. Immediate-danger facts remain visible; a review badge never reduces their reported urgency.
- No supported content concern permits normal responder assignment. A flagged, pending, uncertain, or unavailable assessment requires explicit human acceptance before assignment or an ETA. An accepted decision records its reason and exact evidence version. Dismissal keeps the request and audit history.
- Psychological review looks for concrete unsafe requests and supporting pressure: money/secrets, device control, or explicitly bypassing safeguards. A separate verification basis covers an explicit current false-report admission plus a request to divert resources. It cannot establish whether an emergency is real from speech alone.
- Fear, anger, panic, accent, missing names, corrected details, and ordinary urgent rescue requests are not fraud signals. “No concern identified” does not verify identity or truth.
- Human reviewers can read exact quoted evidence and, when recording consent was given and upload completed, manually play private caller-only audio. Tone and pacing provide human context; they are not automatic deception scores.
- New reports update current facts, urgency, area, history, ownership review, and response estimates. Conservative same-phone callback linkage requires fresh consent, explicit same-situation intent, and a substantial matching location. No name is required.
- Responders own actual decisions. Travel and arrival estimates require an explicit desk report; the bot never invents an ETA or infers arrival from elapsed time.

## Evidence and remaining acceptance

One real consenting fictional Photon call reached speech recognition and persisted a three-person case. A later hosted synthetic WebRTC check passed speech, persistence, location/area retention, completion, and cleanup after finding and fixing a generic-location overwrite. That is simulation evidence, not a replacement for a current Photon call.

The **responder-review and recording build passes 243 compiled backend/UI checks and 108 offline voice checks**. Hosted recording playback and current-build real calls remain separate acceptance gates. Check the watcher status rather than reusing a green result after new edits:

```sh
node Product/qa-watch.mjs --status
```

The new six-case fictional model check produced matching warning decisions in all six, with one preselected tactic-category mismatch. It is a small synthetic test, not field accuracy or a lie-detection claim. Prior failed evaluations remain preserved.

The current-build phone acceptance is three scenarios: genuine help with an emotional benign control, worsening callback to the same case, and an explicit concerning request held for reasoned human review with private recording playback. See the runbook for scripts and failure criteria.

## Consent, storage, and limits

The brief opening asks permission for transcript and caller audio and offers **transcript only**. Audio starts after explicit recording consent is acknowledged; consent-and-facts spoken in the same opening utterance may not be recorded. No raw audio is kept before that acknowledgment. Caller-only PCM is bounded to 180 seconds, encrypted in existing SQLite storage, and served only to signed-in responders. Clear completed calls discard audio; retained review evidence expires within 24 hours of its source call and is removed on consent withdrawal. Provider retention has separate limits.

Phone contacts use encrypted storage and purpose-separated keyed lookup. Caller ID is unverified and can be spoofed. The older three-call history caution is advisory; it cannot establish fraud or replace current evidence.

The approved boundary remains one Photon number, at most **$5 existing Photon credit, no cash**, no paid-plan or SMS campaign upgrade, and **$0.25 existing LiveKit model-check credit**. No new recording service or external storage account is required. Shared desk passwords and configured areas/responders are prototype fixtures, not verified responder identities, GPS, flood sensing, or operational emergency dispatch.

## Build and submission

The source is [AkshP08/Pharos](https://github.com/AkshP08/Pharos). Completed task chunks are committed and pushed using the configured human author. [PROJECT_LOG.md](PROJECT_LOG.md) records failures, workarounds, decisions, and validation; [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md) tracks feedback acceptance.

Use [deepspace-host/README.md](deepspace-host/README.md) for builds/APIs and [voice-agent/README.md](voice-agent/README.md) for voice setup. After publishing, require `/build.json` to match the intended committed source with `dirty:false`; the platform itself omits GitHub commit lineage.

State Farm, T-Mobile Safe Signal, Photon, and General/Beginner are the intended targets. Supplied T-Mobile instructions permit team-created scenarios. MongoDB Atlas, Tiger Data, Gemini API, Solana, and Vultr are not integrated or claimed. The initial Devpost entry exists; final submission is November 8, 2026 at noon CST.

**Future work:** resident-facing scam alerts through a paired app, push/SMS, and protected two-party calls. The earlier Guard/PWA experiment is not a required or verified part of the current responder-only demo; relay and SMS remain disabled.
