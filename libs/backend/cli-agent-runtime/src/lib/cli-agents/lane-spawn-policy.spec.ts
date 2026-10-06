import {
  CODEX_LANE_DEFAULT_MODEL,
  findBlockedLaneModel,
  isReviewerOrTester,
  resolveLaneEffort,
  resolveLaneModel,
} from './lane-spawn-policy';

describe('lane spawn policy (TASK_2026_597, D4)', () => {
  describe('findBlockedLaneModel()', () => {
    it('matches the bare id and a provider-prefixed id, case-insensitively', () => {
      expect(findBlockedLaneModel('mimo-v2.6-flash-free')).toBe(
        'mimo-v2.6-flash-free',
      );
      expect(findBlockedLaneModel('opencode/mimo-v2.6-flash-free')).toBe(
        'mimo-v2.6-flash-free',
      );
      expect(findBlockedLaneModel('a/b/MiMo-V2.6-Flash-Free')).toBe(
        'mimo-v2.6-flash-free',
      );
    });

    it('does not match other models or an empty value', () => {
      expect(findBlockedLaneModel('gpt-6-sol')).toBeUndefined();
      expect(findBlockedLaneModel('mimo-v2.6-flash-free-x')).toBeUndefined();
      expect(
        findBlockedLaneModel('mimo-v2.6-flash-free/other'),
      ).toBeUndefined();
      expect(findBlockedLaneModel(undefined)).toBeUndefined();
      expect(findBlockedLaneModel('')).toBeUndefined();
    });
  });

  describe('resolveLaneModel()', () => {
    it('uses the spawn request first', () => {
      expect(resolveLaneModel('codex', 'gpt-requested', 'gpt-setting')).toEqual(
        { model: 'gpt-requested', source: 'request' },
      );
    });

    it('uses the per-CLI setting when the request names no model', () => {
      expect(resolveLaneModel('codex', undefined, 'gpt-setting')).toEqual({
        model: 'gpt-setting',
        source: 'setting',
      });
      expect(resolveLaneModel('codex', '', 'gpt-setting')).toEqual({
        model: 'gpt-setting',
        source: 'setting',
      });
    });

    it("falls back to Ptah's default for Codex only", () => {
      expect(CODEX_LANE_DEFAULT_MODEL).toBe('gpt-6-sol');
      expect(resolveLaneModel('codex', undefined, '')).toEqual({
        model: 'gpt-6-sol',
        source: 'ptah-default',
      });
    });

    it('leaves every other CLI on its own default', () => {
      expect(resolveLaneModel('copilot', undefined, undefined)).toEqual({
        model: undefined,
        source: 'cli-default',
      });
      expect(resolveLaneModel('ptah-cli', undefined, '')).toEqual({
        model: undefined,
        source: 'cli-default',
      });
    });

    it('passes the model string through unchanged', () => {
      expect(
        resolveLaneModel('antigravity', undefined, 'id\tDisplay name').model,
      ).toBe('id\tDisplay name');
    });
  });

  describe('isReviewerOrTester() (R2.4)', () => {
    it.each([
      ['code-logic-reviewer', true],
      ['code-style-reviewer', true],
      ['senior-tester', true],
      ['backend-developer', false],
      ['reviewer', false],
      ['senior-tester-2', false],
      [undefined, false],
    ])('%s -> %s', (roleName, expected) => {
      expect(isReviewerOrTester(roleName)).toBe(expected);
    });
  });

  describe('resolveLaneEffort() (R2.3)', () => {
    it('step 1: the spawn effort argument wins over everything', () => {
      expect(
        resolveLaneEffort({
          cli: 'codex',
          spawnEffort: 'low',
          setting: 'high',
          chatEffort: 'xhigh',
          roleName: 'code-logic-reviewer',
        }),
      ).toEqual({ effort: 'low', step: 1, ignored: [] });
    });

    it('step 2: a concrete setting wins over the chat effort', () => {
      expect(
        resolveLaneEffort({ cli: 'codex', setting: 'low', chatEffort: 'high' }),
      ).toEqual({ effort: 'low', step: 2, ignored: [] });
    });

    it('step 3: an inherit setting yields the chat effort', () => {
      expect(
        resolveLaneEffort({
          cli: 'copilot',
          setting: 'inherit',
          chatEffort: 'max',
          roleName: 'senior-tester',
        }),
      ).toEqual({ effort: 'xhigh', step: 3, ignored: [] });
    });

    it('step 4: an empty setting gives a reviewer medium', () => {
      expect(
        resolveLaneEffort({
          cli: 'codex',
          setting: '',
          chatEffort: 'xhigh',
          roleName: 'code-style-reviewer',
        }),
      ).toEqual({ effort: 'medium', step: 4, ignored: [] });
    });

    it('step 4: an empty setting gives a senior-tester medium', () => {
      expect(
        resolveLaneEffort({
          cli: 'codex',
          chatEffort: 'high',
          roleName: 'senior-tester',
        }),
      ).toEqual({ effort: 'medium', step: 4, ignored: [] });
    });

    it('step 5: an empty setting yields the chat effort for other roles', () => {
      expect(
        resolveLaneEffort({
          cli: 'codex',
          setting: '',
          chatEffort: 'high',
          roleName: 'backend-developer',
        }),
      ).toEqual({ effort: 'high', step: 5, ignored: [] });
      expect(resolveLaneEffort({ cli: 'codex', chatEffort: 'high' })).toEqual({
        effort: 'high',
        step: 5,
        ignored: [],
      });
    });

    it('step 6: nothing applies, so the CLI default is used', () => {
      expect(resolveLaneEffort({ cli: 'codex', setting: '' })).toEqual({
        effort: undefined,
        step: 6,
        ignored: [],
      });
    });

    it('step 6: a CLI whose effort Ptah does not resolve', () => {
      expect(
        resolveLaneEffort({
          cli: 'cursor',
          spawnEffort: 'high',
          chatEffort: 'high',
          roleName: 'senior-tester',
        }),
      ).toEqual({
        effort: undefined,
        step: 6,
        ignored: [{ step: 1, value: 'high' }],
      });
    });

    describe('unknown values are ignored at their step', () => {
      it('an unknown spawn effort falls to the setting', () => {
        expect(
          resolveLaneEffort({
            cli: 'codex',
            spawnEffort: 'turbo',
            setting: 'low',
          }),
        ).toEqual({
          effort: 'low',
          step: 2,
          ignored: [{ step: 1, value: 'turbo' }],
        });
      });

      it('an unknown setting counts as empty', () => {
        expect(
          resolveLaneEffort({
            cli: 'codex',
            setting: 'turbo',
            chatEffort: 'high',
          }),
        ).toEqual({
          effort: 'high',
          step: 5,
          ignored: [{ step: 2, value: 'turbo' }],
        });
        expect(
          resolveLaneEffort({
            cli: 'codex',
            setting: 'turbo',
            roleName: 'code-logic-reviewer',
          }),
        ).toEqual({
          effort: 'medium',
          step: 4,
          ignored: [{ step: 2, value: 'turbo' }],
        });
      });

      it('an unusable chat effort under inherit falls through', () => {
        expect(
          resolveLaneEffort({
            cli: 'codex',
            setting: 'inherit',
            chatEffort: 'turbo',
          }),
        ).toEqual({
          effort: undefined,
          step: 6,
          ignored: [{ step: 3, value: 'turbo' }],
        });
        expect(
          resolveLaneEffort({
            cli: 'codex',
            setting: 'inherit',
            roleName: 'senior-tester',
          }),
        ).toEqual({ effort: 'medium', step: 4, ignored: [] });
      });

      it('an unknown chat effort at step 5', () => {
        expect(
          resolveLaneEffort({ cli: 'copilot', chatEffort: 'turbo' }),
        ).toEqual({
          effort: undefined,
          step: 6,
          ignored: [{ step: 5, value: 'turbo' }],
        });
      });
    });

    describe('per-CLI mapping', () => {
      it("maps 'max' to 'xhigh' for Codex and Copilot", () => {
        expect(
          resolveLaneEffort({ cli: 'codex', spawnEffort: 'max' }).effort,
        ).toBe('xhigh');
      });

      it.each(['codex', 'copilot'] as const)(
        "maps 'minimal' to 'low' for %s (newer models reject 'minimal')",
        (cli) => {
          expect(
            resolveLaneEffort({ cli, spawnEffort: 'minimal' }).effort,
          ).toBe('low');
        },
      );

      it.each([
        ['minimal', 'low'],
        ['medium', 'medium'],
        ['xhigh', 'high'],
        ['max', 'high'],
      ])("clamps antigravity '%s' to '%s'", (chatEffort, expected) => {
        expect(resolveLaneEffort({ cli: 'antigravity', chatEffort })).toEqual({
          effort: expected,
          step: 5,
          ignored: [],
        });
      });

      it('gives antigravity steps 1 and 4 (it has no setting)', () => {
        expect(
          resolveLaneEffort({ cli: 'antigravity', spawnEffort: 'xhigh' }),
        ).toEqual({ effort: 'high', step: 1, ignored: [] });
        expect(
          resolveLaneEffort({
            cli: 'antigravity',
            chatEffort: 'high',
            roleName: 'code-logic-reviewer',
          }),
        ).toEqual({ effort: 'medium', step: 4, ignored: [] });
      });

      it.each([
        ['minimal', 'low'],
        ['low', 'low'],
        ['medium', 'medium'],
        ['high', 'high'],
        ['xhigh', 'xhigh'],
        ['max', 'xhigh'],
      ])("maps grok '%s' to '%s'", (spawnEffort, expected) => {
        expect(resolveLaneEffort({ cli: 'grok', spawnEffort })).toEqual({
          effort: expected,
          step: 1,
          ignored: [],
        });
      });

      it.each(['off', 'inherit', '', 'ultra'])(
        "gives grok no effort for '%s'",
        (value) => {
          expect(
            resolveLaneEffort({ cli: 'grok', spawnEffort: value }).effort,
          ).toBeUndefined();
        },
      );

      it('ignores an unknown grok spawn effort and falls back to the chat effort', () => {
        expect(
          resolveLaneEffort({
            cli: 'grok',
            spawnEffort: 'off',
            chatEffort: 'max',
          }),
        ).toEqual({
          effort: 'xhigh',
          step: 5,
          ignored: [{ step: 1, value: 'off' }],
        });
      });

      it('gives a grok reviewer medium at step 4', () => {
        expect(
          resolveLaneEffort({
            cli: 'grok',
            chatEffort: 'high',
            roleName: 'code-logic-reviewer',
          }),
        ).toEqual({ effort: 'medium', step: 4, ignored: [] });
      });

      it('passes pi levels through raw, including max and off', () => {
        expect(resolveLaneEffort({ cli: 'pi', setting: 'max' })).toEqual({
          effort: 'max',
          step: 2,
          ignored: [],
        });
        expect(
          resolveLaneEffort({ cli: 'pi', spawnEffort: 'off' }).effort,
        ).toBe('off');
      });

      it('never passes inherit to pi raw', () => {
        expect(
          resolveLaneEffort({
            cli: 'pi',
            setting: 'inherit',
            chatEffort: 'high',
          }),
        ).toEqual({ effort: 'high', step: 3, ignored: [] });
        expect(resolveLaneEffort({ cli: 'pi', setting: 'inherit' })).toEqual({
          effort: undefined,
          step: 6,
          ignored: [],
        });
        expect(
          resolveLaneEffort({ cli: 'pi', spawnEffort: 'inherit' }),
        ).toEqual({
          effort: undefined,
          step: 6,
          ignored: [{ step: 1, value: 'inherit' }],
        });
      });

      it('gives pi the chat effort when its setting is empty', () => {
        expect(resolveLaneEffort({ cli: 'pi', chatEffort: 'low' })).toEqual({
          effort: 'low',
          step: 5,
          ignored: [],
        });
      });
    });
  });
});
