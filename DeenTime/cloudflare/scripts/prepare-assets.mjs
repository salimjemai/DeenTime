// Copies the Angular production build into dist-web/masjid so the Worker serves it at /masjid/.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../frontend/deentime-web/dist/deentime-web/browser');
const target = join(here, '../dist-web/masjid');
if (!existsSync(join(source, 'index.html'))) {
  console.error(`No Angular build at ${source}. Run "npm run build:web" first.`);
  process.exit(1);
}
rmSync(join(here, '../dist-web'), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Copied the Angular build into ${target}`);
