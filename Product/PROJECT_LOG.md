# SignalBridge Product Build Log

This is the execution log for files and work in `Product/`. The earlier planning and offer history remains in the project-root `SignalBridge Project Log.md`; this file is the canonical log for prototype implementation, screenshots, struggles, and workarounds.

## 2026-11-07 3:27 PM CST — Project scaffold started

### Decisions
- Build the first prototype in `Product/` as plain HTML, CSS, and JavaScript so the two-person beginner team can open and understand it without installing a framework.
- Keep the demo centered on a fictional Trinity River flood scenario.
- Keep the help queue and scam message review separate but adjacent: the responder queue is the State Farm workflow; Pressure Trace is the T-Mobile workflow; Photon will be the transport once credentials and a supported channel are configured.
- Show synthetic/demo state explicitly. No actual call monitoring, automatic hang-up, real emergency dispatch, or identity verification is represented.

### Work in progress
- Building a responsive response desk with immediate-safety cases, a visible follow-up/unknown state, and transparent reasons for suggested queue placement.
- Building a Pressure Trace panel that highlights observable message tactics and explains uncertainty.
- Adding a small rule-based example analyzer so the demo can be interacted with before any approved model/API is connected.

### Current setup dependencies
- **No setup is needed to open the frontend.** Open `index.html` in a browser.
- Before a live Photon integration: activate the participant account, confirm one supported channel and inbound message flow, and keep API secrets on a backend rather than in browser code.
- Before using the T-Mobile model: ask the sponsor for its synthetic dataset, taxonomy, and baseline classifier.

### Screenshots
- No screenshot captured yet; add one after the first browser render and after each substantial UI revision.

### Problems / workarounds
- Current Photon access has not been activated, and voice/call control behavior has not been confirmed. Workaround: build the message-first UI with clearly labeled synthetic inputs and leave the Photon connection unconfigured rather than implying a live integration.
- The team has no reliable information about residents' actual medical conditions. Workaround: use consistent questions, mark answers self-reported, show missing details as follow-up/unknown, and require human review.

## Ongoing update rule

Append a dated note after each meaningful implementation session. Include what changed, the working or failed approach, any workaround, and screenshot filename(s). Do not erase previous blockers when they are resolved; add the resolution and its timestamp.

## 2026-11-07 4:42 PM CST — Photon setup and scope verified

### Research / decision
- Read the official Spectrum introduction, getting-started guide, provider list, and voice-over-SIP documentation.
- Photon needs a Spectrum Project ID and Secret Key from dashboard project Settings. The SDK reads `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` from the server environment; credentials must not go in browser JavaScript or chat.
- A live inbound message path requires a configured supported provider. The static UI cannot receive Photon events directly; a small Node/TypeScript server is required for `spectrum-ts`.
- Corrected the voice assumption: Photon describes SIP calls on a Spectrum iMessage line, but voice calls do not appear in `app.messages` or `app.webhook()`, SDK call control and voice webhooks are marked coming soon, and RTP audio is unencrypted. Voice detection/auto-hang-up is not a viable safe first integration.
- First integration should be message-first with a consenting teammate's harmless test message. Do not use actual disaster-victim information.

### Work completed
- Added `PHOTON_SETUP.md` with participant setup steps, integration boundaries, Safe Signal/State Farm inputs, and official docs.
- Added `.env.example` placeholders and root `.gitignore` rules so local Photon secrets will not be committed.
- No secrets or API integrations have been added. Awaiting participant account/project and provider setup.

### What the team needs to do
1. Redeem the one-month offer using the supplied Photon Beta link, create a Spectrum project, and check which messaging provider/line is enabled.
2. Copy `.env.example` to `.env` on the development machine and enter the Project ID and Secret Key locally. Never send the Secret Key in chat.
3. Tell the coding assistant only that the project is ready and which inbound provider is available; then we can add the backend connector.
4. Request T-Mobile's approved sample data/taxonomy/baseline instructions. No extra Hugging Face credit is needed yet for the local rule-based demo.

