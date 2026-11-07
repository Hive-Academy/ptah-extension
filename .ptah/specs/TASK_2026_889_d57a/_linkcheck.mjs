import fs from 'node:fs';
import path from 'node:path';

const root = 'apps/ptah-docs';
const docsDir = path.join(root, 'src/content/docs');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.mdx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(docsDir);
const routes = new Map(); // route -> file
for (const f of files) {
  const rel = path.relative(docsDir, f).replace(/\\/g, '/').replace(/\.mdx?$/, '');
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let route = rel;
  if (m) {
    const slug = m[1].match(/^slug:\s*(.+)$/m);
    if (slug) route = slug[1].trim();
  }
  route = route.replace(/\/index$/, '');
  routes.set(route, f);
  routes.set(route + '/', f);
}

// sidebar/redirect targets
const cfg = fs.readFileSync(path.join(root, 'astro.config.mjs'), 'utf8');
const slugRe = /slug:\s*'([^']+)'/g;
const slugs = [...cfg.matchAll(slugRe)].map((m) => m[1]);
const badSlugs = slugs.filter((s) => !routes.has(s) && !routes.has(s + '/'));
if (badSlugs.length) console.log('BAD SIDEBAR SLUGS:', badSlugs);
else console.log('sidebar slugs OK:', slugs.length);

const redirRe = /'(\/[^']*)':\s*'(\/[^']*)'/g;
const badRedirects = [];
for (const m of cfg.matchAll(redirRe)) {
  const target = m[2].replace(/^\//, '').replace(/\/$/, '');
  if (!routes.has(target) && !routes.has(target + '/')) badRedirects.push(m[1] + ' -> ' + m[2]);
}
if (badRedirects.length) console.log('BAD REDIRECT TARGETS:', badRedirects);
else console.log('redirect targets OK');

// internal links
const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\((\/[^)#?\s]*)/g)) {
      const target = m[1].replace(/^\//, '').replace(/\/$/, '');
      if (target === '') continue;
      if (/\.(png|jpg|jpeg|svg|webp|gif|mp4|json|txt|mjs|html)$/.test(target)) continue;
      if (!routes.has(target) && !routes.has(target + '/')) {
        bad.push(`${rel}:${i + 1} -> ${m[1]}`);
      }
    }
  });
}
console.log('internal links checked. bad:', bad.length);
for (const b of bad) console.log('  ' + b);

// frontmatter title/description
const missing = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { missing.push(`${rel}: no frontmatter`); continue; }
  if (!/^title:/m.test(m[1])) missing.push(`${rel}: no title`);
  if (!/^description:/m.test(m[1])) missing.push(`${rel}: no description`);
}
console.log('frontmatter issues:', missing.length);
for (const x of missing) console.log('  ' + x);

// MDX component imports
const noImport = [];
for (const f of files.filter((x) => x.endsWith('.mdx'))) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f).replace(/\\/g, '/');
  for (const comp of ['Aside', 'Card', 'CardGrid', 'Tabs', 'TabItem', 'Steps', 'LinkCard', 'Badge', 'Icon', 'FileTree', 'Code']) {
    const used = new RegExp(`<${comp}[\\s>/]`).test(src);
    if (!used) continue;
    const imported = new RegExp(`import[^;]*\\b${comp}\\b`).test(src);
    if (!imported) noImport.push(`${rel}: uses <${comp}> without import`);
  }
}
console.log('component import issues:', noImport.length);
for (const x of noImport) console.log('  ' + x);
