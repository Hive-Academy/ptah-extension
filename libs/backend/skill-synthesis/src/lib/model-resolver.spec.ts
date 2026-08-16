/**
 * `resolveJudgeModel` — what "inherit" inherits (TASK_2026_250).
 *
 * Two contracts, and the first is the reason this file exists:
 *
 *  1. **Inherit reads the ACTIVE PROVIDER'S selected model, never a key that
 *     belongs to another provider family.** This function is only reached on
 *     the lane branch that rides the user's active chat provider, so the only
 *     model id known to be servable is the one that provider is already
 *     serving. It read `llm.vscode.model` — the VS Code Language Model
 *     `vendor/family` selector, whose consumer was deleted in `096930b51` —
 *     and handed that shape verbatim to an Anthropic-shaped endpoint.
 *  2. **Nothing configured anywhere still returns `JUDGE_DEFAULT_MODEL_ID`.**
 *     That is a decision, not an accident (Decision 1), and it is what
 *     `lane-resolver.service.spec.ts:116` pins from the lane side.
 *
 * The provider cases are generated from `ANTHROPIC_PROVIDERS` for the same
 * reason `lane-resolver.providers.spec.ts` is: a provider added to the registry
 * tomorrow is covered the day it lands, and this file names no vendor by hand.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { ANTHROPIC_PROVIDERS } from '@ptah-extension/shared';
import { JUDGE_DEFAULT_MODEL_ID } from './types';
import { resolveJudgeModel } from './model-resolver';

const PROVIDER_IDS = ANTHROPIC_PROVIDERS.map((p) => p.id);

/** The dead cross-family key, and a value of the shape it actually held. */
const VSCODE_LM_KEY = 'llm.vscode.model';
const VSCODE_LM_VALUE = 'some-vendor/some-family';

function makeWorkspace(stored: Record<string, unknown> = {}): {
  ws: IWorkspaceProvider;
  getConfiguration: jest.Mock;
} {
  const getConfiguration = jest.fn(
    (_section: string, key: string, fallback?: unknown) =>
      Object.prototype.hasOwnProperty.call(stored, key)
        ? stored[key]
        : fallback,
  );
  return {
    ws: { getConfiguration } as unknown as IWorkspaceProvider,
    getConfiguration,
  };
}

describe('resolveJudgeModel — an explicit judgeModel is never touched', () => {
  it('returns any non-inherit value as-is, reading no settings at all', () => {
    const { ws, getConfiguration } = makeWorkspace({
      'provider.apiKey.selectedModel': 'active-chat-model',
    });
    expect(resolveJudgeModel('some-explicit-model', ws)).toBe(
      'some-explicit-model',
    );
    expect(getConfiguration).not.toHaveBeenCalled();
  });
});

describe('resolveJudgeModel — inherit reads the active provider s model', () => {
  it('reads provider.apiKey.selectedModel under the default auth method', () => {
    // `authMethod` unset ⇒ 'apiKey', which is `AUTH_METHOD_DEF.default`.
    const { ws } = makeWorkspace({
      'provider.apiKey.selectedModel': 'active-chat-model',
    });
    expect(resolveJudgeModel('inherit', ws)).toBe('active-chat-model');
  });

  it('reads the auth method the user actually configured', () => {
    const { ws } = makeWorkspace({
      authMethod: 'claudeCli',
      'provider.claudeCli.selectedModel': 'cli-chat-model',
      // The apiKey slot is populated too: picking it would look correct on an
      // install that never left the default auth method.
      'provider.apiKey.selectedModel': 'WRONG-SLOT',
    });
    expect(resolveJudgeModel('inherit', ws)).toBe('cli-chat-model');
  });

  it.each(PROVIDER_IDS)(
    'reads provider.thirdParty.%s.selectedModel when that provider is active',
    (id) => {
      const { ws } = makeWorkspace({
        authMethod: 'thirdParty',
        anthropicProviderId: id,
        [`provider.thirdParty.${id}.selectedModel`]: `${id}-chat-model`,
      });
      expect(resolveJudgeModel('inherit', ws)).toBe(`${id}-chat-model`);
    },
  );

  it('is parameterized over a non-empty registry', () => {
    // Guards against the `it.each` above silently generating zero cases.
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
  });

  it('trims a stored model, so whitespace is not a model id', () => {
    const { ws } = makeWorkspace({
      'provider.apiKey.selectedModel': '   ',
    });
    expect(resolveJudgeModel('inherit', ws)).toBe(JUDGE_DEFAULT_MODEL_ID);
  });
});

describe('resolveJudgeModel — the cross-family key is not consulted', () => {
  it('ignores llm.vscode.model entirely', () => {
    // Its value is a `vendor/family` selector for `vscode.lm.selectChatModels`.
    // `ModelResolver.resolve` matches neither the `claude-` prefix nor a tier
    // alias for that shape and returns it unchanged, so it would reach an
    // Anthropic-shaped endpoint verbatim.
    const { ws, getConfiguration } = makeWorkspace({
      [VSCODE_LM_KEY]: VSCODE_LM_VALUE,
    });

    expect(resolveJudgeModel('inherit', ws)).toBe(JUDGE_DEFAULT_MODEL_ID);

    const keysRead = getConfiguration.mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(keysRead).not.toContain(VSCODE_LM_KEY);
  });

  it('prefers the active provider s model over a stale llm.vscode.model', () => {
    const { ws } = makeWorkspace({
      [VSCODE_LM_KEY]: VSCODE_LM_VALUE,
      'provider.apiKey.selectedModel': 'active-chat-model',
    });
    expect(resolveJudgeModel('inherit', ws)).toBe('active-chat-model');
  });
});

describe('resolveJudgeModel — the shipped default (Decision 1)', () => {
  it('returns the pinned JUDGE_DEFAULT_MODEL_ID when nothing is configured', () => {
    // Deliberate divergence from the memory curator's bare tier alias: on this
    // branch the call rides the ambient chat auth env, where `ModelResolver`
    // remaps a `claude-*` id through ANTHROPIC_DEFAULT_<TIER>_MODEL.
    expect(resolveJudgeModel('inherit', makeWorkspace().ws)).toBe(
      JUDGE_DEFAULT_MODEL_ID,
    );
  });

  it('returns it for an empty selected model — "" means use the provider default', () => {
    const { ws } = makeWorkspace({ 'provider.apiKey.selectedModel': '' });
    expect(resolveJudgeModel('inherit', ws)).toBe(JUDGE_DEFAULT_MODEL_ID);
  });

  it('returns it rather than throwing when the settings read fails', () => {
    const ws = {
      getConfiguration: jest.fn(() => {
        throw new Error('settings store unavailable');
      }),
    } as unknown as IWorkspaceProvider;
    expect(resolveJudgeModel('inherit', ws)).toBe(JUDGE_DEFAULT_MODEL_ID);
  });
});

describe('resolveJudgeModel — never shadows the host s registered defaults', () => {
  it('passes NO defaultValue on any settings read', () => {
    // `PtahFileSettingsManager.get` prefers a caller-supplied default over the
    // registered FILE_BASED_SETTINGS_DEFAULTS entry, so a `''` argument here
    // would silently override the host's own value for `authMethod` /
    // `anthropicProviderId` and make this path disagree with the chat path
    // about which provider is active. `toBeUndefined()` on the third argument
    // is the whole assertion.
    const { ws, getConfiguration } = makeWorkspace();
    resolveJudgeModel('inherit', ws);

    expect(getConfiguration.mock.calls.length).toBeGreaterThan(0);
    for (const call of getConfiguration.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
  });
});
