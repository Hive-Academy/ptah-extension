import { FILE_BASED_SETTINGS_DEFAULTS } from '@ptah-extension/platform-core';
import {
  CODEX_DEFAULT_LANE_BUDGETS,
  resolveCodexLaneBudgets,
} from './codex-lane-budgets';

describe('CODEX_DEFAULT_LANE_BUDGETS', () => {
  it('equals the file-based settings defaults', () => {
    expect(CODEX_DEFAULT_LANE_BUDGETS).toEqual({
      autoCompactTokens:
        FILE_BASED_SETTINGS_DEFAULTS[
          'agentOrchestration.codexAutoCompactTokens'
        ],
      toolOutputTokenLimit:
        FILE_BASED_SETTINGS_DEFAULTS[
          'agentOrchestration.codexToolOutputTokenLimit'
        ],
      webSearch:
        FILE_BASED_SETTINGS_DEFAULTS['agentOrchestration.codexWebSearch'],
    });
  });
});

describe('resolveCodexLaneBudgets', () => {
  it('uses the defaults silently when nothing is passed', () => {
    expect(resolveCodexLaneBudgets(undefined)).toEqual({
      budgets: CODEX_DEFAULT_LANE_BUDGETS,
      warnings: [],
    });
    expect(resolveCodexLaneBudgets({})).toEqual({
      budgets: CODEX_DEFAULT_LANE_BUDGETS,
      warnings: [],
    });
  });

  it('keeps valid values, including 0 and false', () => {
    expect(
      resolveCodexLaneBudgets({
        autoCompactTokens: 0,
        toolOutputTokenLimit: 4000,
        webSearch: false,
      }),
    ).toEqual({
      budgets: {
        autoCompactTokens: 0,
        toolOutputTokenLimit: 4000,
        webSearch: false,
      },
      warnings: [],
    });
  });

  it('accepts MAX_SAFE_INTEGER', () => {
    const { budgets, warnings } = resolveCodexLaneBudgets({
      autoCompactTokens: Number.MAX_SAFE_INTEGER,
    });
    expect(budgets.autoCompactTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(warnings).toEqual([]);
  });

  it('reads -0 as 0, as agent:setConfig accepts it', () => {
    const { budgets, warnings } = resolveCodexLaneBudgets({
      toolOutputTokenLimit: -0,
    });
    expect(Object.is(budgets.toolOutputTokenLimit, 0)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['a negative value', -1],
    ['a fractional value', 1.5],
    ['a numeric string', '120000'],
    ['a value above MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1],
    ['1e21', 1e21],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('replaces %s with the default and names the key', (_label, value) => {
    const { budgets, warnings } = resolveCodexLaneBudgets({
      autoCompactTokens: value,
      toolOutputTokenLimit: value,
    });

    expect(budgets.autoCompactTokens).toBe(120000);
    expect(budgets.toolOutputTokenLimit).toBe(2500);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('agentOrchestration.codexAutoCompactTokens');
    expect(warnings[0]).toContain('using 120000');
    expect(warnings[1]).toContain(
      'agentOrchestration.codexToolOutputTokenLimit',
    );
    expect(warnings[1]).toContain('using 2500');
  });

  it.each([
    ['a string', 'false'],
    ['a number', 0],
    ['null', null],
  ])(
    'replaces a non-boolean web search (%s) with true and names the key',
    (_label, value) => {
      const { budgets, warnings } = resolveCodexLaneBudgets({
        webSearch: value,
      });

      expect(budgets.webSearch).toBe(true);
      expect(warnings).toEqual([
        expect.stringContaining('agentOrchestration.codexWebSearch'),
      ]);
    },
  );

  it('bounds the rendered value in the warning', () => {
    const { warnings } = resolveCodexLaneBudgets({
      autoCompactTokens: 'z'.repeat(5000),
    });
    expect(warnings[0].length).toBeLessThan(200);
  });
});
