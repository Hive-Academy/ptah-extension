import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const roles = ['chrome', 'bar', 'overlay', 'content', 'tile', 'plate'] as const;
const root = join(__dirname, '..', '..', '..', '..');
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

function templateFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return templateFiles(path);
    return /\.(html|component\.ts)$/.test(entry.name) ? [path] : [];
  });
}

describe('glass surface roles', () => {
  it('styles every approved role', () => {
    for (const role of roles) expect(css).toContain(`[data-glass-surface='${role}']`);
    const defined = new Set([...css.matchAll(/data-glass-surface='([^']+)'/g)].map((match) => match[1]));
    expect([...defined].sort()).toEqual([...roles].sort());
  });

  it('uses only approved role names in component templates', () => {
    const seen = new Set<string>();
    for (const area of ['apps/ptah-extension-webview/src', 'libs/frontend']) {
      for (const file of templateFiles(join(root, area))) {
        const content = readFileSync(file, 'utf8');
        for (const [, role] of content.matchAll(/data-glass-surface=["']([^"']+)["']/g)) seen.add(role);
      }
    }
    expect([...seen].filter((role) => !roles.includes(role as typeof roles[number]))).toEqual([]);
  });
});
