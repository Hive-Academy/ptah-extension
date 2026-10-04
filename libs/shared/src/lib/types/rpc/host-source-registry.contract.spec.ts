/**
 * Any change to this baseline requires a Gate 2 exception in TASK_2026_610.
 *
 * The host-source pattern is case-insensitive: `turn`, `recap`, `ptah-?ui`,
 * `change-?set`, `host-?source`, `turn-?tests`, or `usage`. It deliberately
 * checks only host-source-shaped registry names, so unrelated registry additions
 * do not fail this contract.
 */

import { MESSAGE_TYPES } from '../messages/message-constants';
import { RPC_METHOD_NAMES } from '../rpc.types';
import {
  BASELINE_MESSAGE_TYPES,
  BASELINE_RPC_METHOD_NAMES,
} from './host-source-registry.baseline';

const HOST_SOURCE_NAME_PATTERN =
  /turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage/i;

function isHostSourceName(name: string): boolean {
  return HOST_SOURCE_NAME_PATTERN.test(name);
}

function expectNoAddedHostSourceNames(
  currentNames: readonly string[],
  baselineNames: readonly string[],
): void {
  const baselineNameSet = new Set(baselineNames);
  const addedHostSourceNames = currentNames.filter(
    (name) => isHostSourceName(name) && !baselineNameSet.has(name),
  );

  expect(addedHostSourceNames).toEqual([]);
}

function expectNoRemovedHostSourceNames(
  currentNames: readonly string[],
  baselineNames: readonly string[],
): void {
  const currentNameSet = new Set(currentNames);
  const removedHostSourceNames = baselineNames.filter(
    (name) => isHostSourceName(name) && !currentNameSet.has(name),
  );

  expect(removedHostSourceNames).toEqual([]);
}

describe('host-source registry contract', () => {
  it('does not add host-source RPC methods', () => {
    expectNoAddedHostSourceNames(RPC_METHOD_NAMES, BASELINE_RPC_METHOD_NAMES);
  });

  it('does not remove host-source RPC methods', () => {
    expectNoRemovedHostSourceNames(
      RPC_METHOD_NAMES,
      BASELINE_RPC_METHOD_NAMES,
    );
  });

  it('does not add host-source push message types', () => {
    expectNoAddedHostSourceNames(
      Object.values(MESSAGE_TYPES),
      BASELINE_MESSAGE_TYPES,
    );
  });

  it('does not remove host-source push message types', () => {
    expectNoRemovedHostSourceNames(
      Object.values(MESSAGE_TYPES),
      BASELINE_MESSAGE_TYPES,
    );
  });

  it('matches host-source names without matching unrelated names', () => {
    expect(isHostSourceName('git:turnRecapData')).toBe(true);
    expect(isHostSourceName('foo:bar')).toBe(false);
  });
});
