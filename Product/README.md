# SignalBridge Product Prototype

SignalBridge is a synthetic-data prototype for the HackUTD 2026 State Farm, T-Mobile Safe Signal, and Photon challenges. It demonstrates two connected workflows:

## Project overview

During a disaster, responders need to understand who may need help soon, while residents may receive urgent messages that could be genuine warnings or attempts to exploit the emergency. SignalBridge is a response-desk prototype that supports both sides of that problem.

- **Help-request queue:** Organizes residents’ self-reported requests by concrete facts such as rising water, inability to exit, injury, or dependence on powered medical equipment. Missing details stay visible for follow-up. A human responder reviews and can change the suggested order.
- **Pressure Trace:** Highlights wording that can be used to manipulate people during a crisis, such as a made-up deadline, demands for money or verification codes, claimed authority, or instructions not to verify elsewhere. It shows the words that triggered a warning and suggests checking through a trusted source found independently.

The goal is to help people verify suspicious messages and help response teams see reported needs clearly. A warning is not proof of a scam, and a queue position is not a dispatch decision.

1. Organize help requests in a responder queue, showing which reported facts led to a suggested order and keeping incomplete requests visible for follow-up.
2. Explain pressure tactics in a suspicious disaster-related message with a transparent **Pressure Trace** and a safe next step.

## Run it

Open `index.html` in a modern browser. This first version is a static frontend and needs no package installation. All case and scam examples are fictional. The screen labels the Photon connection as unconfigured; it does not monitor real calls, send messages, or dispatch responders.

## Prototype boundaries

- The queue labels are demonstration categories, not a clinical triage standard.
- The demo analyzer is a small transparent keyword/rule sketch. It is not a validated scam detector and does not identify a sender or determine intent.
- The queue and analyzer use self-reported / synthetic inputs and require human review.
- Photon API credentials and channel setup are not yet connected. Keep secrets out of frontend code; add a backend integration only after the team activates its Photon access and confirms the hackathon-supported channel.

## Live demo hosting

The current product is a static HTML/CSS/JavaScript demo, so it can be published without a backend. Photon is the messaging API, not the website host; its $100 organization credit is separate from hosting credits.

The DeepSpace app is registered and its static-only host wrapper builds the current Product files into a deployable site. A production build completed on Nov 7, 2026. A private GitHub repository has been created under the team's student account, and the local project is connected to it. The first source commit and push are being prepared under the configured student Git identity.

The intended URL is `https://signalbridge-hackutd-2026.app.space` if the name remains available at deployment. The app is not live yet. The hosted page will contain fictional examples only; it will not connect to Photon, receive real calls or messages, or process emergency data. See [DeepSpace deployment](https://docs.deep.space/concepts/deployment) and [Lovable publishing overview](https://lovable.dev/guides/build-database-app-without-coding).

No public link has been created yet. Vercel's Drop page led to a Pro trial checkout with a card requirement; we closed it before starting the trial or uploading the project.

## Files

- `index.html` — app structure and synthetic scenario.
- `styles.css` — responsive visual system.
- `app.js` — queue interactions and prototype Pressure Trace behavior.
- `PROJECT_LOG.md` — dated decisions, blockers, workarounds, milestones, and screenshot links.
- `PHOTON_SETUP.md` — current Photon credential setup, supported integration scope, and sponsor inputs needed.
