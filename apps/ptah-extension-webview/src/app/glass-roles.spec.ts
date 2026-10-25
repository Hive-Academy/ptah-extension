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
  it('blurs glass panes on ::after so the pane is not a fixed containing block', () => {
    const elementRule =
      /:root\[data-glass='on'\] :is\(\[data-glass-surface='chrome'\], \[data-glass-surface='bar'\]\),\s*:root\[data-glass='on'\] \[data-glass-surface='overlay'\],\s*:root\[data-glass='on'\] :is\(\.modal-box, \.dropdown-content\) \{[^}]*\}/;
    const element = elementRule.exec(css)?.[0] ?? '';
    expect(element).not.toMatch(/backdrop-filter/);
    expect(element).toMatch(/background:\s*transparent/);
    expect(css).toMatch(
      /\[data-glass-surface='chrome'\], \[data-glass-surface='bar'\]\)::after[\s\S]*?backdrop-filter:\s*var\(--glass-filter\)/,
    );
    expect(css).toMatch(
      /:root\[data-glass='on'\] :has\(> \[data-glass-surface='content'\]:has\(\.popover-panel\)\)/,
    );
  });

  it('styles every approved role', () => {
    for (const role of roles) expect(css).toContain(`[data-glass-surface='${role}']`);
    const defined = new Set([...css.matchAll(/data-glass-surface='([^']+)'/g)].map((match) => match[1]));
    expect([...defined].sort()).toEqual([...roles].sort());
  });

  it('clears shell canvases only, and insets assistant answer cards like chat bubbles', () => {
    expect(css).not.toMatch(
      /:root\[data-glass='on'\] :is\(\.bg-base-100, \.bg-surface-0, \.bg-surface-1\) \{\s*background-color:\s*transparent/,
    );
    expect(css).toMatch(/\.electron-shell-root/);
    expect(css).toMatch(/ptah-app-shell > \.bg-surface-0/);
    expect(css).toMatch(/ptah-marketplace-shell > \.bg-surface-0/);
    expect(css).toMatch(/ptah-thoth-shell > \.bg-surface-0/);
    // The app root <main>, the Electron welcome root and the orchestra canvas
    // root are root planes: they sit in the same clear list, so the tinted
    // scene shows on every screen.
    const clearList =
      /:root\[data-glass='on'\] :is\(([^)]*)\) \{ background-color: transparent; \}/.exec(css)?.[1] ?? '';
    const cleared = clearList.split(',').map((item) => item.trim());
    expect(cleared).toEqual(
      expect.arrayContaining([
        '.electron-shell-root',
        'ptah-root > main',
        'ptah-electron-welcome > .bg-base-100',
        'ptah-orchestra-canvas > .bg-base-100',
        'ptah-app-shell > .bg-surface-0',
      ]),
    );
    expect(css).toMatch(
      /\.cs-answer\[data-glass-surface='content'\] \{[^}]*padding:\s*var\(--sidebar-spacing-sm\) var\(--sidebar-spacing-md\)/,
    );
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
