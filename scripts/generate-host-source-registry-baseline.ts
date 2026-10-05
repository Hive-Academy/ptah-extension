import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MESSAGE_TYPES } from '../libs/shared/src/lib/types/messages/message-constants';
import { RPC_METHOD_NAMES } from '../libs/shared/src/lib/types/rpc.types';

const baselinePath = resolve(
  import.meta.dirname,
  '../libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts',
);
const compareCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
const rpcMethodNames = [...RPC_METHOD_NAMES].sort(compareCodeUnits);
const messageTypes = Object.values(MESSAGE_TYPES).sort(compareCodeUnits);
const content = [
  '/**',
  ' * Generated from the f314a4f8a host-source registries.',
  ' * Regenerate: npx tsx scripts/generate-host-source-registry-baseline.ts',
  ' * Any change to this baseline requires a Gate 2 exception in TASK_2026_610.',
  ' */',
  '',
  `export const BASELINE_RPC_METHOD_NAMES: readonly string[] = ${JSON.stringify(rpcMethodNames, null, 2)};`,
  '',
  `export const BASELINE_MESSAGE_TYPES: readonly string[] = ${JSON.stringify(messageTypes, null, 2)};`,
  '',
].join('\n');

writeFileSync(baselinePath, content);
