import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const publicSurfaceFiles = [
  'frontend/deentime-web/src/app/features/tv/tv.html',
  'frontend/deentime-web/src/app/features/widget/widget.html',
  'frontend/deentime-web/src/app/features/org/design/design.html',
  'frontend/deentime-web/src/app/features/org/publish/publish.html',
  'frontend/deentime-web/src/index.html'
];

const walkHtml = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const fullPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return walkHtml(fullPath);
  return entry.isFile() && entry.name.endsWith('.html')
    ? [path.relative(root, fullPath)]
    : [];
});

const activeFiles = [...new Set([
  ...publicSurfaceFiles,
  ...walkHtml(path.join(root, 'frontend/deentime-web/src/app'))
])];

const sources = activeFiles.map(relative => ({ relative, text: fs.readFileSync(path.join(root, relative), 'utf8') }));
const failures = [];
for (const { relative, text } of sources) {
  if (/>\s*Starts?\s*</i.test(text) || /Adhan\s*\/\s*Start/i.test(text))
    failures.push(`${relative}: legacy Start/Starts prayer label`);
  if (/DeenTime/i.test(text)) failures.push(`${relative}: user-visible DeenTime brand`);
}

const widget = sources.find(source => source.relative.endsWith('/widget.html'))?.text ?? '';
const tv = sources.find(source => source.relative.endsWith('/tv.html'))?.text ?? '';
const design = sources.find(source => source.relative.endsWith('/design.html'))?.text ?? '';
if (!/Adhan/i.test(widget) || !/Adhan/i.test(tv) || !/Adhan/i.test(design))
  failures.push('TV, widget, and Design preview must all expose the Adhan label');
if (!/Sunrise/i.test(widget) || !/Shuruq/i.test(widget) || !/Sunrise/i.test(tv))
  failures.push('Sunrise/Shuruq must remain distinct from Adhan and Iqama');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Public copy check passed for ${sources.length} active templates.`);
