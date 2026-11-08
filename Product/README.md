# Pharos Product Prototype

Pharos is a synthetic-data prototype for the HackUTD 2026 State Farm, T-Mobile Safe Signal, and Photon challenges. It has two audience experiences:

- **Pharos Flare — residents:** voice-first by design. A caller speaks to a short intake agent; the web request form is a fallback. The current site previews a fictional call and has no phone line configured.
- **Pharos Beacon — responders:** review a sample needs queue, see why a case is suggested for follow-up, keep unknown details visible, and review suspicious contacts separately from help requests.
- **Pharos Guide:** an animated tiny Pharaoh in the corner. The helper answers fixed prototype and message-safety questions; it is not connected to an AI model or live emergency services.

The triage example is transparent and human-reviewed. It considers stated safety needs and resource constraints, not a resident's tone, persistence, or number of messages. A message warning is a prompt to verify independently, not proof of fraud or caller identity.

## Run it

Open `index.html` in a modern browser. This frontend needs no package installation. The sample call, form preview, message checker, and guide are local demo interactions; they do not place a call, use a microphone, send or store data. All incidents and messages are fictional.

## Current boundaries

- Photon MCP is connected for developer-side operations. Photon 2.0's published voice path uses SIP with a voice platform such as LiveKit; Pharos is **not connected at runtime** yet. It has no runtime API key, provisioned voice line, SIP route, LiveKit agent, transcript, or live messages.
- The DeepSpace deployment currently serves static files only. There is no database, real responder notification, or live warning source.
- The queue is not a validated emergency triage standard. People and responders must use official local emergency procedures.
- The message analyzer uses transparent demo rules. It cannot authenticate a sender or determine intent.
- See [the system integration plan](SYSTEM_PLAN.md) for the API architecture, voice transcription choices, and exact setup needed before live data.

## Live demo hosting

The product is currently live at [signalbridge-hackutd-2026.app.space](https://signalbridge-hackutd-2026.app.space). The public URL and private GitHub repository slug still use the former SignalBridge name; the app itself is being renamed Pharos. The source is in the private [GitHub repository](https://github.com/AkshP08/signalbridge-hackutd-2026), with commits and pushes under the student's account.

The hosted page currently contains fictional examples only. See [DeepSpace deployment](https://docs.deep.space/concepts/deployment).

## Project files

- `index.html` — app structure and Flare/Beacon experiences.
- `styles.css` — responsive visual system, call-first view, and animated Pharaoh guide.
- `app.js` — local demo interactions, message checks, and fixed-answer guide.
- `PROJECT_LOG.md` — dated decisions, blockers, workarounds, milestones, and screenshot links.
- `PHOTON_SETUP.md` — current Photon status and setup notes.
- `SYSTEM_PLAN.md` — integration architecture and required participant/sponsor inputs.
