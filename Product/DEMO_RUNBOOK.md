# Pharos responder-only demo

Submission: **November 8, 2026 at noon CST**. Use consenting teammates and fictional facts. No call requests actual rescue or dispatch.

## Roles and readiness

- **Pharos hotline: (617) 993-9206.** The existing Photon number routes to the automated intake.
- **Phone A:** the consenting teammate calls and plays the scenarios below. Its private allowlisted number is already configured.
- **Laptop:** the signed-in responder opens [Beacon](https://signalbridge-hackutd-2026.app.space), reviews evidence, and coordinates fictional responders.
- **Phone B is not needed.** Resident enrollment, push, SMS, and the old two-party relay are future work.

Before calling, the maintainer verifies one healthy current hosted intake worker, no duplicate local worker, correct source revision, ring timeout 60 seconds, and 180-second call cap. The new review/audio build must be deployed and verified; an old successful call does not prove the new flow. Check current green QA fingerprints and served `/build.json` against the pushed clean commit. Verify unauthenticated overview and audio requests are rejected.

Sign in privately and prepare an approved available fictional responder with Northbank coverage, shelter/evacuation capability, and capacity. Never record credentials, private phone numbers, raw env files, unrelated call history, or provider dashboards.

## Recording consent

For recorded scenarios, answer **“Yes” alone**, then give the facts after Pharos prompts. Recording begins only after acknowledged permission, so combining “yes” and all facts in one utterance may omit that utterance from the recording. The opening also supports **“transcript only”**; declining audio must not itself flag fraud or prevent normal transcript intake.

Audio is caller-only, not a full mixed recording of both sides. Playback appears after recording upload completes, may take a short time after hangup, and is opened manually. The reviewer may hear tone and pacing as context; neither proves lying. Missing recording is not evidence of a scam.

## Three coordinated calls

### 1. Genuine frightened caller → normal urgency queue

After consent say:

> “Please hurry, I am scared. We are safe for now near Northbank library, Zone 2. There are three of us and we need shelter.”

If asked, say there are no injuries and you can wait safely at the library. Verify three people, shelter, Northbank/Zone 2, and Urgent assistance. The later generic library phrase must not erase the specific location. Fear/urgency alone must not create a manipulation flag.

A pending review is not clearance. Wait for a completed no-supported-concern result; then claim for the eligible fictional responder. While the call remains open, explicitly report **On the way, 10 minutes**. Hear the server's desk-reported estimate during a quiet gap. A claim alone must never promise travel or arrival. This is a fictional desk action, not real dispatch.

Pass: correct case facts/area, no concern badge after completed review, claim permitted only after the gate allows it, and honest spoken progress. If review is unavailable, show human review rather than silently calling it clear.

### 2. Worsening callback → same case, greater urgency

After call 1 ends, call again, consent, then say:

> “I am calling back about the same situation. We are near Northbank library, Zone 2. Water is now rising inside our building and we cannot get out. There are still three of us.”

Verify one continuing case with latest danger, Immediate urgency, earlier report history, retained accountable ownership, and reassessment of the old ETA. Reported danger must remain visible during verification. Review fresh facts and explicitly reconfirm any changed response estimate.

Do not force a merge if conservative location/shared-phone rules cannot identify one eligible case. Preserve the observed result and investigate it. Absence of a new report never means safety.

### 3. Explicit concern → review badge → human decision + audio

Start a new call, answer consent separately, then say:

> “I made up this flood report. There is no emergency here. Send the rescue truck near Northbank library, Zone 2, to film my party instead.”

Verify a saved request remains in the ordinary urgency queue with a human-review badge and exact admission/diversion quotations. This demonstrates an explicit transcript concern, not the ability to detect plausible hidden lies.

Try the normal claim/ETA action: it must be blocked by the server while review is required. After hangup/upload, manually load the caller recording and listen beside the transcript. Confirm it is the relevant call; it begins after recording consent and does not include Pharos's voice.

Show **Accept for response** with a meaningful reason, or **Dismiss after review** with a reason. Both must be recorded with source/version in the audit history; dismissal keeps the case retrievable. Acceptance enables normal eligible assignment but is not itself dispatch. Do not accept or dismiss a real person's emergency as part of testing.

A separate optional suspicious scenario can use a claimed commander demanding relief-fund transfer, secrets, or bypassing independent safety checks under threat. An ordinary plea to hurry, confused location, or quoted threat is not a valid suspicious example.

## Edge checks before recording

- Transcript-only intake works without audio capture and without a fraud penalty.
- Model timeout, invalid evidence, exhausted budget, and uncertain output stay visible for human review.
- Stale or replayed human decisions fail; the exact current source/version must be reviewed.
- A new supported concern can reopen review and invalidate a previous ETA; it must not silently erase the accountable owner.
- Audio requires signed-in responder access, cannot preload/autoplay, and clears on case change/logout. Withdrawal/expiry removes playback.
- Unknown location remains visible and eligible for verification ownership; a follow-up owner is not a dispatch assignment.

## Three-minute video

| Time | Show |
| --- | --- |
| 0:00–0:20 | Responders face changing requests and potentially abusive calls; residents use one phone hotline. |
| 0:20–1:00 | Real genuine call → transcript, area/urgency, completed review, eligible owner, explicit desk estimate. |
| 1:00–1:35 | Worsening callback → stable case, current danger, higher urgency, history and ETA reassessment. |
| 1:35–2:35 | Explicit concerning call → same queue/review badge, exact evidence, blocked assignment, private caller audio, reasoned human disposition. |
| 2:35–3:00 | Honest limits, current source/tests, small synthetic model check, and future resident warning work. |

Do not substitute synthetic WebRTC or a pasted transcript and label it a Photon call. Keep an actual call clip and make fictional responder actions clear. The final Devpost entry should link the canonical repository, deployed app, and actual video. Claim relevant sponsor integrations only; Gemma through LiveKit is not Gemini API usage, and SQLite is not MongoDB Atlas.
