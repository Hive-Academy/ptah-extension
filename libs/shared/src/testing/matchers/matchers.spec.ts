import { SessionId } from '../../lib/types/branded.types';
import { registerMatchers } from './index';

registerMatchers();

describe('toBeSessionId', () => {
  it('passes for a valid UUID-v4 SessionId', () => {
    expect(SessionId.create()).toBeSessionId();
  });

  it('fails for a non-UUID string', () => {
    expect('not-a-uuid').not.toBeSessionId();
  });

  it('fails for non-string values', () => {
    expect(42).not.toBeSessionId();
    expect(null).not.toBeSessionId();
  });
});

describe('toMatchRpcSuccess', () => {
  it('passes on a well-formed success envelope', () => {
    expect({
      success: true,
      data: { ok: 1 },
      correlationId: 'corr-1',
    }).toMatchRpcSuccess();
  });

  it('passes with expected data equality', () => {
    expect({
      success: true,
      data: { ok: 1 },
      correlationId: 'corr-1',
    }).toMatchRpcSuccess({ ok: 1 });
  });

  it('fails when success is false', () => {
    expect({
      success: false,
      error: 'boom',
      correlationId: 'corr-2',
    }).not.toMatchRpcSuccess();
  });

  it('fails when envelope carries an error field', () => {
    expect({
      success: true,
      error: 'stale',
      correlationId: 'corr-3',
    }).not.toMatchRpcSuccess();
  });

  it('fails when envelope is malformed', () => {
    expect({ random: 'object' }).not.toMatchRpcSuccess();
  });
});

describe('toMatchRpcError', () => {
  it('passes on a well-formed error envelope', () => {
    expect({
      success: false,
      error: 'bad input',
      correlationId: 'corr-4',
    }).toMatchRpcError();
  });

  it('matches expected error string', () => {
    expect({
      success: false,
      error: 'permission denied',
      correlationId: 'corr-5',
    }).toMatchRpcError('permission denied');
  });

  it('matches expected error regex', () => {
    expect({
      success: false,
      error: 'LICENSE_REQUIRED: renew now',
      correlationId: 'corr-6',
    }).toMatchRpcError(/LICENSE_REQUIRED/);
  });

  it('fails when success is true', () => {
    expect({
      success: true,
      data: { ok: 1 },
      correlationId: 'corr-7',
    }).not.toMatchRpcError();
  });

  it('fails when error is empty string', () => {
    expect({
      success: false,
      error: '',
      correlationId: 'corr-8',
    }).not.toMatchRpcError();
  });
});
