import 'reflect-metadata';
import { describe, it, expect } from '@jest/globals';
import {
  createInitialEnhancedPromptsState,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
} from './enhanced-prompts.types';

describe('createInitialEnhancedPromptsState', () => {
  it('returns the canonical empty state for a workspace path', () => {
    const state = createInitialEnhancedPromptsState('/tmp/workspace');
    expect(state).toEqual({
      enabled: false,
      generatedAt: null,
      generatedPrompt: null,
      detectedStack: null,
      configHash: null,
      workspacePath: '/tmp/workspace',
    });
  });

  it('preserves the workspace path string verbatim', () => {
    const state = createInitialEnhancedPromptsState('C:\\Users\\dev\\repo');
    expect(state.workspacePath).toBe('C:\\Users\\dev\\repo');
  });

  it('returns a fresh object on each call (no shared reference)', () => {
    const a = createInitialEnhancedPromptsState('/a');
    const b = createInitialEnhancedPromptsState('/b');
    expect(a).not.toBe(b);
    expect(a.workspacePath).toBe('/a');
    expect(b.workspacePath).toBe('/b');
  });
});

describe('DEFAULT_ENHANCED_PROMPTS_CONFIG', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_ENHANCED_PROMPTS_CONFIG).toEqual({
      includeStyleGuidelines: true,
      includeTerminology: true,
      includeArchitecturePatterns: true,
      includeTestingGuidelines: true,
      maxTokens: 4000,
    });
  });
});
