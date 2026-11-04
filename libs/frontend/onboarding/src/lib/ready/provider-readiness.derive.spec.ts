import type { ClaudeAmbientStatusView, CodexReadinessView, ProvidersSettingsSection } from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';
import {
  deriveClaudeReadiness, deriveCodexReadiness, deriveSelection, deriveChosen,
} from './provider-readiness.derive';

const row: CliDetectionResult = {
  cli: 'claude', installed: true, path: '/bin/claude', version: '2.1.0', messagingMode: 'none',
};
const detection: ProvidersSettingsSection<readonly CliDetectionResult[]> = {
  status: 'ready', data: [row], error: null,
};
const ambient = (result: ClaudeAmbientStatusView['result'],
  extra: Partial<ClaudeAmbientStatusView> = {}): ClaudeAmbientStatusView =>
  ({ status: 'ready', result, localFailure: false, transportTimeout: false, ...extra });
const codex = (result: CodexReadinessView['result'],
  extra: Partial<CodexReadinessView> = {}): CodexReadinessView =>
  ({ status: 'ready', result, localFailure: false, transportTimeout: false, ...extra });
const found = { state: 'found' as const, path: '/bin/codex', version: '1.0', source: 'bundled' as const };
const response = (outcome: 'signed-in' | 'signed-out' | 'stale' | 'timeout' | 'unreadable') =>
  ({ binary: found, signIn: { outcome }, checkedAt: '2026-01-01T00:00:00.000Z' });

describe('provider readiness derivation', () => {
  it.each([
    ['unloaded', { ...detection, status: 'unloaded' as const, data: null }, ambient({ state: 'connected', checkedAt: null }), 'checking'],
    ['loading', { ...detection, status: 'loading' as const, data: null }, ambient({ state: 'connected', checkedAt: null }), 'checking'],
    ['missing', { ...detection, data: [{ ...row, installed: false }] }, ambient({ state: 'connected', checkedAt: null }), 'missing'],
    ['ready', detection, ambient({ state: 'connected', checkedAt: null }), 'ready'],
    ['signed-out', detection, ambient({ state: 'signed-out', checkedAt: null }), 'signed-out'],
    ['timeout', detection, ambient({ state: 'unknown', reason: 'timeout', checkedAt: null }), 'error'],
    ['unreadable', detection, ambient({ state: 'unknown', reason: 'unreadable', checkedAt: null }), 'error'],
  ] as const)('derives Claude %s', (_label, rows, status, expected) => {
    expect(deriveClaudeReadiness({ detection: rows, ambient: status }).state).toBe(expected);
  });

  it('preserves Claude installed facts on auth failure and marks pending timeout slow', () => {
    const status = ambient({ state: 'unknown', reason: 'timeout', checkedAt: null });
    expect(deriveClaudeReadiness({ detection, ambient: status, retrying: true })).toMatchObject({
      state: 'slow', path: '/bin/claude', version: '2.1.0',
    });
  });

  it.each([
    ['uninstalled row with ambient timeout', { ...detection, data: [{ ...row, installed: false }] }, ambient({ state: 'unknown', reason: 'timeout', checkedAt: null })],
    ['uninstalled row with local failure', { ...detection, data: [{ ...row, installed: false }] }, ambient(null, { localFailure: true })],
    ['ambient cli-missing with detection error', { status: 'error' as const, data: null, error: 'Could not load this section. Retry.' as const }, ambient({ state: 'unknown', reason: 'cli-missing', checkedAt: null })],
  ])('(parity row 2) missing wins over error: %s', (_label, rows, status) => {
    expect(deriveClaudeReadiness({ detection: rows, ambient: status })).toMatchObject({
      state: 'missing', errorCause: null,
    });
  });

  it('(parity row 2) detection error gives a local error even when ambient is connected', () => {
    expect(deriveClaudeReadiness({
      detection: { status: 'error', data: null, error: 'Could not load this section. Retry.' },
      ambient: ambient({ state: 'connected', checkedAt: null }),
    })).toMatchObject({ state: 'error', errorCause: 'local', failedFact: 'binary' });
  });

  it('(parity row 2) absent Claude row gives a local error', () => {
    expect(deriveClaudeReadiness({
      detection: { ...detection, data: [] },
      ambient: ambient({ state: 'connected', checkedAt: null }),
    })).toMatchObject({ state: 'error', errorCause: 'local', failedFact: 'binary' });
  });

  it('(parity row 2) ambient local failure gives a local error', () => {
    expect(deriveClaudeReadiness({
      detection, ambient: ambient(null, { localFailure: true }),
    })).toMatchObject({ state: 'error', errorCause: 'local', failedFact: 'sign-in' });
  });

  it.each([
    ['signed-in', 'ready'], ['signed-out', 'signed-out'], ['stale', 'stale'],
    ['timeout', 'error'], ['unreadable', 'error'],
  ] as const)('derives Codex %s', (outcome, expected) => {
    expect(deriveCodexReadiness(codex(response(outcome)))).toMatchObject({
      state: expected, path: '/bin/codex', version: '1.0', source: 'bundled',
    });
  });

  it('distinguishes Codex binary missing, binary unknown and transport timeout', () => {
    expect(deriveCodexReadiness(codex({ ...response('signed-in'), binary: { state: 'missing' } })).state)
      .toBe('missing');
    expect(deriveCodexReadiness(codex({ ...response('signed-in'), binary: { state: 'unknown', reason: 'local' } })))
      .toMatchObject({ state: 'error', failedFact: 'binary', errorCause: 'local' });
    expect(deriveCodexReadiness(codex(null, { transportTimeout: true }), true)).toMatchObject({
      state: 'slow', failedFact: 'sign-in',
    });
  });

  it('derives selection and chosen provider without consulting the other provider', () => {
    const base = { isLoading: false, isLoaded: true, authMethod: 'thirdParty',
      providerId: 'openai-codex', availableProviders: [] };
    const selection = deriveSelection(base);
    expect(selection).toEqual({ kind: 'openai-codex' });
    expect(deriveChosen(selection,
      deriveClaudeReadiness({ detection, ambient: ambient(null, { localFailure: true }) }),
      deriveCodexReadiness(codex(response('signed-in')))).readiness?.state).toBe('ready');
    expect(deriveSelection({ ...base, isLoaded: false, isLoading: true })).toEqual({ kind: 'loading' });
    expect(deriveSelection({ ...base, isLoaded: false })).toEqual({ kind: 'unreadable' });
    expect(deriveSelection({ ...base, authMethod: 'apiKey' })).toEqual({
      kind: 'other', name: 'Anthropic API key',
    });
  });
});
