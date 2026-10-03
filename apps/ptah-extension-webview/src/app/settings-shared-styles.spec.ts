/**
 * TASK_2026_555 Batch 51: two shared Settings rules in styles.css.
 * - Table headers use the measured muted token (`--bcm`), not daisyUI's base-content at 60% alpha (4.45:1 on
 *   anubis-light). The token's own contrast is guarded by base-content-muted.spec.ts.
 * - A Settings `.btn` with `aria-disabled="true"` takes daisyUI's `.btn:disabled` look while staying focusable and
 *   clickable (no `pointer-events: none`); a non-`.btn` button is dimmed.
 * The browser side (computed style of a real aria-disabled button) is pinned by settings-orchestration.e2e.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

/** The declarations of the first rule whose selector list contains `selector`. */
function declarationsOf(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No rule for ${selector} in styles.css`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('Settings shared styles (Batch 51)', () => {
  it('table headers use the muted token, falling back to base-content', () => {
    expect(declarationsOf('.table :where(thead, tfoot)')).toContain('oklch(var(--bcm, var(--bc)))');
  });

  it('an aria-disabled Settings .btn copies daisyUI\'s disabled look and stays clickable', () => {
    const rule = declarationsOf(":where(ptah-settings) .btn[aria-disabled='true']");
    expect(rule).toContain('--tw-bg-opacity: 0.2');
    expect(rule).toContain('--tw-text-opacity: 0.2');
    expect(rule).toContain('--tw-border-opacity: 0');
    expect(rule).toContain('cursor: not-allowed');
    expect(rule).not.toContain('pointer-events');
  });

  it('an aria-disabled Settings field, select or checkbox (ptahBusyDisabled, Batch 54.1) is dimmed and stays usable for focus', () => {
    const rule = declarationsOf(":where(ptah-settings) :is(input, select, textarea)[aria-disabled='true']");
    expect(rule).toContain('opacity: 0.6');
    expect(rule).toContain('cursor: not-allowed');
    expect(rule).not.toContain('pointer-events');
  });

  it('a Settings checkbox, radio or toggle Tab ring is a solid full base-content outline (Batch 55b F1)', () => {
    const rule = declarationsOf(':where(ptah-settings) :is(.checkbox, .radio, .toggle):focus-visible');
    expect(rule).toContain('outline-style: solid');
    expect(rule).toContain('outline-width: 2px');
    expect(rule).toContain('outline-offset: 2px');
    expect(rule).toContain('outline-color: var(--fallback-bc, oklch(var(--bc) / 1))');
  });

  it('an aria-disabled Settings button that is not a .btn is dimmed', () => {
    const rule = declarationsOf(":where(ptah-settings) button[aria-disabled='true']:not(.btn)");
    expect(rule).toContain('opacity: 0.6');
    expect(rule).not.toContain('pointer-events');
  });
});
