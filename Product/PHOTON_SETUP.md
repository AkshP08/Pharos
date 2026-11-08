# Photon setup for Pharos

## What Photon can power in this project

The primary Photon integration is an inbound **phone call** into Pharos Flare, routed by Photon over SIP to a LiveKit voice agent. The call agent will collect a short help request and pass its confirmed, structured facts to Beacon for human review. SMS and the web form are backup paths. The current `Product/` app is static, so it has no secure place to hold Photon credentials or receive call-derived data.

There are two Photon generations to keep distinct. The connected participant project is in the **Photon 2.0 beta** dashboard. Photon 2.0 documents project-scoped HTTP API calls using a `PHOTON_PROJECT_ID` and Bearer `PHOTON_API_KEY`; it also documents inbound/outbound phone calls over SIP and has a cookbook for connecting Photon calls to LiveKit. The legacy/stable `spectrum-ts` SDK uses a Project ID and Secret Key. Do not mix the beta API key with legacy SDK configuration; use the credential type for the integration we actually choose.

There are two different Photon connections in this work:

- **Photon MCP for the developer:** lets Codex set up Photon projects/channels and inspect or manage Photon messages and billing.
- **Photon 2.0 API/SIP at runtime:** lets a backend call the API and configure the separate phone-call route. Connecting the developer MCP does not connect the app itself; the runtime app still needs its own server-side credentials and a configured line/voice path.

## Which channels Pharos needs

- **Voice — core experience.** A person in a disaster should be able to call and speak instead of having to navigate a website. Photon SIP routes the call to a voice agent such as LiveKit; the agent handles the short intake conversation and transcript. Photon call routing is distinct from the SMS message event loop.
- **SMS — supporting path.** Use for short warning and message-safety interactions or as a fallback for someone who can safely text.
- **iMessage — optional.** It could make a polished native Apple demo, but overlaps with SMS for the first prototype and narrows the test audience to iPhone users. Add it only if the team will test the iMessage-specific path or the sponsor asks for it.
- **WhatsApp — skip initially.** Photon documents this as the official WhatsApp Business Cloud API, requiring Meta credentials, and it supports 1:1 conversations. That adds account setup without improving the U.S.-focused SMS/voice demo. Revisit if the target community or challenge rubric specifically calls for WhatsApp.

The current recommended onboarding selection is **Voice + SMS**, with Voice treated as the primary intake path. The current UI must state that its hotline is not connected until the Photon number and SIP route have been provisioned and verified.

## Participant setup

Use the HackUTD offer directions supplied by the team:

1. Visit [Photon Beta](https://photon.codes/beta) and sign up / open the [Photon dashboard](https://app.photon.codes/dashboard) to redeem the one-month offer.
2. Create a Spectrum project in the dashboard.
3. On the onboarding page **“Where will your agents talk?”**, select **Voice** as the primary experience; add SMS as a backup if both remain selectable. Check the resulting Voice/line configuration and pricing. Channel selection alone does not provision a number or configure a LiveKit agent.
4. Open Photon’s [2.0 Cookbooks](https://photon.codes/docs/beta/cookbooks) and choose **LiveKit**. Confirm the exact inbound route, number/line requirements, SIP settings, and any billing before provisioning anything. Photon describes the LiveKit cookbook as connecting Photon calls to LiveKit rooms with SIP trunks and optional agents.
5. In the Photon 2.0 project settings, locate the project ID and API key needed by the chosen Photon 2.0 API route. Keep the key in an ignored local `.env` or server-side secret store. If using a separate legacy Spectrum SDK, follow its documentation for a Project Secret instead.
6. Check what audio/transcript LiveKit provides, whether the agent can stream a transcript for incremental content checks, and what retention/consent settings apply. Save a screenshot with credentials hidden. If any step introduces charges, check the credit/terms and ask the account owner before purchasing.

The team only needs to share non-secret setup details: whether Voice/line is enabled, whether Photon shows the LiveKit route/cookbook, and which steps remain. Never send API keys, SIP passwords, or phone numbers belonging to a person in chat.

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
- The billing overview showed no usage so far. A **$2.00 pay-in-advance charge per US local number** was listed; carrier/message usage can add separate metered charges. No number has been purchased. Confirm whether the currently offered Photon voice line has separate fees and whether credits cover them.
- The voice integration remains unconfigured. Photon 2.0 now has a published SIP/LiveKit cookbook, making voice-first implementation a real path to build toward. A selected Voice channel or a number by itself still does not connect an agent, expose a usable transcript, or send intake data to Beacon.

The display name in Pharos is new, but the connected Photon project still has the name **SignalBridge**. The local `Product/.env` file was checked on 2026-11-07 and is **not present**, so the app has no Photon 2.0 API key or legacy Spectrum runtime credentials. The connected Photon MCP is a developer-side control connection; it does not pass call audio or messages to the public site.

## Voice is the primary path, using SIP into a voice agent

Photon's Oct. 15, 2026 Photon 2.0 announcement confirms inbound and outbound calling over SIP and links cookbooks for Retell, ElevenLabs, LiveKit, and Twilio. The Photon 2.0 cookbook page describes LiveKit as connecting Photon calls to LiveKit rooms with SIP trunks and optional agents. Use this call/SIP route for voice intake. The older stable Spectrum messaging API's `app.messages` loop is for message events; do not expect phone audio or a transcript to arrive as an ordinary SMS/message object.

The planned call flow is Photon number → SIP routing → LiveKit voice agent → speech-to-text plus short voice prompts → confirmed structured request → Beacon. A second pass can flag exact scam-like wording to a human reviewer. The line and LiveKit account are not configured yet, so this project's end-to-end path remains unverified. Do not auto-hang-up or reject a caller based on a text score; continue intake and keep the help report visible. Check the Photon Beta call route's transport security and voice-data handling before any call with sensitive content. For this prototype, use only a consenting teammate and a fictional script.

## Other team inputs

- **T-Mobile Safe Signal:** ask the sponsor/organizer for the challenge's synthetic or approved dataset, tactic taxonomy, and baseline model/API instructions. Until then, use authored fictional messages only.
- **State Farm:** no separate API credential is currently identified in the project notes. Continue with fictional disaster requests and transparent human-reviewed prioritization unless challenge instructions specify a particular service or dataset.
- **Hugging Face:** optional, not required for the rule-based MVP. If a model is later justified, the private claim link must come from HARP/organizers; don't put that link in the repo.
- Other credits/tools (Deepspace, 639Cloud, AIsa, Lovable, etc.) are optional. Do not sign up for or add a paid service unless its use is needed and the participant has checked its terms.

## Safe first test after setup

Use a consenting teammate to call the configured test number and read a harmless fictional help script. Verify audio reaches the LiveKit agent, the speech transcript is intelligible, the agent asks only the short core questions, it reads back the summary, and the structured test request appears in a protected Beacon queue. Do not use a real resident, real disaster, or sensitive medical details. Keep raw audio out of persistent storage and set a transcript deletion/retention rule before testing.

## References

- [Photon Spectrum introduction](https://photon.codes/docs/spectrum-ts/introduction)
- [Photon Spectrum getting started](https://photon.codes/docs/spectrum-ts/getting-started)
- [Photon Spectrum providers](https://photon.codes/docs/spectrum-ts/providers)
- [Photon Spectrum voice over SIP](https://photon.codes/docs/spectrum-ts/providers/voice)
- [Photon 2.0 announcement](https://photon.codes/blog/introducing-photon-2.0)
- [Photon Beta cookbooks (including LiveKit)](https://photon.codes/docs/beta/cookbooks)
