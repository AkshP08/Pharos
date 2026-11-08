# Pharos Project Log

**Created:** 2026-11-07 3:07 PM CST
**Purpose:** Running record of project decisions, problems, research, and work completed. Add a dated entry after each meaningful project update.

## 2026-11-07 3:07 PM CST — Current problem and solution framing

### Team and project
- Team: two high school seniors; beginner hackathon experience.
- Selected concept: **Pharos**, combining State Farm's catastrophe response challenge, T-Mobile's Safe Signal challenge, and Photon's API challenge.
- Intended HackUTD track: **Design** (the team already has Beginner eligibility).
- Goal: one clear, working demo that shows resident protection and responder coordination in a disaster scenario.

### Problem statement
During a disaster, people need to receive real safety information and request help. Scammers may exploit the disruption by impersonating public agencies, utilities, charities, or relief organizations and pressuring affected people to click links, share sensitive information, or send money.

Do not claim that scammers have broken into emergency phone lines unless the organizers provide evidence. Pharos does not monitor ordinary phone calls or authenticate the real-world identity of arbitrary callers.

### Proposed product flow
1. A resident sends a help request or suspicious message through a communication channel connected to Pharos.
2. Pharos determines whether the submission looks like a help request, a public/safety message, or a suspicious solicitation.
3. A help request becomes a responder case with stated location, need, time, information gaps, and status.
4. A suspicious message gets a **Pressure Trace**: highlighted phrases, observed pressure tactics, risk/confidence level, and a safe next step.
5. A human responder reviews, prioritizes, and assigns cases. Pharos does not dispatch responders or tell a resident that help is on the way without human confirmation.

### Fairness and triage safeguards
- Use an understandable, ordinal queue based on reported immediate danger and time sensitivity, following life safety and incident stabilization as operational priorities. This is a hackathon demonstration, not a medical triage standard.
- A possible initial set of buckets:
  - **Immediate life-safety concern:** trapped, injured, active fire/flood danger, or no safe way out.
  - **Time-sensitive safety or essential need:** a specific deadline or essential need that could soon become dangerous.
  - **Urgent but currently safe:** needs assistance, supplies, transport, or information, but no immediate threat is reported.
  - **Information/general request.**
- Missing information becomes **Needs follow-up / unknown**, never an automatic low priority.
- Repeated messages, forceful language, wealth, popularity, language fluency, or who claims to be “most urgent” do not independently raise priority.
- Ask a few structured questions: immediate danger now? location or nearest landmark? what help is needed? how many people are affected? Mark answers as self-reported; do not require proof before creating a case.
- Show why a case is where it is in the queue. Let a human change priority and record why.

### Scam and manipulation signals
Analyze observable message or transcript tactics, not a person's true emotions or intent. Candidate signals:
- Claimed authority or impersonation.
- A deadline or demand to act immediately.
- Threats, fear, or claims of severe consequences.
- Secrecy/isolation, such as “don't tell responders” or “don't call the agency.”
- Requests for money, gift cards, payment apps, passwords, one-time codes, sensitive information, or link clicks.
- A sequence combining several pressure tactics is more concerning than urgency by itself; legitimate emergency warnings can also be urgent.

The result should say **suspicious / needs verification**, quote the evidence, explain uncertainty, and offer a safe next step. Do not label someone definitively as a scammer based only on text or vocal tone. Use synthetic examples and the T-Mobile-provided dataset/taxonomy/baseline if available.

### Photon integration and call limitation
- MVP: use one Photon-enabled messaging channel to receive a report and send a confirmation or safe reply.
- Photon is the transport/API for messages and configured voice routes; it does not provide blanket access to a user's regular phone calls.
- Voice analysis is a stretch feature only for a test call routed through a Photon-configured number and voice tool. Confirm transcript and call-control capabilities with Photon before planning automatic hang-up.
- Do not automatically end real calls. Prefer warning, safe next step, and human/user choice.

### Next work
1. Confirm Photon credentials, one supported channel, and demo-safe setup.
2. Ask T-Mobile for the synthetic scam data, taxonomy, and baseline classifier.
3. Agree on the case/message data shape between frontend and backend.
4. Build the help-request queue and message Pressure Trace around one fictional flood scenario.
5. Test legitimate urgency versus manipulative payment/code requests; document uncertainty and human review.
6. Follow the current Devpost entry limits and deadlines.

