/**
 * Shared mock factories for settings-core typed accessors.
 *
 * Each factory returns a minimal stub that satisfies the structural type so
 * spec files can stay free of repetitive `as unknown as X` boilerplate.
 * Extend per-test by calling `.mockReturnValue(...)` on the `get` spy or
 * `.mockResolvedValue(...)` on the `set` spy.
 */

import type {
  ModelSettings,
  ReasoningSettings,
} from '@ptah-extension/settings-core';

/** Typed stub for the `ComputedSettingHandle<string>` surface tests need. */
interface MockSettingHandle {
  get: jest.Mock<string, []>;
  set: jest.Mock<Promise<void>, [string]>;
  watch: jest.Mock<{ dispose: jest.Mock }, []>;
}

export interface MockModelSettings {
  selectedModel: MockSettingHandle;
}

export interface MockReasoningSettings {
  effort: MockSettingHandle;
}

/**
 * Minimal stub for {@link ModelSettings}.
 *
 * `selectedModel.get` returns `''` by default (no model selected).
 * Override per-test: `mockModelSettings.selectedModel.get.mockReturnValue('claude-opus-4-7')`.
 */
export function createMockModelSettings(): MockModelSettings & ModelSettings {
  return {
    selectedModel: {
      get: jest.fn().mockReturnValue(''),
      set: jest.fn().mockResolvedValue(undefined),
      watch: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    },
  } as unknown as MockModelSettings & ModelSettings;
}

/**
 * Minimal stub for {@link ReasoningSettings}.
 *
 * `effort.get` returns `''` by default (no effort configured).
 * Override per-test: `mockReasoningSettings.effort.get.mockReturnValue('high')`.
 */
export function createMockReasoningSettings(): MockReasoningSettings &
  ReasoningSettings {
  return {
    effort: {
      get: jest.fn().mockReturnValue(''),
      set: jest.fn().mockResolvedValue(undefined),
      watch: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    },
  } as unknown as MockReasoningSettings & ReasoningSettings;
}
