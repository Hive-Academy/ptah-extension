import { RPC_CAPABILITIES } from '@ptah-extension/rpc-handlers';
import { WORKER_METHODS } from '../worker-methods';
import {
  WORKER_CAPABILITIES,
  supportedRemoteMethods,
} from './worker-capabilities';

it('covers every host capability and the Electron enabled capability rows', () => {
  const rows = new Map(WORKER_CAPABILITIES.map((row) => [row.capability, row]));
  for (const key of RPC_CAPABILITIES) {
    const row = rows.get(key);
    expect(row).toBeDefined();
    expect(row?.status).toMatch(
      /^(supported|deferred|unsupported-remotely|not-applicable)$/,
    );
    if (row?.status !== 'supported')
      expect(row?.reason ?? row?.phase).toBeTruthy();
  }
  expect(rows.has('core chat/session')).toBe(true);
});

it('keeps the documented remote surface equal to the method table', () => {
  expect([...supportedRemoteMethods()].sort()).toEqual(
    Object.keys(WORKER_METHODS).sort(),
  );
});
