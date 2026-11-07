import type { ISecretStorage } from '@ptah-extension/platform-core';

export class MachineTokenStore {
  constructor(private readonly secrets: ISecretStorage) {}

  private key(machineId: string): string {
    if (!machineId || machineId.length > 256)
      throw new Error('Invalid machine ID');
    return `remote-machine:${machineId}:token`;
  }

  get(machineId: string): Promise<string | undefined> {
    return this.secrets.get(this.key(machineId));
  }
  set(machineId: string, token: string): Promise<void> {
    if (!token) throw new Error('Cannot store an empty machine token');
    return this.secrets.store(this.key(machineId), token);
  }
  delete(machineId: string): Promise<void> {
    return this.secrets.delete(this.key(machineId));
  }
  warning(): string | undefined {
    return this.secrets.storageMode?.() === 'plaintext'
      ? 'Machine tokens are stored in plain text on this device. Enable the platform keyring to protect them.'
      : undefined;
  }
}