### Sources consulted
- HackUTD 2026 official challenge page: https://zeroday.hackutd.co/
- Photon 2.0 overview (messaging and SIP-routed voice): https://photon.codes/blog/introducing-photon-2.0
- FEMA National Incident Management System doctrine: https://www.fema.gov/sites/default/files/2020-07/fema_nims_doctrine-2017.pdf
- FTC disaster scam guidance: https://consumer.ftc.gov/consumer-alerts/2023/09/help-spot-scammers-after-hurricane-idalia

## 2026-11-07 3:09 PM CST — Example flow and queue fairness

### Example scenario
In a fictional flood, one resident reports that water is rising in their home, they cannot leave safely, and a household member depends on powered medical equipment. Pharos creates a **self-reported, immediate life-safety case**, highlights the exact facts that drove the suggested priority, and asks a responder to confirm or update it. A second resident who says “I am the most urgent” is not automatically moved ahead; Pharos asks the same structured questions and compares the reported danger and time sensitivity. If a request lacks location or condition details, it stays **Needs follow-up / unknown** rather than being downgraded.

Separately, an alleged county message says: “Send your verification code in five minutes to reserve a rescue spot. Do not tell anyone.” Pressure Trace highlights the unverified authority claim, artificial deadline, request for a code, and secrecy instruction. It reports a suspicious pattern with evidence and recommends verifying through contact details found independently. It does not claim to know the sender's identity or intent. An evacuation alert may also contain urgency; urgency alone is not enough to label it a scam.

### Queue policy to prototype
- Use consistent, structured questions across residents: immediate danger? safe to leave? location/nearest landmark? what help is needed? how many people are affected?
- Queue by reported immediate life-safety risk and time sensitivity, not confidence, loudness, repeated calls, or the person's ability to provide polished details.
- Treat self-reported facts as unverified reports, not as proof of deception. Ask for clarification where possible; never require proof before logging a request.
- Same-priority cases can be ordered by time received while showing incomplete reports for follow-up; do not let repeated duplicate messages artificially increase rank.
- Human responders retain control of assignment, escalation, and closure. No automated dispatch or denial.

### Voice scope correction
Photon can route voice calls through Photon-configured numbers and SIP-connected voice tools. It does not grant access to arbitrary calls on a resident's phone. MVP remains message-first. Voice analysis is limited to a synthetic test call on the configured project line, pending confirmation of transcript and call-control features. Automatic hang-up is out of scope; the app should warn and let a person choose what to do.

## Ongoing update rule
Append a new dated entry when the team changes scope, confirms an integration, completes a milestone, finds a blocker, or makes a significant design decision. Keep earlier entries as history rather than silently rewriting them.

## 2026-11-07 3:23 PM CST — Sponsor credits and tool offers received

The team supplied HackUTD in-kind offer details. None have been redeemed yet. For Pharos, prioritize Photon first because the app needs a sponsor API; consider Lovable for a fast UI and Deepspace/AIsa/Hugging Face only if their capabilities fit the build. The T-Mobile challenge may already provide a baseline classifier and synthetic dataset, so extra model/API credits are optional.

### Offer ledger
- **Deepspace:** $50 credit per participant; signup link with referral `HACKUTD2026`; available through Nov 18, 2026.
- **639Cloud:** $150 credit; apply coupon `HACKUTD2026` in its portal; no expiry or cap was stated in the supplied offer.
- **Hugging Face:** $10 platform credit; verified-participant private claim link; first 1,200 participants; valid 30 days from redemption; claim link expires Nov 14, 2026. Organizer access needed.
- **AIsa:** $10 API credit; first 300 redeemers; create account and use `AISA_HACKUTD26`; no expiry stated.
- **Lovable:** one month free, Pro Plan 1 monthly plan (100 credits); code is in HARP; existing paid-account holders need a new workspace. Renewal terms were not stated in the supplied offer; check checkout before applying.
- **Photon:** one month free; sign up through the Photon 2.0 beta/dashboard. Docs link supplied; use for the core messaging integration.
- **Anakin:** one month free with `ANAKINIO20`; no cap or expiry stated.
- **Maritime:** three months on Scale; first 300 redeemers; card required; renews at normal price after three months unless cancelled.
- **Carbon Forge:** three months; `CF-HACKUTD-3MO`; card required; no cap or expiry stated.
- **SkillGild:** 30 days of Pro for $1 with `ZERODAY2026`; paid offer; recurring billing terms were not included in the supplied text.

