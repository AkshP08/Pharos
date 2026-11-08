# Existing LiveKit hosted intake

The single hosted agent already exists and is tracked in `livekit.toml`. **Do not run `lk agent create` again.** Update this agent rather than provisioning another region/project/paid plan. The old local `pharos-intake` worker was deliberately stopped after hosted startup became healthy.

The previous hosted image passed a bounded synthetic WebRTC speech→case→area→cleanup check. That evidence does not validate a later image. Every responder-review/audio update needs status, source, offline tests, then a bounded full-flow check and a coordinated real Photon call.

## Configuration and packaging

Use the ignored `.env.local` for existing project CLI authentication without printing values or putting keys in arguments. `.env.hosted.local` is an owner-only whitelist produced by:

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/prepare_hosted_secrets.py --mode intake
```

Do not overwrite intentional settings without reviewing the key names. Hosted configuration must keep intake mode, resident relay disabled, approved caller allowlist,180-second cap, and normally browser tests disabled. Local LiveKit API keys and SIP/Photon passwords are excluded; hosted LiveKit injects its URL/API credentials. Its HTTPS gateway is converted to encrypted WSS by the installed SDK; validation retains the managed marker and rejects malformed/credential-bearing/public plaintext URLs.

Docker uses Python3.13 slim, a non-root user, pinned direct dependencies, and an explicit four-module copy: `agent.py`, `pharos_runtime.py`, `pharos_semantic.py`, `pharos_audio.py`. `.dockerignore` excludes env files, tests, credentials, virtualenvs, and logs. Caller recordings stay in bounded memory and are encrypted by the existing backend; no Egress account or new dependencies are needed. Transitive packages resolve during the hosted build.

## Update and verify

The official `lk` CLI is installed. Load only the needed existing credentials into the process environment using the local operator helper; do not paste them into commands, logs, or recordings. From `Product/voice-agent`, use the installed CLI commands for the same tracked agent:

```sh
lk agent status
lk agent deploy .
lk agent update-secrets --secrets-file .env.hosted.local .
```

Secret updates restart the agent. A successful CLI exit or completed image build is not proof of a healthy worker; inspect the actual status. Sample safe registration/exception markers rather than dumping provider logs containing private metadata. Keep exactly the intended worker version registered for the existing `pharos-intake` SIP dispatch.

The existing inbound trunk has60-second ringing and180-second max call duration. Its caller allowlist, media configuration, and credentials were preserved. Build can cold-start after idle (previously listed10–20seconds); it is not always warm. Fixed free allowances fail at their limits rather than authorizing a paid upgrade. Check the actual project plan/usage if changing deployment settings.

For synthetic RTC QA, temporarily enable browser tests only on the intended hosted intake, use a private generated-audio room with no physical microphone/PSTN, delete the room, and restore the flag afterward. Label that evidence WebRTC, not Photon. New recording QA must give consent separately so risky speech occurs after acknowledgment, verify actual authenticated WAV playback, and check no unconsented/bot audio or surviving room remains.

Official references: [builds](https://docs.livekit.io/deploy/agents/builds/), [deployments](https://docs.livekit.io/deploy/agents/managing-deployments/), [secrets](https://docs.livekit.io/deploy/agents/secrets/), [quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/#metered-resources), and [billing](https://docs.livekit.io/deploy/admin/billing/#agent-deployment).
