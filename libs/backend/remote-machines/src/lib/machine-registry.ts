import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { MACHINE_SSH_ALIAS_PATTERN } from '@ptah-extension/shared';
import { validateSshAlias } from './ssh-alias';

const MAX_MACHINES = 256;
const MAX_REGISTRY_BYTES = 256 * 1024;

export class MachineRegistryWriteError extends Error {
  constructor(
    readonly code: 'TOO_MANY_MACHINES' | 'REGISTRY_TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}

export const MachineRegistrySchema = z
  .object({
    machines: z
      .array(
        z
          .object({
            machineId: z.string().min(1).max(256),
            alias: z.string().regex(MACHINE_SSH_ALIAS_PATTERN),
            displayName: z.string().min(1).max(256).optional(),
            workerMachineId: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .max(MAX_MACHINES),
  })
  .strict();
export type MachineRegistryData = z.infer<typeof MachineRegistrySchema>;

type Fs = Pick<
  typeof fs,
  'stat' | 'readFile' | 'mkdir' | 'open' | 'rename' | 'unlink'
>;

export class MachineRegistry {
  constructor(
    readonly path = join(homedir(), '.ptah', 'remote-machines.json'),
    private readonly io: Fs = fs,
  ) {}

  async read(): Promise<MachineRegistryData> {
    let source: string;
    try {
      const metadata = await this.io.stat(this.path);
      if (metadata.size > MAX_REGISTRY_BYTES)
        throw new Error('Machine registry exceeds 256 KiB');
      const bytes = await this.io.readFile(this.path);
      if (bytes.byteLength > MAX_REGISTRY_BYTES)
        throw new Error('Machine registry exceeds 256 KiB');
      source = bytes.toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { machines: [] };
      throw error;
    }
    try {
      return MachineRegistrySchema.parse(JSON.parse(source));
    } catch {
      throw new Error(
        `Machine registry ${this.path} is corrupt. Repair or back it up before changing machines.`,
      );
    }
  }

  async write(value: MachineRegistryData): Promise<void> {
    if (value.machines.length > MAX_MACHINES)
      throw new MachineRegistryWriteError(
        'TOO_MANY_MACHINES',
        `Machine registry supports at most ${MAX_MACHINES} machines.`,
      );
    const parsed = MachineRegistrySchema.parse(value);
    const serialized = JSON.stringify(parsed, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REGISTRY_BYTES)
      throw new MachineRegistryWriteError(
        'REGISTRY_TOO_LARGE',
        'Machine registry exceeds 256 KiB. Remove machines or shorten names before saving.',
      );
    parsed.machines.forEach((machine) => validateSshAlias(machine.alias));
    // Refuse to replace an existing corrupt registry.
    await this.read();
    const dir = dirname(this.path);
    await this.io.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.remote-machines-${randomUUID()}.tmp`);
    let created = false;
    let renamed = false;
    try {
      const handle = await this.io.open(temp, 'wx', 0o600);
      created = true;
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.io.rename(temp, this.path);
      renamed = true;
      // The replacement has landed; directory fsync is best-effort here.
      try {
        const dirHandle = await this.io.open(dir, 'r');
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        /* A failed directory sync cannot roll back the rename. */
      }
    } catch (error) {
      if (created && !renamed)
        // degradation-audit: reported - the original write error is rethrown below; a
        // leftover temp file is harmless and has a unique name.
        await this.io.unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
