// Fails the build if site copy contains em or en dashes.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = ['index.html', '404.html', 'work', 'tools', 'partials', 'src'];
const TEXT_FILE = /\.(html|js|css|json)$/;
const RULES = [
  { re: /—/g, name: 'em dash' },
  { re: /–/g, name: 'en dash' },
];

const files = [];
const walk = (p) => {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(join(p, f)));
  else if (TEXT_FILE.test(p)) files.push(p);
};
TARGETS.forEach(walk);

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const { re, name } of RULES) {
      for (const m of line.matchAll(re)) problems.push(`${file}:${i + 1}:${m.index + 1}  ${name}`);
    }
  });
}

if (problems.length) {
  console.error(`Copy check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Copy check passed (${files.length} files).`);
