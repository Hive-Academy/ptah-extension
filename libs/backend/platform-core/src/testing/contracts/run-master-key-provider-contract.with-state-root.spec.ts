import 'reflect-metadata';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';
import type { IMasterKeyProvider } from '../../interfaces/master-key-provider.interface';
import { runMasterKeyProviderContract } from './run-master-key-provider-contract';

const sharedKeysByStateRoot = new Map<string, Buffer>();

function createStateRootBackedProvider(stateRoot: string): IMasterKeyProvider {
  let cached: Buffer | null = null;
  return {
    async getMasterKey(): Promise<Buffer> {
      if (cached) return cached;
      let existing = sharedKeysByStateRoot.get(stateRoot);
      if (!existing) {
        existing = Buffer.from(
          Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff || 1),
        );
        sharedKeysByStateRoot.set(stateRoot, existing);
      }
      cached = existing;
      return cached;
    },
  };
}

runMasterKeyProviderContract(
  'state-root-backed mock provider',
  (stateRoot) => createStateRootBackedProvider(stateRoot),
  async () => {
    return fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'ptah-mk-contract-'));
  },
  async (stateRoot) => {
    sharedKeysByStateRoot.delete(stateRoot);
    try {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  },
);
