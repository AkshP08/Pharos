#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT = path.dirname(fileURLToPath(import.meta.url));
const HOST = path.join(PRODUCT, 'deepspace-host');
const VOICE = path.join(PRODUCT, 'voice-agent');
const REPORTS = path.join(PRODUCT, '.qa-watch');
const PAUSE = path.join(REPORTS, 'pause-backend');
const NAMES = ['backend', 'voice', 'ui'];
const DEBOUNCE = 2000;
const SKIP = new Set(['node_modules', '.git', 'dist', 'public', '.venv', '__pycache__', 'screenshots', 'logs', 'cache', 'coverage']);
const uiTest = name => /^(?:guard|beacon).*\.test\.mjs$/i.test(path.basename(name));

function lanesFor(relative) {
  const parts = relative.split('/');
  if (parts.some(part => SKIP.has(part) || part.startsWith('.')) || /(?:\.log|\.pyc|~)$/.test(relative)) return [];
  if (parts[0] === 'deepspace-host') {
    if (relative === 'deepspace-host/index.html') return []; // sync-site generates it.
    if (parts[1] === 'tests' && uiTest(relative)) return ['ui'];
    return /\.(?:ts|mjs|json|jsonc|toml)$/.test(relative) ? ['backend'] : [];
  }
  if (parts[0] === 'voice-agent') return /(?:\.py|pyproject\.toml|uv\.lock|requirements[^/]*\.txt)$/.test(relative) ? ['voice'] : [];
  return parts.length === 1 && /\.(?:js|html|css|webmanifest|svg)$/.test(relative) ? ['ui'] : [];
}

async function snapshot(root = PRODUCT) {
  const files = Object.fromEntries(NAMES.map(name => [name, []]));
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) {
        const lanes = lanesFor(relative);
        if (!lanes.length) continue;
        const bytes = await readFile(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
        if (!bytes) continue;
        const digest = createHash('sha256').update(bytes).digest('hex');
        for (const lane of lanes) files[lane].push({ relative, digest });
      }
    }
  }
  await walk(root);
  return Object.fromEntries(NAMES.map(name => {
    const entries = files[name].sort((a, b) => a.relative.localeCompare(b.relative));
    return [name, { files: entries.map(entry => entry.relative), fingerprint: createHash('sha256').update(JSON.stringify(entries)).digest('hex') }];
  }));
}

function cleanEnvironment() {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PYTHONDONTWRITEBYTECODE: '1', PYTHON_DOTENV_DISABLED: '1',
    PHAROS_API_URL: 'https://qa-watch.invalid', PHAROS_INGEST_TOKEN: 'qa-watch-dummy-ingest',
    LIVEKIT_URL: 'wss://qa-watch.invalid', LIVEKIT_API_KEY: 'qa-watch-dummy-key', LIVEKIT_API_SECRET: 'qa-watch-dummy-secret',
    PHAROS_CALL_MODE: 'intake', PHAROS_AGENT_NAME: 'qa-watch-offline', PHAROS_TEST_CALLER_NUMBERS: '+12025550101',
    PHAROS_ALLOW_BROWSER_TESTS: 'false', PHAROS_ENABLE_GUARD_RELAY: 'false', PHAROS_GUARD_RESIDENT_CONSENTED: 'false',
    PHAROS_SEMANTIC_GUARD_REVIEW: 'false', PHAROS_MAX_CALL_SECONDS: '30', PHAROS_GUARD_MAX_SECONDS: '30',
    PHAROS_SMS_ENABLED: 'false', PHAROS_RESPONDER_PASSWORD: 'qa-watch-dummy-responder',
    PHAROS_COORDINATOR_PASSWORD: 'qa-watch-dummy-coordinator', PHAROS_SESSION_SECRET: 'qa-watch-dummy-session-secret',
  };
}

// Patch before importing agent/tests: never open .env.local or use real network
// credentials. Socket denial also makes an accidentally unmocked Python request fail.
const PY_BOOT = `import sys, socket, dotenv\ndef deny(*args, **kwargs):\n    raise RuntimeError('QA watcher forbids network access')\ndotenv.load_dotenv = lambda *args, **kwargs: False\nsocket.socket.connect = deny\nsocket.socket.connect_ex = deny\nsocket.create_connection = deny\n`;
const PY_TEST = PY_BOOT + `import unittest\nsuite = unittest.defaultTestLoader.discover('tests')\nresult = unittest.TextTestRunner(verbosity=2).run(suite)\nraise SystemExit(0 if result.wasSuccessful() else 1)\n`;
const PY_CONFIG = PY_BOOT + `import runpy\nsys.argv = ['agent.py', '--check-config']\nrunpy.run_path('agent.py', run_name='__main__')\n`;

