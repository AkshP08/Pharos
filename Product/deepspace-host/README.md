# SignalBridge DeepSpace deploy wrapper

This folder contains the small DeepSpace host wrapper for the static SignalBridge demo. The product source of truth stays one level up in `Product/`: `index.html`, `app.js`, `styles.css`, and `about.html`. The Worker serves static assets and a health route only; the starter's sample API, chat, and storage routes were removed.

## Build and deploy

- `npm run build` copies the current product files into this host folder and builds the static site.
- `npx deepspace auth whoami` checks the signed-in account.
- `npx deepspace app init --json` registers the app under the signed-in DeepSpace account.
- After the GitHub repo is connected and the team has pushed the source, `npx deepspace deploy` publishes the local working tree at `https://signalbridge-hackutd-2026.app.space` if that name is available.

The public site contains synthetic examples only. It does not include Photon credentials, live messaging, calling, or emergency data. Do not place secrets in this folder or its frontend files. Keep commits and pushes attributed to a team member.
