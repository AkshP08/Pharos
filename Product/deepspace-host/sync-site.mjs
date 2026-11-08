import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const productDir = path.resolve(hostDir, '..');
const publicDir = path.join(hostDir, 'public');

for (const file of ['app.js', 'styles.css', 'about.html']) {
  copyFileSync(path.join(productDir, file), path.join(publicDir, file));
}

const html = readFileSync(path.join(productDir, 'index.html'), 'utf8')
  .replace('href="styles.css"', 'href="/styles.css"')
  .replace('src="app.js"', 'src="/app.js"');
writeFileSync(path.join(hostDir, 'index.html'), html);
