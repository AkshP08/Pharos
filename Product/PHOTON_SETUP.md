# Photon setup for Pharos

## What Photon can power in this project

The feasible first integration is an inbound **text-message** path into Pharos's server, followed by a safe reply or human-review prompt. The current `Product/` app is static, so it cannot safely hold Photon credentials; the integration needs a small server process using `spectrum-ts`.

Photon's current Spectrum docs describe providers for iMessage, WhatsApp Business, Telegram, and terminal development. The getting-started guide says a project needs a Project ID and Secret Key from project Settings. The SDK can read `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` from the server environment.

There are two different Photon connections in this work:

- **Photon MCP for the developer:** lets Codex set up Photon projects/channels and inspect or manage Photon messages and billing.
- **Spectrum SDK in SignalBridge at runtime:** lets the app receive/send supported messages. Connecting the developer MCP does not connect the app itself; the runtime app still needs a server and project credentials.

## Which channels SignalBridge needs

- **SMS — include.** It is the broad, familiar text path for residents to forward suspicious messages or send a help request.
- **Voice — include as the call-analysis stretch path.** It matches the team's idea, but requires SIP routing plus a voice/transcription service; selecting Voice alone does not produce a transcript.
- **iMessage — optional.** It could make a polished native Apple demo, but overlaps with SMS for the first prototype and narrows the test audience to iPhone users. Add it only if the team will test the iMessage-specific path or the sponsor asks for it.
- **WhatsApp — skip initially.** Photon documents this as the official WhatsApp Business Cloud API, requiring Meta credentials, and it supports 1:1 conversations. That adds account setup without improving the U.S.-focused SMS/voice demo. Revisit if the target community or challenge rubric specifically calls for WhatsApp.

The current recommended onboarding selection is **SMS + Voice**; keep the first app flow focused on those two.

## Participant setup

Use the HackUTD offer directions supplied by the team:

1. Visit [Photon Beta](https://photon.codes/beta) and sign up / open the [Photon dashboard](https://app.photon.codes/dashboard) to redeem the one-month offer.
2. Create a Spectrum project in the dashboard.
3. On the onboarding page **“Where will your agents talk?”**, select **SMS and Voice** if both remain selectable. That matches the planned text-first product plus an optional call demo. This is a channel preference/setup step; it does not itself grant call transcription or control. If the next page shows a cost, renewal, or payment requirement, pause and check the free-month terms before continuing.
4. On the next setup step, check what line/number is provisioned, whether inbound SMS and inbound calls are enabled, what SIP or voice-tool connection is required, whether transcripts/webhooks/call controls are actually available, and any plan/usage/expiry terms. Save a screenshot of the step and share it with the team before making a paid selection.
5. In project Settings, locate the **Project ID** and **Secret Key**.
6. On the development machine, copy `.env.example` to `.env` and enter the values there. Do not paste the Secret Key into chat or commit `.env`; the project `.gitignore` excludes it.

The team only needs to tell the coding assistant that the project is created, which channels/line are ready, and what the next setup page says. The Secret Key stays in the local ignored `.env` file.

## Codex Photon MCP (developer setup)

Photon's official MCP guide identifies `https://mcp.photon.codes/mcp` as its hosted Streamable HTTP server and documents these Codex commands:

```sh
codex mcp add photon --url https://mcp.photon.codes/mcp
codex mcp login photon
```

The endpoint is registered and OAuth is connected. A read-only `getCurrentOrganization` call returned the signed-in Photon organization, confirming the connection works in this Codex session. `codex mcp list` may still display `Auth Unknown` for this endpoint even when that authenticated tool call succeeds. Photon MCP tools can create/configure projects, manage lines, read/send messages, and check usage/billing. Review each tool call; keep approval on for sends, purchases, and edits/deletions. OAuth tokens and API secrets must stay out of the repository and chat.

## Current Photon project status (checked 2026-11-07)

- The `SignalBridge` project exists in the connected organization, on the **Messaging Free** plan. Its plan base fee is $0 for the current period, which ends `2026-12-07T07:59:59Z`.
- The Photon organization also has **$100.00 USD in available credit** (`balanceCents: 10000`), verified through the read-only billing API. Photon says organization credit offsets invoices except one-off invoices; the API result does not yet confirm whether the $2 number charge is eligible.
- Photon lists SMS and Voice among the project platform types, but the project currently has **no provisioned resources or lines**. Platform availability does not mean a number or call path is ready.
- The billing overview shows no usage so far. It lists a **$2.00 pay-in-advance charge per US local number**; the number-purchase operation creates an SMS-enabled number. Carrier/message usage can add separate metered charges. No number has been purchased.
- Voice remains unconfigured. A number purchase alone would not provide a transcript or complete the SIP/audio integration; confirm the voice setup and any costs separately before enabling it.

The display name in Pharos is new, but the connected Photon Spectrum project still has the name **SignalBridge**. The local `Product/.env` file was checked on 2026-11-07 and is **not present**, so the website has no runtime Spectrum credentials. The connected Photon MCP is a developer-side control connection; it does not pass messages to the public site.

## Voice is an option, with a separate integration path

The Photon onboarding screenshot shows Voice as a selectable channel. The official voice guide documents inbound and outbound calls over SIP using a Spectrum line, but says call events do not enter `app.messages` or `app.webhook()`, SDK call control and voice webhooks are still marked “coming soon,” and RTP audio on the SIP side is not encrypted. A separate SIP voice agent/tool could receive/process audio and produce a transcript if that tool supports it; Photon’s message SDK does not supply that transcript. We can analyze the transcript's language for possible pressure patterns, then show a brief warning in an interface we control. That warning cannot appear as an overlay on an arbitrary phone call unless the call is happening inside our own app/device UI. Do not send real voice or disaster-victim data through this prototype; test with a consenting teammate and harmless script first.

The current proposed bridge is Photon SIP → LiveKit SIP ingress → LiveKit speech-to-text → a Safe Signal content check → Beacon review. This is an architecture proposal only: Photon-to-LiveKit routing and the team's LiveKit account have not been set up or verified. See [SYSTEM_PLAN.md](SYSTEM_PLAN.md) for the prerequisites and lower-scope audio-file transcription alternative.

## Other team inputs

- **T-Mobile Safe Signal:** ask the sponsor/organizer for the challenge's synthetic or approved dataset, tactic taxonomy, and baseline model/API instructions. Until then, use authored fictional messages only.
- **State Farm:** no separate API credential is currently identified in the project notes. Continue with fictional disaster requests and transparent human-reviewed prioritization unless challenge instructions specify a particular service or dataset.
- **Hugging Face:** optional, not required for the rule-based MVP. If a model is later justified, the private claim link must come from HARP/organizers; don't put that link in the repo.
- Other credits/tools (Deepspace, 639Cloud, AIsa, Lovable, etc.) are optional. Do not sign up for or add a paid service unless its use is needed and the participant has checked its terms.

## Safe first test after setup

Use a consenting teammate's harmless test text (not a real resident's information) to confirm only that Photon delivers a message into the development server. Do not auto-reply with emergency promises. The server should minimize logging, keep personal message content out of persistent storage by default, and return a concise human-review / verification response before any demo involving real numbers.

## References

- [Photon Spectrum introduction](https://photon.codes/docs/spectrum-ts/introduction)
- [Photon Spectrum getting started](https://photon.codes/docs/spectrum-ts/getting-started)
- [Photon Spectrum providers](https://photon.codes/docs/spectrum-ts/providers)
- [Photon Spectrum voice over SIP](https://photon.codes/docs/spectrum-ts/providers/voice)