### Sources
- https://photon.codes/docs/spectrum-ts/introduction
- https://photon.codes/docs/spectrum-ts/getting-started
- https://photon.codes/docs/spectrum-ts/providers
- https://photon.codes/docs/spectrum-ts/providers/voice

## 2026-11-07 4:47 PM CST — Voice channel option confirmed in onboarding

- The participant shared a screenshot of Photon onboarding, Step 2 (“Where will your agents talk?”), which visibly lists SMS, iMessage, WhatsApp, Slack, Discord, Telegram, and Voice. Saved it as `screenshots/photon-channel-selection-2026-11-07-1646.png`.
- Clarification: Voice is indeed a channel option. The caveat is about what the current developer interface exposes: Photon documents SIP inbound/outbound calling, but its voice guide says calls are not delivered in the standard `app.messages` or `app.webhook()` stream, SDK call control and voice webhooks are coming soon, and RTP audio is unencrypted.
- Revised setup notes to distinguish channel selection from receiving/analyzing audio or controlling calls. Voice may be considered as a separate SIP stretch integration after its exact setup and audio path are confirmed. No call monitoring or auto-hang-up claim is supported yet.

## 2026-11-07 4:51 PM CST — Local Git repository prepared

- Confirmed the project folder already has an initialized local Git repository on `master`, with no commits and no remote.
- Renamed the empty default branch to `main` and prepared the project source/docs for an initial commit. The raw `Challenge Info/` source slides are being left out of that first set until the team decides whether those reference files belong in the shared remote.
- Git's local author identity is configured as the student account. To honor the request not to attribute commits or pushes to an AI, no commit or push has been made. A GitHub remote still requires the team's account and repository visibility/name decision; a GitHub connection is not currently available in this workspace.
- Next handoff: connect the student's GitHub account, choose a private/public repository and name, and have a team member make/approve the initial commit and pushes. Continue frequent local changes and document them here meanwhile.

## 2026-11-07 4:53 PM CST — Human push workflow and voice-language scope

- The initial source/docs and participant-provided Photon onboarding screenshot are now staged locally on `main` for human review. No commit or push was made. The `Challenge Info/` source materials remain untracked/out of the initial staged set.
- GitHub remote creation is still pending because no remote is configured and the GitHub connection is not active in this workspace. Proposed default: private repository named `signalbridge-hackutd-2026`; confirm/change this before creating the remote.
- The user asked that no AI identity appear as contributor or push actor. To honor this, the team member should review and make the commit/push under their own account. I can keep preparing local changes and exact commit instructions.
- Voice content can be analyzed if we obtain an accurate transcript. The language model/rules would flag observable tactics (claimed authority, secrecy, deadline, threats, demands for money/codes, link pressure), show matched evidence, and recommend independent verification. It cannot prove the caller's identity or intent; a likely-risk label must remain a warning for human review.
- Transcript creation is an additional voice pipeline, not a built-in result of selecting Photon Voice. The current Photon docs indicate the Spectrum call path does not feed calls into `app.messages` or `app.webhook()`. A consented, harmless teammate test and a privacy-safe supported SIP/audio-transcription setup are prerequisites; avoid real victim data.

## 2026-11-07 5:03 PM CST — Channel selection guidance and Git push blocker

- User confirmed they want the assistant to push code and reiterated that the project must stay updated. Plan: push each meaningful milestone once GitHub access is available, using the team's authenticated GitHub account, with no Codex/ChatGPT/Claude co-author or contributor metadata.
- The current project has local branch `main` and the initial product set staged. There is no remote. GitHub integration is not connected and `gh auth status` reports its saved GitHub token is invalid, so a push cannot succeed yet. Do not create fake author identities or attempt to bypass authentication. User must reconnect GitHub in the workspace or reauthenticate `gh` through their own account.
- Suggested remote defaults: private repo named `signalbridge-hackutd-2026`; raw `Challenge Info/` assets remain outside the staged source set for now.
- Step 2 of Photon onboarding visibly offers SMS and Voice. Guide the user to select both for the intended demo if both are still available, then inspect Step 3 for line/channel provisioning, SIP or voice-tool routing, inbound support, transcripts, control/webhook availability, trial term, and any billing. Do not accept a paid plan as part of a free-month offer without checking its terms.
- A transcript can be analyzed for language tactics, but it has to come from a SIP-connected voice tool/STT pipeline, not directly from `spectrum-ts` messages. A warning can appear in SignalBridge's own UI; it cannot overlay an arbitrary native phone call. Keep the label “possible scam pattern—verify” and quote evidence rather than identifying the caller as a scammer.
- No other HackUTD credit is required for the initial message demo. Hugging Face's $10 credit could be a later transcription/model experiment after checking the T-Mobile-provided Safe Signal dataset/taxonomy/baseline. The claim link is private and the offer details say it expires Nov 14, valid 30 days after redemption.

