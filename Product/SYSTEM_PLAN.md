# Pharos system plan

Updated November 8, 2026. The responder backend is deployed and one real consenting fictional Photon intake has reached Beacon. Protected-call relay/banner, current-build spoken ETA, and a location-retention audio regression remain separate acceptance gates. Use [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for operation and recording.

## Product and verified state

**Flare** is a resident phone hotline; **Beacon** is a responder website. Residents report what is happening and where they are without a name or a web intake form. The desk combines explained urgency, service areas, capacity, accountable ownership, changing reports, and human-confirmed response progress. The optional resident PWA is for protected-call warning setup/display only.

Final submission is November 8 at noon CST; the initial Devpost entry exists. The required demonstrations are a real help/callback flow and a two-party protected-call warning. State Farm, T-Mobile Safe Signal, Photon, and General/Beginner are intended targets. The supplied T-Mobile slide permits team-created synthetic scenarios. MongoDB, Tiger Data, Gemini API, Solana, and Vultr are not integrated or claimed.

| Component | Verified evidence | Remaining acceptance |
| --- | --- | --- |
| DeepSpace Worker/SQLite | Published app health 200, protected overview 401 without authentication, recipient assets 200. Persistent real intake: consent yes,16 turns,three-person case,delivery failure false. | Publish/verify the current source stamp after final changes; complete manual current-build browser/phone checks. |
| Voice intake | Real Photon→LiveKit speech→Worker case path succeeded once. Short21-word interruptible opening, deterministic consent, ordered delivery, finite lifetime, and progress polling are in current code. | Audio-check the current opening and exact desk-confirmed ETA; investigate the earlier unexplained post-call AttributeError if it recurs. |
| Hosted agent | LiveKit reports Running; old local worker stopped. Synthetic WebRTC test reached first audio in 8.051 seconds, saved a consented urgent three-person shelter case, and passed disconnect/room deletion. Ring 60 seconds/max 180 seconds. | **Overall audio acceptance OPEN:** later generic library wording lost precise area routing. Fix/rerun pending. This is WebRTC simulation, not a new Photon call. |
| Changing cases/contacts | Integrated repeat-case, encrypted-contact, purpose separation, risk history, consent/expiry, monotonic ETA versioning, and new-danger/coverage invalidation tests pass. | Real worsening callback preserving one case and ownership; shared-phone different-location control when time permits. |
| Beacon | Ranked area queues, visible unknown-location urgency, eligibility/capacity, follow-up ownership, priority audit, response-status/ETA controls, and 35 UI contracts. | Deployed visual review and desk update heard during an active call. |
| Guard and notifications | Bounded contextual reviewer, exact evidence validation, stale-result rejection, explicit unavailable state, private pre-enrollment, push adapter, and foreground warning PWA. Photon outbound TLS/SHA-256 and scoped LiveKit outbound configuration exist. | Connect Phone A→Phone B, show a real banner before hangup, measure timestamps, then test benign urgent speech. SMS remains disabled. |

The last completed root-owned watcher checkpoint had passing **152 backend, 76 offline voice, 35 UI-contract** lanes. Backend checks include 29 facts, 12 caller-module, 3 caller-integration, and 12 response-progress cases. Test counts are regression evidence, not physical delivery or emergency/fraud validation. [QA_WATCH.md](QA_WATCH.md) describes its offline boundaries and build pause controls.

## Help and changing reports

```text
Phone A → Photon SIP → LiveKit short intake/STT
  → consented ordered turns → protected Worker/SQLite
  → partial case, current facts, history, priority/area suggestions
  → Beacon owner and human response report → exact server-supplied spoken update
```

The opening is brief and can be interrupted by “yes” plus facts. After consent, the helper gathers the situation/current location first and skips facts already given. Immediate danger avoids routine readbacks. The Worker accepts no transcript turns before consent; speech services still process the consent choice. Agent text is not evidence of the resident's physical situation.

Contacts use encrypted phone storage and purpose-separated keyed lookups. The existing help lookup is preserved for earlier calls. A returning intake report links only after explicit same-situation intent, an independently supplied substantial location match, one eligible recent open case, and an ended prior source call. Ambiguous/shared locations, overlapping active calls, guard/browser calls, resolved cases, and expired/revoked history do not silently merge. A name or special phrase is never required to receive help.

New reports supply current facts rather than appending old speech into a timeless incident. History retains progression, original case age, and accountable ownership. Fresh danger can raise urgency above an earlier downgrade while keeping the human decision auditable. Uncertainty remains visible. Pharos re-triages **when reports arrive**; it does not monitor a resident or measure water levels between calls.

## Urgency, area, and response estimates

| Suggested tier | Caller-reported evidence |
| --- | --- |
| Immediate | Explicit danger, trapped/no safe exit, indoor/upstairs flooding, or a direct life-safety phrase. |
| Time-sensitive | Essential medical/powered-equipment/medication support need without a stronger explicit hazard. |
| Urgent | Evacuation, transport, shelter, or supplies without a stated immediate life-safety threat. |
| Follow-up | Insufficient/uncertain facts; keep visible and clarify rather than infer safety. |

These are transparent prototype suggestions, not validated medical triage or dispatch rules. Spoken address/landmark/zone is matched to configured demonstration areas, not GPS. Immediate unknown-location requests stay in the ranked queue. A coordinator-approved responder must match area/capability/availability/capacity before claiming; follow-up ownership handles unmatched requests without pretending dispatch occurred. Changed coverage flags the assignment; capacity transfers/releases are accounted for.

The desk explicitly reports On the way, Delayed, Arrived, or Unable. Travel/delay requires an entered ETA of 1–180 minutes and the current case version. A claim alone never means help is coming. New danger/location/coverage can invalidate progress; elapsed ETA asks for an update and never marks arrival. During an active consented intake, the agent polls a private endpoint and speaks only the server's confirmed message once per revision, deferring while the caller/bot is busy. Until confirmation, the response is receipt with no confirmed arrival time. Shared desk sessions do not establish an individual responder's verified identity or physical location.

## Protected-call flow and history caution

```text
Phone A → Photon/LiveKit guard → fixed consenting Phone B
  → caller-only consented text → bounded contextual review
  → exact validated evidence → Beacon + paired warning PWA/push
```

The single Photon number serves intake and guard test modes sequentially; the operator switches dispatch/runtime deliberately. This is not concurrent protection for arbitrary personal cellular calls. Guard calls never become disaster help cases. Incoming consent precedes the fixed recipient relay; both phones must consent and loop checks must pass.

The contextual model is limited to one review in flight, coalesced current caller snapshots, eight reviews per call, a 15k-byte serialized input/schema cap, 800 output tokens, 8-second timeout, and no model retries/tools. The server validates current consent/sequence/open session, exact caller-only quotes, known categories, and supported action+pressure evidence. Invalid, stale, timed-out, or unavailable output remains explicitly unverified; semantic calls do not fall back to a literal-rule warning. The standalone synthetic message workbench still uses the separate rule inspector.

Caller-ID history is a separate advisory. Only distinct consented guard calls with contextual warnings count; medium→high escalation in one call counts once. After three distinct prior warned calls, a new call may show “Caller ID has prior risk reports.” It is not current speech evidence or proof of identity, never blocks help, and never skips the current review. Withdrawal/expiry removes the relevant history.

Pair Phone B before the call through the response desk's private 24-hour link. The PWA supports foreground polling and permission-based Web Push; installation/permission are manual device steps. Provider acceptance, device-reported display, and a person reading are separate states. No physical banner has been verified yet. SMS is disabled because no eligible campaign upgrade is authorized.

## Psychological grounding and detector boundaries

The contextual reviewer receives consented **caller text and requested behavior**. Phone number, voice tone, accent, and inferred mental state are not model inputs. The temporary caller allowlist controls test access/cost. Separate caller-ID history can produce a clearly labeled prior-risk caution after three distinct flagged calls; it does not establish identity, block help, or replace current analysis.

Research and consumer-protection sources checked on November 8, 2026:

- [FTC: How To Avoid a Scam](https://consumer.ftc.gov/articles/how-avoid-scam) describes impersonated authority, immediate-action pressure, threatened consequences, keeping someone on a call to prevent checking, and demanded payment methods. It recommends independent verification and talking to someone trusted. This is consumer guidance, not validation of a transcript classifier.
- [FTC: Spot and avoid FEMA impersonators](https://consumer.ftc.gov/consumer-alerts/2025/07/spot-avoid-fema-impersonators) states that FEMA does not charge for disaster assistance or inspections. This supports a specific FEMA-plus-fee warning; it must not become a claim that every disaster-related service or payment is fraudulent.
- [Khadka, Ullah and Marroquin: Unmasking persuasion in phishing](https://doi.org/10.1108/ICS-12-2024-0321) (published online 2025; journal issue 2026) qualitatively codes 200 phishing emails from 2014–2023. It examines combinations of authority, distraction/scarcity, social proof, commitment/consistency, and reciprocation, among other categories. The evidence concerns selected phishing emails, not live disaster calls; tactic frequency does not establish causation, detection accuracy, or a person's susceptibility.
- [Omer and Pöhn: Psychological factors across social-engineering types](https://arxiv.org/html/2608.25670v1) (2026) compares simulated channels including voice in a 12-person laboratory study. Responses are stated intentions, not losses in real scams. The authors explicitly limit generalizability because of the small sample, laboratory setting, and narrow scenarios. Its percentages must not become Pharos risk probabilities.

Product interpretation: label observable cues—an official claim, short deadline, threatened loss, discouraging a second opinion, invoking a favor or earlier agreement, or claiming others complied—and quote the exact words. Use “may pressure” or “can discourage checking”; do not diagnose the caller or resident, assert intent, or say a tactic proves fraud. Reciprocity, commitment, and social proof can also occur in ordinary helpful conversations.

Legitimate evacuation instructions can share urgency, authority, limited seats, and requests to stay connected. Review the requested action and anti-verification context rather than warning on these cues alone. “Stay on the line while I connect a dispatcher” needs different treatment from “stay on the line so you cannot call your bank.” Warnings should pause the risky payment, disclosure, or device-access action and offer independent verification without delaying immediate safety instructions. Maintain benign emergency, quoted-warning, negation, paraphrase, and speech-recognition-error controls; independently authored holdouts must remain separate from repaired regression examples. These sources ground explanations, not a validated detector or clinical assessment.

## Evaluation and evidence limits

The frozen independent28-example literal-rule challenge remains TP 0,FP 2,TN 12,FN 14. It exposed brittleness and is preserved unchanged. An earlier contextual smoke produced3/3 benign no-warning and3/5 risky validated warnings; two risky outputs were withheld for invalid evidence. Those failures remain open. A later frozen six-case set produced three benign and three risky validated decisions through the actual SDK. These are small authored/synthetic checks, not population accuracy or a guarantee of prompt-injection resistance.

The latest recorded context-review evaluation total is 15 known responses across 24 attempts, including 9 earlier DNS failures; estimated cumulative tariff is about $0.0043104 within the approved $0.25 existing-credit cap. Model latency is not end-to-phone warning latency. Keep event, review, provider-acceptance, device-display, and call-end timestamps separate during the manual demo.

## Consent, retention, access, and release evidence

No raw audio is stored by the Worker. Agent recording is disabled. Clear consent precedes delivered transcript turns; withdrawal stops collection and scrubs relevant speech/evidence/access/contact history. Scheduled expiry is at most 24 hours for live evidence, contacts/risk records, private access, and subscriptions; minimal structured help facts may remain. External providers and recipient-device copies have separate retention limits.

Only the existing app/project and approved credits are in scope: one Photon number, up to $5 existing Photon credit/no cash/no paid-plan or SMS campaign, plus $0.25 existing LiveKit model-test credit. Build has fixed included caps; hosting health still requires verification. Keep private numbers, credentials, warning links, provider metadata, and raw call content out of public captures and Git.

Source is backed up in [AkshP08/Pharos](https://github.com/AkshP08/Pharos). The app build generates `/build.json` with commit/dirty/time; verify it after publishing. DeepSpace's GitHub-source release metadata does not itself record recoverable commit lineage, even from a clean tree. Use the source stamp and pushed commit rather than claiming the platform supplied that evidence.

[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) owns the four-call sequence and recording plan. [DELIVERY_CHECKLIST.md](DELIVERY_CHECKLIST.md) and [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md) own acceptance and feedback dispositions. [PROJECT_LOG.md](PROJECT_LOG.md) remains the chronological record. Next gates are the location-retention fix and audio rerun, current short intake/ETA/callback, physical guard/banner plus benign control, and final clean publish/source-stamp verification.
