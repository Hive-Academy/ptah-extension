import 'reflect-metadata';
import { describe, it, expect } from '@jest/globals';
import { AgentGenerationError } from './agent-generation.error';
import { ContentGenerationError } from './generation.error';
import { TemplateError } from './template.error';

describe('AgentGenerationError', () => {
  it('constructs with message, code, and context', () => {
    const err = new AgentGenerationError('boom', 'UNKNOWN_ERROR', { extra: 1 });
    expect(err.message).toBe('boom');
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.context).toEqual({ extra: 1 });
    expect(err.name).toBe('AgentGenerationError');
    expect(err).toBeInstanceOf(AgentGenerationError);
    expect(err).toBeInstanceOf(Error);
  });

  it('constructs without context (context is undefined)', () => {
    const err = new AgentGenerationError('bare', 'CANCELLED');
    expect(err.context).toBeUndefined();
    expect(err.code).toBe('CANCELLED');
  });

  describe('fromError', () => {
    it('returns the same instance when passed an AgentGenerationError', () => {
      const original = new AgentGenerationError('orig', 'LLM_ERROR');
      const result = AgentGenerationError.fromError(original, 'UNKNOWN_ERROR');
      expect(result).toBe(original);
      expect(result.code).toBe('LLM_ERROR');
    });

    it('wraps a regular Error and uses its message', () => {
      const native = new Error('native message');
      const result = AgentGenerationError.fromError(native, 'FILE_WRITE_ERROR');
      expect(result).toBeInstanceOf(AgentGenerationError);
      expect(result.message).toBe('native message');
      expect(result.code).toBe('FILE_WRITE_ERROR');
    });

    it('stringifies non-Error values (string)', () => {
      const result = AgentGenerationError.fromError(
        'plain string',
        'VALIDATION_ERROR',
      );
      expect(result).toBeInstanceOf(AgentGenerationError);
      expect(result.message).toBe('plain string');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('stringifies non-Error values (number)', () => {
      const result = AgentGenerationError.fromError(42, 'UNKNOWN_ERROR');
      expect(result.message).toBe('42');
    });

    it('stringifies non-Error values (null)', () => {
      const result = AgentGenerationError.fromError(null, 'UNKNOWN_ERROR');
      expect(result.message).toBe('null');
    });

    it('stringifies non-Error values (object)', () => {
      const result = AgentGenerationError.fromError(
        { kind: 'weird' },
        'UNKNOWN_ERROR',
      );
      expect(result.message).toContain('object');
    });
  });
});

describe('ContentGenerationError', () => {
  it('sets phase and agentName, augments context', () => {
    const err = new ContentGenerationError('bad', 'llm', 'agent-1', {
      hint: 'retry',
    });
    expect(err.message).toBe('bad');
    expect(err.phase).toBe('llm');
    expect(err.agentName).toBe('agent-1');
    expect(err.code).toBe('GENERATION_FAILED');
    expect(err.name).toBe('ContentGenerationError');
    expect(err.context).toEqual({
      hint: 'retry',
      phase: 'llm',
      agentName: 'agent-1',
    });
    expect(err).toBeInstanceOf(ContentGenerationError);
    expect(err).toBeInstanceOf(AgentGenerationError);
  });

  it('works without agentName or context', () => {
    const err = new ContentGenerationError('bare', 'template');
    expect(err.phase).toBe('template');
    expect(err.agentName).toBeUndefined();
    expect(err.context).toEqual({ phase: 'template', agentName: undefined });
  });

  it.each(['template', 'content', 'llm', 'file'] as const)(
    'accepts phase: %s',
    (phase) => {
      const err = new ContentGenerationError('m', phase);
      expect(err.phase).toBe(phase);
    },
  );
});

describe('TemplateError', () => {
  it('defaults code to TEMPLATE_PARSE_ERROR when none provided', () => {
    const err = new TemplateError('bad template', 'tpl-1');
    expect(err.code).toBe('TEMPLATE_PARSE_ERROR');
    expect(err.templateId).toBe('tpl-1');
    expect(err.name).toBe('TemplateError');
    expect(err.context).toEqual({ templateId: 'tpl-1' });
    expect(err).toBeInstanceOf(TemplateError);
    expect(err).toBeInstanceOf(AgentGenerationError);
  });

  it('uses provided code (exercises the default-arg branch)', () => {
    const err = new TemplateError('missing', 'tpl-2', 'TEMPLATE_NOT_FOUND');
    expect(err.code).toBe('TEMPLATE_NOT_FOUND');
    expect(err.templateId).toBe('tpl-2');
  });

  it('merges provided context with templateId', () => {
    const err = new TemplateError(
      'invalid',
      'tpl-3',
      'TEMPLATE_VALIDATION_ERROR',
      {
        field: 'name',
      },
    );
    expect(err.context).toEqual({ field: 'name', templateId: 'tpl-3' });
    expect(err.code).toBe('TEMPLATE_VALIDATION_ERROR');
  });
});
