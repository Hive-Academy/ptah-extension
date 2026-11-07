import {
  CodexChatAdapterError,
  SdkError,
  SessionAdmissionRefusedError,
} from '@ptah-extension/agent-sdk';

/** `not-accepted`: nothing reached the session, so a retry cannot duplicate it. */
export type ParentSendFailure = 'not-accepted' | 'uncertain';

/**
 * Only errors proved to be thrown before the adapter enqueues the message are
 * `not-accepted` (A6, checked against every `TOKENS.AGENT_ADAPTER` implementation):
 * - `SessionAdmissionRefusedError` (codex-chat-adapter, session-stream-pump admission);
 * - `ChatRuntimeAdmissionError` (routing-agent-adapter, not exported, matched by name and code);
 * - `CodexChatAdapterError` `unavailable`/`session` and `runtime-failed`/`messageOptions`;
 * - `SdkError` `Session not found: <id>` (session-stream-pump, before the turn is queued).
 * Everything else — timeouts, transport errors, unknown throws — is `uncertain`.
 *
 * The classification reads the error only. The parent's liveness after the throw proves
 * nothing about acceptance (the turn may be queued before the session ended); an inactive or
 * frozen parent is caught by the drainer's checks before the send.
 */
export function classifyParentSendFailure(error: unknown): ParentSendFailure {
  if (error instanceof SessionAdmissionRefusedError) return 'not-accepted';
  if (isChatRuntimeAdmissionError(error)) return 'not-accepted';
  if (error instanceof CodexChatAdapterError) return classifyCodexError(error);
  if (error instanceof SdkError && error.message.startsWith('Session not found: '))
    return 'not-accepted';
  return 'uncertain';
}

function classifyCodexError(error: CodexChatAdapterError): ParentSendFailure {
  if (error.code === 'unavailable' && error.operation === 'session') return 'not-accepted';
  if (error.code === 'runtime-failed' && error.operation === 'messageOptions')
    return 'not-accepted';
  return 'uncertain';
}

function isChatRuntimeAdmissionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ChatRuntimeAdmissionError' &&
    'code' in error && error.code === 'runtime-admission-mismatch';
}
