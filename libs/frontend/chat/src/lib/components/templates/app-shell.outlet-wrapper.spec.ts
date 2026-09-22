/**
 * The shared router-outlet wrapper must not impose a scroll container.
 *
 * TASK_2026_524 batch 1 replaced nine `@case` blocks with one `<router-outlet />`.
 * Each block had carried its own sizing box: eight were `h-full w-full` with no
 * overflow, and only the dashboard's added `overflow-y-auto`. Collapsing them
 * onto one wrapper moved that scroll container onto all nine, handing a
 * scrollbar to eight surfaces that had never had one. The author recorded the
 * hazard as risk 1 of `implementation-note.md:312-318` and asked for a
 * click-through that never happened, so it merged behind eight green checks —
 * nothing in any suite asserted overflow.
 *
 * These are source assertions rather than rendered ones on purpose. The other
 * `app-shell.*.spec.ts` files use `TestBed.overrideComponent` to swap out the
 * 700-line template, so a rendered assertion would be checking the stub. The
 * property worth pinning belongs to the real template, so the real template is
 * what is read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolved from the Jest working directory (the project root) rather than
 * `__dirname`, which `jest-preset-angular` does not point at the source tree.
 * The `existsSync` guard is deliberate: without it a moved file would make
 * these assertions pass vacuously against empty content.
 */
const SHELL_TEMPLATE = join(
  process.cwd(),
  'libs/frontend/chat/src/lib/components/templates/app-shell.component.html',
);

/**
 * The wrapper div: the element that carries `[class.hidden]="!isStandaloneView()"`
 * and contains `<router-outlet />`.
 */
function outletWrapperTag(source: string): string {
  // Comments are stripped first because the prose above the wrapper quotes
  // `<router-outlet />` when explaining the element. Scanning the raw source
  // matches that quotation instead of the real tag.
  const html = source.replace(/<!--[\s\S]*?-->/g, '');

  const outlet = html.indexOf('<router-outlet');
  expect(outlet).toBeGreaterThan(-1);

  const open = html.lastIndexOf('<div', outlet);
  expect(open).toBeGreaterThan(-1);

  const close = html.indexOf('>', open);
  expect(close).toBeGreaterThan(open);

  return html.slice(open, close + 1);
}

describe('app-shell router-outlet wrapper (TASK_2026_524 risk 1)', () => {
  it('reads the real shell template', () => {
    expect(existsSync(SHELL_TEMPLATE)).toBe(true);
  });

  const html = readFileSync(SHELL_TEMPLATE, 'utf8');

  it('wraps the outlet in the sizing box the nine @case blocks carried', () => {
    const tag = outletWrapperTag(html);

    expect(tag).toContain('h-full');
    expect(tag).toContain('w-full');
    expect(tag).toContain('[class.hidden]="!isStandaloneView()"');
  });

  it('does not impose a scroll container on every routed surface', () => {
    const tag = outletWrapperTag(html);

    // The regression: `overflow-y-auto` here gives all nine surfaces a scroll
    // container, when only the dashboard ever had one. A surface that needs to
    // scroll owns that on its own host — see `DashboardGridComponent`.
    expect(tag).not.toContain('overflow-y-auto');
    expect(tag).not.toContain('overflow-auto');
    expect(tag).not.toContain('overflow-scroll');
  });
});
