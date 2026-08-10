/**
 * Flag-tier merge safety (TASK_2026_197 §3.3a, G4 + G4b).
 *
 * `Options.settings` is the SDK's FLAG tier. It is unconditionally enabled and
 * it OUTRANKS the user's own `~/.claude/settings.json`, which makes two
 * mistakes expensive and silent:
 *
 *  - mutating the shared `PTAH_DISABLE_SDK_AUTO_MEMORY` constant leaks one
 *    session's style into every later session (G4);
 *  - emitting an `outputStyle` key when Ptah has no opinion clobbers a style
 *    the user chose for their own Claude Code CLI usage (G4b).
 *
 * Both are asserted here against `buildFlagSettings`, the single place the
 * object is built, plus a wiring guard proving `build()` actually uses it.
 */

import 'reflect-metadata';

import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import {
  buildFlagSettings,
  assertSingleOutputStylePath,
} from './sdk-query-options-builder';
import { PTAH_DISABLE_SDK_AUTO_MEMORY } from '../constants';

const BUILDER_PATH = path.resolve(__dirname, 'sdk-query-options-builder.ts');

describe('buildFlagSettings — a style is active', () => {
  it('merges outputStyle over the auto-memory keys', () => {
    const settings = buildFlagSettings({ outputStyleName: 'Explanatory' });

    expect(settings).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
      outputStyle: 'Explanatory',
    });
  });

  it('keeps autoMemoryEnabled and autoDreamEnabled false (G4 part 1)', () => {
    const settings = buildFlagSettings({
      outputStyleName: 'Learning',
    }) as Record<string, unknown>;

    expect(settings['autoMemoryEnabled']).toBe(false);
    expect(settings['autoDreamEnabled']).toBe(false);
  });

  it('never mutates the shared constant (G4 part 2)', () => {
    const snapshot = { ...PTAH_DISABLE_SDK_AUTO_MEMORY };

    buildFlagSettings({ outputStyleName: 'Explanatory' });

    expect(PTAH_DISABLE_SDK_AUTO_MEMORY).toEqual(snapshot);
    expect(Object.keys(PTAH_DISABLE_SDK_AUTO_MEMORY)).toHaveLength(2);
    expect('outputStyle' in PTAH_DISABLE_SDK_AUTO_MEMORY).toBe(false);
  });

  it('returns a fresh object, not the shared constant', () => {
    const settings = buildFlagSettings({ outputStyleName: 'Explanatory' });

    expect(settings).not.toBe(PTAH_DISABLE_SDK_AUTO_MEMORY);
  });

  it('does not let two sessions contaminate each other', () => {
    const first = buildFlagSettings({ outputStyleName: 'Explanatory' });
    const second = buildFlagSettings({ outputStyleName: 'Learning' });

    expect((first as Record<string, unknown>)['outputStyle']).toBe(
      'Explanatory',
    );
    expect((second as Record<string, unknown>)['outputStyle']).toBe('Learning');
    expect(first).not.toBe(second);
  });

  it('trims the style name before sending it', () => {
    const settings = buildFlagSettings({
      outputStyleName: '  Proactive  ',
    }) as Record<string, unknown>;

    expect(settings['outputStyle']).toBe('Proactive');
  });
});

describe('buildFlagSettings — no style is active (G4b)', () => {
  it.each([
    ['undefined sessionConfig', undefined],
    ['no outputStyleName', {}],
    ['explicitly undefined name', { outputStyleName: undefined }],
    ['empty name', { outputStyleName: '' }],
    ['whitespace-only name', { outputStyleName: '   ' }],
  ])(
    'omits the outputStyle key entirely — %s',
    (_label, sessionConfig: { outputStyleName?: string } | undefined) => {
      const settings = buildFlagSettings(sessionConfig);

      // Absence, not `undefined` and not `'default'`. The flag tier outranks
      // the user's own settings.json, so a present key with any value is an
      // opinion Ptah has not been asked to have.
      expect('outputStyle' in settings).toBe(false);
      expect(settings).toEqual({
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
      });
    },
  );

  it('returns the shared constant unchanged when no style is active', () => {
    expect(buildFlagSettings(undefined)).toBe(PTAH_DISABLE_SDK_AUTO_MEMORY);
  });

  it('the shared constant is frozen, so an accidental mutation cannot silently succeed', () => {
    expect(Object.isFrozen(PTAH_DISABLE_SDK_AUTO_MEMORY)).toBe(true);
  });
});

describe('assertSingleOutputStylePath', () => {
  it('throws when both activation fields are set', () => {
    expect(() =>
      assertSingleOutputStylePath({
        outputStyleName: 'Explanatory',
        outputStyleBody: 'Answer tersely.',
      }),
    ).toThrow(/ambiguous/i);
  });

  it('is enforced on the settings build path, not only as a standalone helper', () => {
    expect(() =>
      buildFlagSettings({
        outputStyleName: 'Explanatory',
        outputStyleBody: 'Answer tersely.',
      }),
    ).toThrow(/ambiguous/i);
  });

  it.each([
    ['neither', {}],
    ['flag only', { outputStyleName: 'Explanatory' }],
    ['inject only', { outputStyleBody: 'Answer tersely.' }],
    ['undefined config', undefined],
  ])('accepts %s', (_label, sessionConfig) => {
    expect(() => assertSingleOutputStylePath(sessionConfig)).not.toThrow();
  });
});

/**
 * Wiring guard. The helper being correct is worthless if `build()` still hands
 * the SDK the bare constant, and that mistake is invisible to a unit test of
 * the helper. Building full options needs the whole DI graph, so the wiring is
 * asserted against the source — the same technique the activation resolver's
 * drift guard uses.
 */
describe('build() wiring', () => {
  it('passes options.settings through buildFlagSettings', () => {
    expect(existsSync(BUILDER_PATH)).toBe(true);
    const source = readFileSync(BUILDER_PATH, 'utf8');

    expect(source).toContain('settings: buildFlagSettings(sessionConfig)');
    // The bare reference is what this task replaced. If it reappears on the
    // options object, the flag tier stops carrying the style.
    expect(source).not.toContain('settings: PTAH_DISABLE_SDK_AUTO_MEMORY');
  });

  it('forwards the inject body into assembleSystemPrompt', () => {
    const source = readFileSync(BUILDER_PATH, 'utf8');

    expect(source).toContain('outputStyleBody: sessionConfig?.outputStyleBody');
  });
});
