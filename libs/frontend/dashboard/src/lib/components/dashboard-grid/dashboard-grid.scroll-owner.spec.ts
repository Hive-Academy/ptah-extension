/**
 * The dashboard owns its own scroll container.
 *
 * This is the other half of `app-shell.outlet-wrapper.spec.ts`. That spec
 * asserts the shared router-outlet wrapper does NOT carry `overflow-y-auto`;
 * this one asserts the single surface that genuinely needs one still has it.
 * Without both, removing the wrapper's scroll container would silently stop
 * the analytics surface scrolling — the content would overflow with no way to
 * reach it, and no test would notice.
 *
 * It has to be the HOST. The template root is `min-h-full`, which grows past
 * its parent rather than scrolling, so the scroll container must be a
 * height-bounded ancestor of it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolved from the Jest working directory (the workspace root) rather than
 * `__dirname`, which `jest-preset-angular` does not point at the source tree.
 * The `existsSync` guard is deliberate: without it a moved file would make
 * these assertions pass vacuously against empty content.
 */
const DIR = join(
  process.cwd(),
  'libs/frontend/dashboard/src/lib/components/dashboard-grid',
);
const COMPONENT = join(DIR, 'dashboard-grid.component.ts');
const TEMPLATE = join(DIR, 'dashboard-grid.component.html');

describe('dashboard-grid scroll ownership (TASK_2026_524 risk 1)', () => {
  it('reads the real component and template', () => {
    expect(existsSync(COMPONENT)).toBe(true);
    expect(existsSync(TEMPLATE)).toBe(true);
  });

  it('its content is designed to exceed the viewport', () => {
    const html = readFileSync(TEMPLATE, 'utf8');

    // `min-h-full`, not `h-full`: this is why the surface needs to scroll at
    // all, and why the scroll container cannot live on this element.
    expect(html).toContain('min-h-full');
  });

  it('carries the scroll container on its host, not on a shared wrapper', () => {
    const source = readFileSync(COMPONENT, 'utf8');
    const host = /host:\s*\{([^}]*)\}/.exec(source);

    expect(host).not.toBeNull();
    expect(host?.[1]).toContain('h-full');
    expect(host?.[1]).toContain('overflow-y-auto');
  });
});
