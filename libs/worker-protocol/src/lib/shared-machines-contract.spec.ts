/**
 * Compatibility proof between the worker wire contract and the renderer IPC
 * contract in `@ptah-extension/shared` (`machines:*`). Shared restates the
 * worker's limits and result shapes because it may not import this library;
 * this spec fails when either side drifts from the other.
 */

import {
  MACHINE_ID_MAX_LENGTH,
  MACHINE_PAIRING_CODE_INPUT_MAX_LENGTH,
  MACHINE_PROMPT_MAX_LENGTH,
  REMOTE_MACHINE_SESSION_STATES,
  type MachineReadinessReport,
  type MachinesSessionAttachResult,
  type MachinesSessionContinueResult,
  type MachinesSessionStartResult,
  type MachinesSessionStopResult,
  type MachinesPermissionRespondResult,
  type RemoteMachineSessionSummary,
  type RemoteMachineWorkspace,
} from '@ptah-extension/shared';
import {
  PAIRING_CODE_INPUT_MAX_LENGTH,
  REMOTE_SESSION_STATES,
  parseParams,
  type ReadinessReport,
  type RemoteSessionSummary,
  type RemoteWorkspace,
  type WorkerMethodResult,
} from '../index';

/** `true` only when `Worker` values are assignable to `Shared`. */
type Fits<Worker, Shared> = [Worker] extends [Shared] ? true : false;

describe('worker protocol ↔ shared machines contract', () => {
  it('describes every worker result the IPC contract restates', () => {
    const fits: [
      Fits<WorkerMethodResult<'session.attach'>, MachinesSessionAttachResult>,
      Fits<WorkerMethodResult<'session.start'>, MachinesSessionStartResult>,
      Fits<
        WorkerMethodResult<'session.continue'>,
        MachinesSessionContinueResult
      >,
      Fits<WorkerMethodResult<'session.stop'>, MachinesSessionStopResult>,
      Fits<
        WorkerMethodResult<'permission.respond'>,
        MachinesPermissionRespondResult
      >,
      Fits<RemoteSessionSummary, RemoteMachineSessionSummary>,
      Fits<RemoteWorkspace, RemoteMachineWorkspace>,
      Fits<ReadinessReport, MachineReadinessReport>,
    ] = [true, true, true, true, true, true, true, true];
    expect(fits.every(Boolean)).toBe(true);
  });

  it('lists the same remote session states', () => {
    expect([...REMOTE_MACHINE_SESSION_STATES]).toEqual([
      ...REMOTE_SESSION_STATES,
    ]);
  });

  it('bounds pairing-code input the same way', () => {
    expect(MACHINE_PAIRING_CODE_INPUT_MAX_LENGTH).toBe(
      PAIRING_CODE_INPUT_MAX_LENGTH,
    );
  });

  it('accepts on the worker every ID the IPC contract accepts, and no longer', () => {
    const at = 'i'.repeat(MACHINE_ID_MAX_LENGTH);
    const over = 'i'.repeat(MACHINE_ID_MAX_LENGTH + 1);
    expect(parseParams('session.stop', { sessionId: at }).ok).toBe(true);
    expect(parseParams('session.stop', { sessionId: over }).ok).toBe(false);
    expect(parseParams('sessions.list', { workspaceId: at }).ok).toBe(true);
    expect(parseParams('sessions.list', { workspaceId: over }).ok).toBe(false);
  });

  it('accepts on the worker every prompt the IPC contract accepts, and no longer', () => {
    const at = 'p'.repeat(MACHINE_PROMPT_MAX_LENGTH);
    const over = 'p'.repeat(MACHINE_PROMPT_MAX_LENGTH + 1);
    expect(
      parseParams('session.continue', { sessionId: 's-1', prompt: at }).ok,
    ).toBe(true);
    expect(
      parseParams('session.continue', { sessionId: 's-1', prompt: over }).ok,
    ).toBe(false);
  });
});
