import {
  PendingPermissionIndex,
  PermissionAnswerError,
  assertManualApproval,
  assertManualApprovalSettings,
} from './pending-permissions';
import type {
  ISdkPermissionHandler,
  PermissionRequest,
} from '@ptah-extension/shared';
import { SessionLogWriter } from './session-log-writer';

it('refuses worker auto-approve flags and environment', () => {
  expect(() => assertManualApproval(['--auto-approve'], undefined)).toThrow();
  expect(() => assertManualApproval([], 'true')).toThrow();
  expect(() => assertManualApproval([], undefined)).not.toThrow();
});

it('refuses a persisted autopilot level that skips manual approval', () => {
  for (const permissionLevel of ['yolo', 'auto-edit'])
    expect(() =>
      assertManualApprovalSettings({ enabled: true, permissionLevel }),
    ).toThrow(`autopilot is enabled at level "${permissionLevel}"`);
  for (const permissionLevel of ['ask', 'plan'])
    expect(() =>
      assertManualApprovalSettings({ enabled: true, permissionLevel }),
    ).not.toThrow();
  // A disabled autopilot runs every session at `ask`, whatever level is saved.
  expect(() =>
    assertManualApprovalSettings({ enabled: false, permissionLevel: 'yolo' }),
  ).not.toThrow();
});

it('first answer wins synchronously; auto-approve is refused', async () => {
  const handleResponse = jest.fn();
  const handler = { handleResponse } as unknown as ISdkPermissionHandler;
  const index = new PendingPermissionIndex(handler);
  const writer = {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as SessionLogWriter;
  index.add({ id: 'r1', sessionId: 's1' } as PermissionRequest);
  const response = { id: 'r1', decision: 'allow' as const };
  const first = index.answer('s1', response, 'Client', writer);
  await expect(
    index.answer('s1', response, 'Client', writer),
  ).rejects.toBeInstanceOf(PermissionAnswerError);
  await first;
  expect(handleResponse).toHaveBeenCalledTimes(1);
  expect(writer.enqueue).toHaveBeenCalledWith('worker:permission.answered', {
    requestId: 'r1',
    decision: 'allow',
    by: 'Client',
  });
  index.add({ id: 'r2', sessionId: 's1' } as PermissionRequest);
  await expect(
    index.answer(
      's1',
      { id: 'r2', decision: 'always_allow' },
      'Client',
      writer,
    ),
  ).rejects.toBeInstanceOf(PermissionAnswerError);
  expect(handleResponse).toHaveBeenCalledTimes(1);
});
