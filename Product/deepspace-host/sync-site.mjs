import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const productDir = path.resolve(hostDir, '..');
const publicDir = path.join(hostDir, 'public');

for (const file of ['manual.html', 'docs.css', 'app.js', 'styles.css', 'about.html', 'guard.html', 'guard.js', 'guard-worker.js', 'guard.webmanifest', 'guard-icon.svg']) {
  copyFileSync(path.join(productDir, file), path.join(publicDir, file));
}

const html = readFileSync(path.join(productDir, 'index.html'), 'utf8')
  .replace('href="styles.css"', 'href="/styles.css"')
  .replace('src="app.js"', 'src="/app.js"');
writeFileSync(path.join(hostDir, 'index.html'), html);

// DeepSpace's GitHub-source releases retain bundles but do not record commit
// lineage. Publish a credential-free source stamp with each actual asset build.
let commit = null;
let dirty = true;
try {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hostDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (/^[a-f0-9]{40}$/.test(sha)) commit = sha;
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: hostDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch { /* A source export without Git is explicitly marked untraceable. */ }
writeFileSync(path.join(publicDir, 'build.json'), JSON.stringify({ commit, dirty, builtAt: new Date().toISOString(), repository: 'https://github.com/AkshP08/Pharos' }) + '\n');