function plan(name, inventory) {
  const command = (label, executable, args, cwd, timeout = 300000) => ({ label, executable, args, cwd, timeout });
  const node = (label, args, cwd = PRODUCT) => command(label, process.execPath, args, cwd);
  const gaps = [];
  let commands = [];
  if (name === 'backend') {
    const tests = inventory.files.filter(file => /^deepspace-host\/tests\/.*\.test\.mjs$/.test(file) && !uiTest(file)).map(file => path.join(PRODUCT, file));
    if (!tests.length) gaps.push('No backend regression test files found.');
    commands = [
      node('backend typecheck', [path.join(HOST, 'node_modules/typescript/bin/tsc'), '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--types', '@cloudflare/workers-types', '--lib', 'ES2022', 'worker.ts', 'pharos-domain.ts', 'pharos-store.ts'], HOST),
      node('sync maintained site assets', [path.join(HOST, 'sync-site.mjs')], HOST),
      node('single compiled Worker build', [path.join(HOST, 'node_modules/vite/bin/vite.js'), 'build'], HOST),
      node('remove generated local-secret files', [path.join(HOST, 'clean-build-secrets.mjs')], HOST),
      ...(tests.length ? [node('compiled SQLite/domain/crypto/notification tests', ['--test', ...tests], HOST)] : []),
    ];
  } else if (name === 'voice') {
    const python = path.join(VOICE, '.venv', 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    if (!existsSync(python)) gaps.push('Voice virtualenv Python is missing; install dependencies manually.');
    commands = [command('offline voice unittest discovery', python, ['-B', '-c', PY_TEST], VOICE, 180000), command('offline dummy configuration check', python, ['-B', '-c', PY_CONFIG], VOICE, 60000)];
  } else {
    const scripts = inventory.files.filter(file => !file.startsWith('deepspace-host/') && file.endsWith('.js'));
    commands = scripts.map(file => node(`syntax ${file}`, ['--check', path.join(PRODUCT, file)]));
    const tests = inventory.files.filter(file => file.startsWith('deepspace-host/tests/') && uiTest(file));
    if (!tests.some(file => /^guard.*\.test\.mjs$/i.test(path.basename(file)))) gaps.push('Permanent Guard VM contracts are missing.');
    if (!tests.some(file => /^beacon.*\.test\.mjs$/i.test(path.basename(file)))) gaps.push('Permanent Beacon VM contracts are missing; syntax/Guard coverage cannot establish Beacon behavior.');
    if (tests.length) commands.push(node('Guard and Beacon VM contracts', ['--test', ...tests.map(file => path.join(PRODUCT, file))], HOST));
  }
  return { commands, gaps };
}

class Paused extends Error {}

class Lane {
  constructor(name, executor, changed = () => {}, clock = Date.now) {
    this.name = name; this.executor = executor; this.changed = changed; this.clock = clock;
    this.fingerprint = null; this.dirty = false; this.due = Infinity; this.active = null; this.paused = false;
    this.report = { state: 'pending', reason: 'Not checked in this watcher session.', sourceFingerprint: null, lastTestedFingerprint: null, runCount: 0, queued: false, paused: false, coverageGaps: [], commands: [] };
  }
  observe(fingerprint, schedule = true) {
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint; this.report.sourceFingerprint = fingerprint;
    this.report.reason = 'Source changed; previous results are stale.';
    if (!this.active) this.report.state = 'pending';
    this.dirty = schedule; this.due = this.clock() + DEBOUNCE;
    this.report.queued = this.dirty; this.changed();
  }
  pause(value) {
    if (this.paused === value) return;
    this.paused = value; this.report.paused = value;
    if (value) { this.report.state = this.active ? 'running' : 'pending'; this.report.reason = 'Backend paused; wait for active=false before a manual build/deploy.'; }
    this.changed();
  }
  tick(force = false) {
    if (this.active || this.paused || !this.dirty || !force && this.clock() < this.due) return;
    const tested = this.fingerprint;
    this.dirty = false; this.report.queued = false;
    Object.assign(this.report, { state: 'running', reason: null, startedAt: new Date().toISOString(), finishedAt: null, runCount: this.report.runCount + 1, commands: [], coverageGaps: [] });
    this.changed();
    this.active = (async () => {
      let result;
      try { result = await this.executor(this); }
      catch (error) { result = { ok: false, paused: error instanceof Paused, reason: error instanceof Paused ? 'Paused before the next command.' : 'Runner error; inspect the command exit code or rerun it manually.' }; }
      Object.assign(this.report, { finishedAt: new Date().toISOString(), commands: result.commands || this.report.commands, coverageGaps: result.gaps || [] });
      if (this.fingerprint !== tested || this.dirty || result.paused) {
        this.dirty = true; this.report.queued = true; this.report.state = 'pending'; this.report.reason = result.paused ? result.reason : 'Changes arrived during the run; one fresh run is queued.';
      } else {
        this.report.lastTestedFingerprint = tested; this.report.state = result.ok ? 'pass' : 'fail'; this.report.reason = result.reason || (result.ok ? null : 'A command failed or required coverage is missing.');
      }
      this.active = null; this.changed();
    })();
    return this.active;
  }
}

function safeCounts(output) {
  const result = {};
  for (const [key, pattern] of Object.entries({ tests: /(?:ℹ|#) tests (\d+)/, pass: /(?:ℹ|#) pass (\d+)/, fail: /(?:ℹ|#) fail (\d+)/, pythonTests: /Ran (\d+) tests?/ })) {
    const match = output.match(pattern); if (match) result[key] = Number(match[1]);
  }
  return result;
}

async function runCommand(spec) {
  return new Promise(resolve => {
    let tail = ''; let timedOut = false;
    const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: cleanEnvironment(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = bytes => { tail = (tail + bytes.toString()).slice(-65536); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    let forceKill;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); forceKill = setTimeout(() => child.kill('SIGKILL'), 5000); }, spec.timeout);
    const kill = () => child.kill('SIGTERM');
    process.once('SIGINT', kill); process.once('SIGTERM', kill);
    child.once('error', () => { clearTimeout(timeout); clearTimeout(forceKill); process.off('SIGINT', kill); process.off('SIGTERM', kill); resolve({ label: spec.label, exitCode: null, ok: false, reason: 'Command could not start.', outputSuppressed: true }); });
    child.once('close', (code, signal) => {
      clearTimeout(timeout); clearTimeout(forceKill); process.off('SIGINT', kill); process.off('SIGTERM', kill);
      resolve({ label: spec.label, exitCode: code, signal, ok: code === 0 && !timedOut, timedOut, outputSuppressed: true, counts: safeCounts(tail) });
    });
  });
}

const HELP = `Pharos QA watcher (prepare/run locally; never starts the phone agent)\n\n  node Product/qa-watch.mjs --help\n  node Product/qa-watch.mjs --plan\n  node Product/qa-watch.mjs --self-test\n  node Product/qa-watch.mjs [--initial] [--lane backend|voice|ui|all]\n  node Product/qa-watch.mjs --once [--lane backend|voice|ui|all]\n  node Product/qa-watch.mjs --status\n  node Product/qa-watch.mjs --pause-backend\n  node Product/qa-watch.mjs --resume-backend\n\nDefault: watch maintained sources; run only after a changed fingerprint.\n--initial also checks the starting snapshot. --once is bounded and forces a check.\nBefore a manual build/deploy: pause backend, then wait for backend.active=false.\nReports: Product/.qa-watch/status.json (root must add this directory to .gitignore).\nRaw child output is suppressed; failures require a deliberate manual diagnostic run.\n`;

async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  let clock = 0; let release; let runs = 0;
  const lane = new Lane('fixture', async () => { runs++; await new Promise(resolve => { release = resolve; }); return { ok: true }; }, () => {}, () => clock);
  lane.observe('a', false); lane.tick(true); assert.equal(runs, 0);
  lane.observe('b'); clock = 1000; lane.observe('c'); clock = 2999; lane.tick(); assert.equal(runs, 0);
  clock = 3000; lane.tick(); assert.equal(runs, 1); assert.equal(lane.report.state, 'running');
  const other = new Lane('independent', async () => ({ ok: true })); other.observe('a'); await other.tick(true);
  assert.equal(other.report.state, 'pass'); assert.ok(lane.active, 'Another lane must finish while this lane is still running');
  lane.observe('d'); lane.observe('e'); lane.tick(true); assert.equal(runs, 1);
  const first = lane.active; release(); await first; assert.equal(lane.report.state, 'pending');
  clock = 5000; lane.tick(); assert.equal(runs, 2); const second = lane.active; release(); await second;
  assert.equal(lane.report.state, 'pass'); lane.observe('e'); lane.tick(true); assert.equal(runs, 2);
  lane.observe('f'); assert.equal(lane.report.state, 'pending'); lane.pause(true); lane.tick(true); assert.equal(runs, 2);
  lane.pause(false); lane.tick(true); const third = lane.active; release(); await third; assert.equal(runs, 3);
  const failure = new Lane('failure', async () => ({ ok: false }), () => {}, () => 0); failure.observe('a'); await failure.tick(true); assert.equal(failure.report.state, 'fail');
  for (const file of ['.env.local', 'voice-agent/.env.local', 'deepspace-host/.dev.vars', 'deepspace-host/public/app.js', 'deepspace-host/dist/index.js', 'voice-agent/.venv/bin/python', 'deepspace-host/index.html', '.qa-watch/status.json']) assert.deepEqual(lanesFor(file), []);
  assert.deepEqual(lanesFor('voice-agent/tests/test_runtime.py'), ['voice']);
  assert.deepEqual(lanesFor('deepspace-host/tests/backend.test.mjs'), ['backend']);
  assert.deepEqual(lanesFor('deepspace-host/tests/guard-client.test.mjs'), ['ui']);
  assert.ok(plan('ui', { files: ['guard.js', 'deepspace-host/tests/guard-client.test.mjs'] }).gaps.some(gap => gap.includes('Beacon')));
  const env = cleanEnvironment(); assert.equal(env.PHAROS_ENABLE_GUARD_RELAY, 'false'); assert.equal(env.LIVEKIT_API_KEY, 'qa-watch-dummy-key');
  const fixture = await mkdtemp(path.join(tmpdir(), 'pharos-qa-watch-'));
  try {
    await mkdir(path.join(fixture, 'voice-agent'), { recursive: true });
    await writeFile(path.join(fixture, 'voice-agent', 'demo.py'), 'value = 1\n');
    const initial = await snapshot(fixture);
    await writeFile(path.join(fixture, 'voice-agent', '.env.local'), 'IGNORED=fixture-only\n');
    await writeFile(path.join(fixture, 'voice-agent', 'demo.py'), 'value = 1\n');
    assert.deepEqual(await snapshot(fixture), initial, 'Ignored files and unchanged contents must not schedule another run');
    await writeFile(path.join(fixture, 'voice-agent', 'demo.py'), 'value = 2\n');
    assert.notEqual((await snapshot(fixture)).voice.fingerprint, initial.voice.fingerprint);
  } finally { await rm(fixture, { recursive: true, force: true }); }
  console.log(JSON.stringify({ selfTest: 'pass', checks: ['debounce', 'coalescing', 'single-flight', 'independent lanes', 'one queued rerun', 'no unchanged rerun', 'no stale green', 'pause', 'failure', 'ignored paths', 'filesystem fingerprints', 'Beacon gap', 'dummy environment'], spawnedCommands: 0 }));
}

async function main() {
  const args = process.argv.slice(2);
  const switches = new Set(['--help', '-h', '--plan', '--self-test', '--once', '--initial', '--status', '--pause-backend', '--resume-backend']);
  let selected = [...NAMES];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lane') { const value = args[++i]; if (!NAMES.includes(value) && value !== 'all') throw new Error('Invalid --lane.'); selected = value === 'all' ? [...NAMES] : [value]; }
    else if (!switches.has(args[i])) throw new Error('Unknown argument. Use --help.');
  }
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--self-test')) { await selfTest(); return; }
  if (args.includes('--pause-backend') || args.includes('--resume-backend')) {
    await mkdir(REPORTS, { recursive: true, mode: 0o700 });
    if (args.includes('--pause-backend')) await writeFile(PAUSE, 'Paused by operator.\n', { mode: 0o600 });
    else await unlink(PAUSE).catch(error => { if (error.code !== 'ENOENT') throw error; });
    console.log(JSON.stringify({ backendPauseRequested: args.includes('--pause-backend'), instruction: 'Use --status; wait until backend.active=false before a manual build/deploy.' })); return;
  }
  if (args.includes('--status')) {
    const status = JSON.parse(await readFile(path.join(REPORTS, 'status.json'), 'utf8'));
    let alive = false; try { process.kill(status.pid, 0); alive = true; } catch {}
    status.runnerAlive = alive;
    const current = await snapshot();
    for (const name of Object.keys(status.lanes)) {
      const lane = status.lanes[name];
      if (lane.sourceFingerprint !== current[name].fingerprint || lane.state === 'running' && !alive) { lane.state = 'pending'; lane.reason = 'Saved report is stale or its runner stopped.'; }
    }
    console.log(JSON.stringify(status, null, 2)); return;
  }
  let inventory = await snapshot();
  if (args.includes('--plan')) {
    console.log(JSON.stringify(Object.fromEntries(selected.map(name => { const next = plan(name, inventory[name]); return [name, { watchedFiles: inventory[name].files, commands: next.commands.map(spec => ({ label: spec.label, executable: spec.executable, args: name === 'voice' ? ['-B', '-c', '[fixed offline bootstrap]'] : spec.args, cwd: spec.cwd })), coverageGaps: next.gaps }]; })), null, 2)); return;
  }
  await mkdir(REPORTS, { recursive: true, mode: 0o700 });
  const lockPath = path.join(REPORTS, 'runner.lock');
  try { const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close(); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A watcher/once-run lock already exists. Check its PID; remove only a stale Product/.qa-watch/runner.lock.'); throw error; }
  let stopping = false; let saving = Promise.resolve();
  const lanes = {};
  const save = () => {
    const status = { pid: process.pid, updatedAt: new Date().toISOString(), stopping, lanes: Object.fromEntries(Object.entries(lanes).map(([name, lane]) => [name, { ...lane.report, active: Boolean(lane.active) || lane.report.state === 'running' }])) };
    saving = saving.catch(() => {}).then(async () => { const temp = path.join(REPORTS, 'status.tmp'); await writeFile(temp, JSON.stringify(status, null, 2), { mode: 0o600 }); await rename(temp, path.join(REPORTS, 'status.json')); });
  };
  for (const name of selected) {
    lanes[name] = new Lane(name, async lane => {
      const next = plan(name, inventory[name]); const commands = [];
      for (const spec of next.commands) {
        if (stopping || name === 'backend' && existsSync(PAUSE)) throw new Paused();
        const result = await runCommand(spec); commands.push(result); lane.report.commands = [...commands]; save();
        if (!result.ok) {
          if (name === 'backend' && spec.label === 'single compiled Worker build') {
            commands.push(await runCommand(next.commands.find(command => command.label === 'remove generated local-secret files')));
          }
          return { ok: false, commands, gaps: next.gaps };
        }
      }
      return { ok: !next.gaps.length, commands, gaps: next.gaps };
    }, save);
    lanes[name].observe(inventory[name].fingerprint, args.includes('--initial') || args.includes('--once'));
  }
  const stop = () => { stopping = true; save(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (args.includes('--once')) {
      for (const lane of Object.values(lanes)) lane.pause(lane.name === 'backend' && existsSync(PAUSE));
      await Promise.all(Object.values(lanes).map(lane => lane.tick(true)));
      const finalInventory = await snapshot();
      for (const [name, lane] of Object.entries(lanes)) lane.observe(finalInventory[name].fingerprint, false);
    } else {
      console.log(JSON.stringify({ watching: selected, debounceMs: DEBOUNCE, reports: path.join(REPORTS, 'status.json'), notice: 'No phone/model worker is started. Backend must be paused before manual builds.' }));
      while (!stopping) {
        inventory = await snapshot();
        for (const [name, lane] of Object.entries(lanes)) { lane.observe(inventory[name].fingerprint); lane.pause(name === 'backend' && existsSync(PAUSE)); lane.tick(); }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      await Promise.all(Object.values(lanes).map(lane => lane.active));
    }
  } finally {
    save(); await saving; await unlink(lockPath).catch(() => {});
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  if (args.includes('--once')) {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(lanes).map(([name, lane]) => [name, lane.report]))));
    if (Object.values(lanes).some(lane => lane.report.state !== 'pass')) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('QA watcher could not complete. Check arguments/dependencies or the local runner lock; no raw command output is printed.'); process.exitCode = 1; });
}
