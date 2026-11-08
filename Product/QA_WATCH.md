# Local QA watcher

This is a prepared local runner. It has not been installed as a service or left running. The root agent/operator owns launching it after the current manual integration checks finish. Add `Product/.qa-watch/` to the repository's `.gitignore` before launching; this change is intentionally left to root.

Run these commands from any directory by using an absolute path, or from the repository root as shown:

```sh
node Product/qa-watch.mjs --help
node Product/qa-watch.mjs --plan
node Product/qa-watch.mjs --self-test
node Product/qa-watch.mjs --initial
```

The last command stays in the foreground. Root should launch it in a root-owned terminal/session and keep that session alive. A short-lived subagent must not launch it and claim monitoring will continue. Stop it with Control-C and wait for it to exit. No daemon, agent worker, phone route, provisioning command, deployment, or service configuration is created.

Use a bounded run when continuous watching is unnecessary:

```sh
node Product/qa-watch.mjs --once --lane voice
node Product/qa-watch.mjs --once --lane ui
node Product/qa-watch.mjs --once --lane backend
node Product/qa-watch.mjs --status
```

`--lane all` is the default. A missing command/dependency or missing required coverage produces failure, not a pass. `--self-test` uses an in-memory scheduling fixture and starts no child commands or application services. `--plan` lists commands, watched paths, and coverage gaps without executing them.

## Three independent lanes

| Lane | Fixed checks | Source changes that schedule it |
| --- | --- | --- |
| Backend | Local TypeScript compiler; site-asset sync; one Vite Worker build; generated-secret-file cleanup; explicit compiled SQLite/domain/crypto/notification Node test files | Maintained host TypeScript/build configuration/package manifests and backend tests/fixtures |
| Voice | Virtualenv Python offline unittest discovery; a separate dummy `agent.py --check-config` invocation | Maintained voice Python, tests, dependency manifests/locks |
| UI | `node --check` on maintained application scripts; permanent Guard and Beacon VM contract tests | Product scripts/HTML/CSS/manifest/SVG and UI contract tests |

Only the backend lane builds. It runs each stage serially, and other lanes cannot trigger a second build. The backend test discovery excludes Guard/Beacon client VM files because those belong to the UI lane. Compiled Worker tests require the project's normal installed dependencies and local loopback access for Miniflare. The runner installs nothing.

UI contract files are discovered under `Product/deepspace-host/tests/`, with names beginning `guard` or `beacon` and ending `.test.mjs`. **Absent permanent Beacon contracts are a coverage gap and fail the UI lane**, even when script syntax and Guard tests pass. File presence is not a claim that all user journeys or visual layouts are covered. These are VM contracts; real browser, real phone, push delivery, model interpretation, and hosted-service checks remain separate.

## Pause backend before a manual build or deployment

```sh
node Product/qa-watch.mjs --pause-backend
node Product/qa-watch.mjs --status
```

Wait until the status reports `lanes.backend.active: false` and `paused: true` before starting a manual build/deploy. A running command is allowed to finish; the pause marker prevents the next backend command/run. Do not infer that the pause request stopped an active build immediately. After the manual task:

```sh
node Product/qa-watch.mjs --resume-backend
```

Changes made while paused remain queued. If a run was interrupted or source changed, resumption runs one fresh complete backend check. With no queued change, the lane conservatively remains pending until the next edit; stop/restart with `--initial` for an explicit fresh check. Alternatively stop the watcher entirely and wait for it to exit before manual builds. A runner lock prevents two watcher/once processes from starting concurrently. If the process was killed and left a stale lock, inspect the PID in `Product/.qa-watch/runner.lock`, verify it is no longer alive, then remove only that stale lock. Never remove an active runner's lock.

## Scheduling and status

The runner scans maintained files every 750 ms and fingerprints file contents. It excludes hidden files/directories, `.env*`, `.dev.vars*`, Git, dependencies, virtualenvs, generated `dist`/`public`, Python caches, screenshots, logs, and generated host `index.html`. Excluded secret files are never opened by the scanner. Source additions/deletions change the fingerprint; touching an unchanged file does not rerun checks. Documentation and screenshot changes do not schedule tests. Restart the watcher after editing the runner itself.

A source change immediately marks the previous result pending when the next scan observes it. A two-second debounce combines edits. Each lane has at most one active execution; changes during it queue one subsequent fresh run. A completed run cannot turn green if its source fingerprint changed while it was running. Independent lanes may run concurrently.

`Product/.qa-watch/status.json` contains per-lane `pending`, `running`, `pass`, or `fail`, source/tested fingerprints, pause/queue flags, timestamps, command exit codes, safe numeric test counts, and coverage gaps. It is written atomically with owner-only file permissions. The `--status` command also compares current fingerprints and checks whether the saved runner is alive, marking interrupted/stale results pending. A stopped watcher is not ongoing monitoring. Before reporting progress, use `--status`; do not present an old JSON pass as a current check after new edits.

## Credentials, output, and scope

Children receive an allowlist of ordinary OS environment fields plus dummy API/LiveKit credentials, `.invalid` service URLs, a fictional caller allowlist, and disabled relay/browser/semantic/SMS flags. Parent provider credentials, tokens, proxy settings, `NODE_OPTIONS`, and Python path hooks are not inherited. The voice bootstrap patches `dotenv.load_dotenv` before test/agent imports, preventing `.env.local` loading, and rejects Python socket connection attempts. It runs tests and configuration checks only, never the voice-worker startup CLI. Voice tests use mocked provider clients.

The backend uses the project's existing local Vite build configuration, which may inspect local ignored build-variable files as a normal manual build does; the scanner does not read them. The cleanup stage removes generated local-secret files. Backend tests provide fixture credentials and mocked providers, not live service credentials. Review newly added test files to preserve that offline contract: this runner is not an OS network sandbox, and native libraries can have networking implementations outside Python sockets.

Raw child stdout/stderr is suppressed and not written to reports. Reports retain only command labels, exits, timing state, and whitelisted numeric counts, so a failing build cannot dump credentials or call content through watcher logs. For detailed failure diagnosis, deliberately run the named check manually in the appropriate workspace. No phone, model, notification, provider-configuration, paid-service, or live endpoint probe is part of this runner.

The watcher detects regressions; it does not fix code, make commits, deploy, provision resources, send notifications, or establish production readiness. Root remains responsible for reviewing failures, scheduling manual tests safely, updating the project log, and committing changes in task-sized chunks.
