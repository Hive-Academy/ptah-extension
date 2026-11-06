import {
  CodexChatAdapterError,
  SdkError,
  SessionAdmissionRefusedError,
} from '@ptah-extension/agent-sdk';
import { classifyParentSendFailure } from './parent-send-failure.classifier';

const healthy = { adapterAvailable: true, parentActive: true, parentFrozen: false };

class ChatRuntimeAdmissionError extends Error {
  readonly code = 'runtime-admission-mismatch';
  constructor() {
    super('mismatch');
    this.name = 'ChatRuntimeAdmissionError';
  }
}

describe('classifyParentSendFailure', () => {
  it.each([
    ['no adapter', { ...healthy, adapterAvailable: false }],
    ['inactive parent', { ...healthy, parentActive: false }],
    ['frozen parent', { ...healthy, parentFrozen: true }],
  ])('treats a failed pre-call check (%s) as not-accepted', (_label, context) => {
    expect(classifyParentSendFailure(new Error('timeout'), context)).toBe('not-accepted');
  });

  it.each([
    ['admission refusal', new SessionAdmissionRefusedError('busy', 'session-1')],
    ['routing admission mismatch', new ChatRuntimeAdmissionError()],
    ['codex unknown session', new CodexChatAdapterError('unavailable', 'session')],
    ['codex invalid options', new CodexChatAdapterError('runtime-failed', 'messageOptions')],
    ['sdk unknown session', new SdkError('Session not found: session-1')],
  ])('treats a named pre-enqueue error (%s) as not-accepted', (_label, error) => {
    expect(classifyParentSendFailure(error, healthy)).toBe('not-accepted');
  });

  it.each([
    ['timeout', new Error('timed out')],
    ['codex runtime failure after send', new CodexChatAdapterError('runtime-failed', 'turn')],
    ['generic sdk error', new SdkError('stream closed')],
    ['non-error throw', 'boom'],
  ])('treats everything else (%s) as uncertain', (_label, error) => {
    expect(classifyParentSendFailure(error, healthy)).toBe('uncertain');
  });

  it('classifies without context by error type alone', () => {
    expect(classifyParentSendFailure(new Error('x'))).toBe('uncertain');
  });
});
