/**
 * Any change to this baseline requires a Gate 2 exception in TASK_2026_610.
 */

import { MESSAGE_TYPES } from '../messages/message-constants';
import { RPC_METHOD_NAMES } from '../rpc.types';
import {
  BASELINE_MESSAGE_TYPES,
  BASELINE_RPC_METHOD_NAMES,
} from './host-source-registry.baseline';

describe('host-source registry contract', () => {
  it('does not add or remove host RPC methods', () => {
    expect([...RPC_METHOD_NAMES].sort()).toEqual(BASELINE_RPC_METHOD_NAMES);
  });

  it('does not add or remove host push message types', () => {
    expect(Object.values(MESSAGE_TYPES).sort()).toEqual(
      BASELINE_MESSAGE_TYPES,
    );
  });
});