### Access status and blockers
- Photon, DeepSpace, 639Cloud, AIsa, Lovable, Anakin, Maritime, Carbon Forge, and SkillGild require participant-owned sign-in/account steps; no account signups or redemptions have been completed.
- Hugging Face requires a private claim link from HARP or an organizer; do not share the link publicly.
- Card-required and paid offers need the participant to review billing/renewal terms and enter payment details themselves.
- Public-page checks confirmed Photon 2.0 has messaging APIs and docs, but the DeepSpace, 639Cloud, and AIsa redemption URLs were inaccessible to the public browsing tool. Use the supplied offer directions or participant portal.

## 2026-11-07 4:42 PM CST — Photon integration requirements checked

The team asked what setup is needed to move beyond synthetic-only UI. Current official Photon Spectrum documentation confirms that project Settings provides a Project ID and Secret Key, and the SDK can read them from server environment variables. The browser-only prototype cannot safely use these credentials; a small `spectrum-ts` backend and one configured inbound message provider are needed.

Important scope correction: Photon voice is SIP connected to an iMessage line. The docs state voice call events are not delivered in the normal `app.messages` stream or `app.webhook()`, and SDK call control and voice webhooks are coming soon. RTP audio is not encrypted. So Pharos should not promise voice-based scam detection or auto-hang-up. The first live test should be an opted-in teammate sending a harmless message to the configured line.

Setup notes and secret handling are documented in `Product/PHOTON_SETUP.md`; `.env.example` is ready, and `.gitignore` now excludes local `.env` secrets. Still need participant redemption/account/project setup and the T-Mobile sponsor's approved sample dataset/taxonomy/baseline instructions.

Sources: [Photon getting started](https://photon.codes/docs/spectrum-ts/getting-started), [provider list](https://photon.codes/docs/spectrum-ts/providers), [voice-over-SIP docs](https://photon.codes/docs/spectrum-ts/providers/voice).

## 2026-11-07 4:51 PM CST — Git repository status

The HackUTD project folder already contains an initialized local Git repository, but it has no commits and no remote. The empty branch has been renamed to `main`; the product source and planning logs are ready to stage. Raw challenge-reference slides are not included in the initial file set pending the team's decision to share them.

The team requested that no AI identity be listed as contributor or push actor. No commit or push was made under the student's configured author identity; the initial commit and remote pushes should be made/approved by a human team member. The GitHub connection is not available here yet. Connect the student's account, choose a repo name and visibility, then continue milestone-based pushes.

## 2026-11-07 4:53 PM CST — Call-language analysis and staged project

Call content can support manipulation-pattern analysis **if an accurate transcript is available**. Candidate evidence remains the message tactics already logged: unverified authority claims, manufactured deadline, threats/loss, secrecy or anti-verification instructions, and asks for payment, credentials, codes, or links. The output should be “possible pressure pattern—verify independently,” quote the matched words, and keep human review. It must not claim a speaker is a scammer as a fact.

Photon Voice is selectable in onboarding, but current Spectrum docs say SIP calls do not flow through the normal message/webhook stream. Transcript extraction therefore needs a separate SIP/audio/STT pipeline; keep consent and privacy central and avoid real disaster-victim audio. A harmless teammate test is the right first live test.

Git: the initial product source and logs are staged on `main`, but no commit/push exists. The local repository has no remote yet. Respecting the request not to list an AI as contributor or push actor, leave the initial commit and pushes for a human teammate. Proposed remote default is private `signalbridge-hackutd-2026`, pending confirmation after GitHub connection.

## 2026-11-07 5:03 PM CST — Photon onboarding and push status

For the Photon onboarding step shown in the team's screenshot, select SMS and Voice if both are available, then inspect the following page for a provisioned line/number, inbound/outbound support, SIP routing/voice-tool requirements, transcript access, webhook/call-control support, trial expiry, limits, and any paid renewal. Selecting Voice is not the same as giving Pharos a transcript stream.

Voice-content warnings are feasible if a SIP-connected voice app or STT tool creates a transcript. The warning should be shown in the Pharos UI or delivered as a follow-up message where supported; no arbitrary native phone-call overlay is implied. Phrase it as a possible scam pattern, cite the language evidence, and offer independent verification.

Git push remains blocked by the invalid saved GitHub CLI token and unconnected GitHub integration; local `main` remains staged with no remote/commit. The user has now explicitly asked for assistant-driven pushes after the earlier request to avoid AI identities; no AI co-author/identity should be added. Reauthenticate/connect the team's account before creating the private `signalbridge-hackutd-2026` remote and pushing the reviewed initial set. Other HackUTD credits are optional; investigate Hugging Face only if a real transcription/model need remains after Safe Signal's sponsor materials arrive.