## 2026-11-07 5:06 PM CST — Channel scope: SMS + Voice

- Compared Photon provider docs for iMessage and WhatsApp Business.
- Recommended onboarding selection remains SMS + Voice. iMessage is optional but overlaps with SMS for this first demo; add only if the team will test the Apple-native path. WhatsApp Business adds Meta Cloud API credentials and is 1:1, so it is out of initial scope unless challenge rules or target users require it.
- This keeps the two-person team focused on one broad message intake path and one voice stretch path instead of adding four parallel integrations.
- Sources: Photon [provider guide](https://photon.codes/docs/spectrum-ts/providers), [iMessage provider](https://photon.codes/docs/spectrum-ts/providers/imessage), [WhatsApp Business provider](https://photon.codes/docs/spectrum-ts/providers/whatsapp-business).

## 2026-11-07 5:12 PM CST — Photon MCP endpoint registered; OAuth pending

- The user supplied `https://mcp.photon.codes/mcp` and asked for setup. Verified it against Photon’s official MCP docs; the endpoint is documented for Codex via `codex mcp add photon --url https://mcp.photon.codes/mcp`, then OAuth login.
- Added the Photon endpoint to the local Codex configuration. `codex mcp list` confirms it is enabled but auth is unknown; OAuth has not been started or approved.
- Photon MCP can create/configure projects, manage channels/lines, send/read messages, and check billing. Because it acts with the user's live Photon permissions, the user must review and explicitly approve the OAuth authorization. Keep approvals on for sends, purchases, edits, and deletion.
- Clarified in `PHOTON_SETUP.md`: connecting the developer MCP does not connect SignalBridge at runtime. The app still needs a server integration using `spectrum-ts` and project credentials stored locally.
- Official references: [Photon MCP setup](https://photon.codes/docs/beta/ai-tools/mcp) and [OpenAI Codex MCP setup information](https://developers.openai.com/learn/docs-mcp).

## 2026-11-07 5:28 PM CST — Photon MCP OAuth connected and verified

- The user approved connecting Photon to Codex. OAuth completed, and Photon MCP tools are now available in this Codex session.
- Verified with the read-only `getCurrentOrganization` operation: Photon returned HTTP 200 for the connected organization, “Aksh's Org,” with billing initialization complete. No project, line, message, or billing settings were changed during verification.
- `codex mcp list` still prints `Auth Unknown` for the endpoint, despite the successful authenticated tool call. Treat the live read-only MCP response as the connection check for this session.
- Photon MCP has broad capabilities, including creating/configuring projects and lines, reading/sending messages, and viewing billing. Keep each future action scoped to the project and obtain user confirmation before sending, purchasing, or making consequential configuration changes. Never store OAuth tokens or Photon secrets in this repository.
- The developer MCP connection is separate from SignalBridge's runtime integration. The app still needs its own server-side Spectrum setup and project credentials before it can receive messages or process voice.

## 2026-11-07 5:30 PM CST — SignalBridge Photon project inspected (read-only)

- Listed the connected organization's projects and found the existing `SignalBridge` Photon project; did not create a duplicate.
- Read the project's billing overview and resource list. It is on **Messaging Free** with a $0 base fee through `2026-12-07T07:59:59Z`, has no provisioned lines/resources, and has zero metered usage so far.
- Photon lists a **$2.00 pay-in-advance charge per US local number**. The purchase operation creates an SMS-enabled line; separate carrier/message fees may apply when used. No purchase or message was made.
- The project's platform catalog includes SMS and Voice, but this is capability metadata, not proof either channel is provisioned. Voice still needs its own SIP/audio path and transcript provider.
- Next gate: obtain explicit approval for a capped $2 number purchase before provisioning SMS. Keep voice setup unmodified until its supported path and any cost are confirmed.

## 2026-11-07 5:35 PM CST — Photon credit balance corrected

- The user pointed out that Photon shows $100 in credits. Verified with the read-only organization credit endpoint: **$100.00 USD available** (`balanceCents: 10000`). The earlier project-level plan check showed a $0 Messaging Free base fee, which is separate from the organization credit wallet.
- Photon documents wallet credit as an offset for organization invoices except one-off invoices. The project billing summary lists a $2 pay-in-advance US number charge, but the read-only results do not say whether that particular charge is eligible for wallet credit. Do not assume credit covers it until confirmed.
- No line has been purchased and no messages sent. The user had selected simulated data before this credit balance was verified; await a clear change in that decision before provisioning.

## 2026-11-07 5:39 PM CST — Hosting alternatives checked

- The user asked whether Vercel is required and whether a HackUTD-provided option can make a shareable demo URL. It is not required: the HackUTD offer list includes Deepspace credits and one free month of Lovable.
- Verified against current official documentation: Deepspace deploys apps to a public `*.app.space` URL, and its static-site guide describes serving public static pages. It uses a CLI/app structure and a human Google/GitHub sign-in, so adapting this existing HTML/CSS/JS folder is more work than a drag-and-drop host. Lovable's publishing flow produces a shareable live URL from a Lovable project; that would require moving/rebuilding this prototype there first.
- Opened Vercel Drop to evaluate the simplest path. The onboarding defaulted to a Pro trial that required a payment method and stated it would charge $20/month after 14 days or when trial credit ran out. Selected the free Hobby option, then closed the flow before continuing. No card was entered, no trial started, and no project files uploaded.
- No public URL exists yet. Recommended sponsor-backed path: use Deepspace for the live link if the team wants the included cloud credit and is willing to adapt the static app; Lovable is another included route if the team prefers its builder/publish flow. Photon is an API provider, not a web host, and the $100 Photon credit is separate from hosting credit.
- Sources checked: [Deepspace deployment](https://docs.deep.space/concepts/deployment), [Deepspace static-site guide](https://docs.deep.space/agents/static-site-hosting-with-form-handling-small-business-quote-form), and [Lovable publishing overview](https://lovable.dev/guides/build-database-app-without-coding).

## 2026-11-07 6:11 PM CST — DeepSpace account connected; external-facing overview added

- The user created a DeepSpace account and connected it with GitHub. Started the official CLI login and completed browser OAuth under the user's account. The local CLI now has its private DeepSpace session credential; no password was entered in chat.
- Read-only dashboard status shows the Free plan, one website deployment, 1 GiB storage per app, 5,500 credits left including 5,000 bonus credits expiring Nov 18, 2026, and no compute or binding usage. No app was registered or deployed yet.
- The official DeepSpace starter scaffold was created in /private/tmp/signalbridge-deepspace for reference. It requires Node 22.15+ / npm 11.6+; this machine has Node 26.4.0 and npm 11.17.0. It has not been merged into Product/.
- The project README now has a plain-English overview for someone new to the project. The current product still uses only synthetic scenarios and has no live Photon runtime connection.
- Git is still a local repository with no commits or remote. Preserve the user's instruction not to make a commit/push under an AI identity; prepare the deployable app locally and request the team's own commit before deployment if DeepSpace requires it.

## 2026-11-07 5:55 PM CST — Step-by-step route to a sponsor-backed demo URL

- Recommended Deepspace because the HackUTD offer the user provided includes $50 in credits and Deepspace documents public deployments at `<app-name>.app.space`.
- User action: claim the offer at https://dashboard.deep.space/join/HACKUTD2026 using referral code `HACKUTD2026` (offer details provided by the user say the credit is available until Nov 18, 2026), then sign in to the dashboard with their own Google or GitHub account and confirm the credit appears.
- After that, adapt the current static Product app to Deepspace's deployable app structure, keep its scenario data synthetic, and provide a local preview for review. The user retains control of their sign-in; no credentials should be pasted into chat.
- Deployment requires a signed-in Deepspace account and the CLI flow. DeepSpace's docs say to commit the source before deploying. Because the team does not want AI attribution on Git commits, the commit/push identity must be the team's account.
- The public URL would host the demo only; it would not connect Photon, receive real SMS/voice, or process real resident data. No DeepSpace account was connected and no public URL was deployed in this session.

## 2026-11-07 6:24 PM CST — DeepSpace host registered and production build completed

- Registered the DeepSpace app `signalbridge-hackutd-2026` under the authenticated account; the app ID is stored in the host config. Registration did not create a Git commit.
- Added `Product/deepspace-host/`, a wrapper that copies the maintained static site files into DeepSpace's public directory and builds the site with the official starter. Updated the public demo footer and added a short `about.html` page clarifying the demo is synthetic-only.
- `npm run build` completed successfully. The output includes `dist/client/index.html`, `app.js`, `styles.css`, and `about.html`, plus the DeepSpace worker bundle. Wrangler printed a non-fatal `EPERM` while trying to prepare its local debug-log folder; the production build still completed. Keep an eye on this if a later deploy fails.
- GitHub has no remote configured and the local project has no commits. `gh auth status` found an invalid saved CLI token. A normal GitHub CLI login reached account reauthentication, but GitHub now asks the account owner to enter their password directly in the browser. The assistant did not enter or receive the password.
- Before that reauthentication step, GitHub displayed that GitHub CLI requested broad account access, including private-repository control and GitHub Actions workflow updates. Leave the final authorization decision with the account owner; do not try a workaround or narrow the disclosure in the log.
- DeepSpace supports a one-time local deploy with `--no-push`, but with no GitHub remote selected the first release would set DeepSpace as the source of record. The team requested a GitHub repo and human push attribution, so no deployment was made. The expected URL is `https://signalbridge-hackutd-2026.app.space` if available when published.
- Screenshot checkpoint: the current GitHub password reauthentication page is shown in the conversation for the account owner to complete. Existing onboarding screenshot: [Photon channel selection](screenshots/photon-channel-selection-2026-11-07-1646.png).
- Public hosting will only publish fictional queue/message examples. Photon remains disconnected from the app; no actual calls, messages, or emergency data are processed.

## 2026-11-07 6:32 PM CST — GitHub connected; hosting wrapper reduced to static site

- Update to the 6:24 PM checkpoint: the account owner completed the GitHub CLI sign-in in the browser. The approved CLI can read the session from the macOS keychain; ordinary sandbox commands cannot, so GitHub writes need the approved network context. The account owner reviewed and completed GitHub's authorization flow.
- Created the private repository [signalbridge-hackutd-2026](https://github.com/AkshP08/signalbridge-hackutd-2026) and added it as this checkout's `origin`. The first commit and push are the next step; the configured commit identity is the student account. No AI identity or co-author is included.
- Kept the original `Challenge Info/` source files outside the repository. The staged set is the Product, project logs, existing Photon onboarding screenshot, host wrapper, and ignore rules.
- Review found the stock DeepSpace scaffold would also expose unrelated chat, integration, and storage routes. Replaced its worker with a static asset handler and the deploy health route, removed the starter's Durable Object bindings and sample application sources, and reduced the host dependencies. The build now bundles an 18.78 kB worker and static HTML/CSS/JS only.
- Rebuilt successfully on Nov 7. Vite generated the site and worker. Wrangler continues to print a non-fatal permission error while attempting to create its debug-log folder under the user's Library; it does not stop the build. This remains a local environment warning, not an app runtime issue.
- No public URL is live yet. The intended address is `https://signalbridge-hackutd-2026.app.space`, subject to availability and a successful DeepSpace deployment. The app still has no live Photon runtime, calls, messages, or real disaster data.
- Screenshot checkpoint: the GitHub reauthentication step was shown in the browser and the account owner completed it. The saved project screenshot remains [Photon channel selection](screenshots/photon-channel-selection-2026-11-07-1646.png).
