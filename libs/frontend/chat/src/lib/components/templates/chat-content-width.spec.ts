/**
 * Regression spec for the shared chat column width cap
 * (`--chat-content-max-width`).
 *
 * The Electron canvas focus-area ancestor declares the cap (1100px, chat
 * layout declutter spec), and every chat consumer reads the variable with a
 * 758px fallback so non-canvas hosts keep the previous column width. The
 * session layout must not redeclare the variable: a host declaration would
 * override the inherited ancestor value and narrow the column again.
 *
 * jsdom cannot resolve inherited custom properties from component styles,
 * so these assertions read the sources, like the other template-level specs
 * in this folder.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WIDTH_RULES = [
  {
    file: 'chat-view.component.html',
    rule: 'max-width: var(--chat-content-max-width, 758px)',
  },
  {
    file: '../organisms/transcript/chat-transcript.component.css',
    rule: 'max-width: min(var(--chat-content-max-width, 758px), 100%)',
  },
  {
    file: '../molecules/chat-input/chat-input.component.css',
    rule: 'max-width: var(--chat-content-max-width, 758px)',
  },
  {
    // Tailwind arbitrary value: no space after the comma.
    file: '../molecules/execution-header/lane-column.ts',
    rule: 'min(var(--chat-content-max-width,758px),100%)',
  },
] as const;

describe('chat content width (--chat-content-max-width)', () => {
  it('keeps the session layout free of a variable declaration so the ancestor value inherits', () => {
    const source = readFileSync(
      join(__dirname, 'chat-session-layout.component.ts'),
      'utf8',
    );
    expect(source).not.toContain('--chat-content-max-width');
  });

  it('caps the controls row through the shared variable with a 758px fallback', () => {
    const template = readFileSync(
      join(__dirname, 'chat-view.component.html'),
      'utf8',
    );
    // Centered row, one 0.75rem gutter per side, capped with the fallback
    // for hosts such as session-embed that have no ancestor declaration.
    expect(template).toContain('var(--chat-content-max-width, 758px)');
    expect(template).toContain(
      '<div sessionControls class="mx-auto flex-shrink-0" style="width: calc(100% - 1.5rem);',
    );
  });

  it('keeps the 758px fallback in every width consumer', () => {
    for (const { file, rule } of WIDTH_RULES) {
      expect(readFileSync(join(__dirname, file), 'utf8')).toContain(rule);
    }
  });
});