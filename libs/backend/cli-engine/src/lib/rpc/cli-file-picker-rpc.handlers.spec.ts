/**
 * `file:pick` must behave the same on a headless host as it does behind a
 * native dialog: paths plus sizes, and an empty array for anything that is
 * not a selection. A caller cannot be asked to branch on which host answered.
 */

import 'reflect-metadata';

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';

import { CliFilePickerRpcHandlers } from './cli-file-picker-rpc.handlers';
import {
  HEADLESS_FILE_PICKER,
  type IHeadlessFilePicker,
} from './headless-file-picker.port';

type PickHandler = (
  params: { multiple?: boolean } | undefined,
) => Promise<{ files: Array<{ path: string; size: number }> }>;

function build(picker?: IHeadlessFilePicker): {
  invoke: PickHandler;
  logger: { warn: jest.Mock; error: jest.Mock };
} {
  let handler: PickHandler | undefined;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  };
  const rpcHandler = {
    registerMethod: jest.fn((_method: string, fn: PickHandler) => {
      handler = fn;
    }),
  };
  const container = {
    isRegistered: jest.fn(() => picker !== undefined),
    resolve: jest.fn(() => picker),
  } as unknown as DependencyContainer;

  new CliFilePickerRpcHandlers(
    logger as never,
    rpcHandler as never,
    container,
  ).register();

  if (!handler) throw new Error('file:pick was not registered');
  return { invoke: handler, logger };
}

describe('CliFilePickerRpcHandlers', () => {
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-pick-'));
    filePath = path.join(dir, 'sample.txt');
    await fs.writeFile(filePath, 'hello');
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the picked paths with their sizes', async () => {
    const { invoke } = build({ pickFiles: async () => [filePath] });

    await expect(invoke({ multiple: false })).resolves.toEqual({
      files: [{ path: filePath, size: 5 }],
    });
  });

  it('treats cancellation as an empty selection', async () => {
    const { invoke } = build({ pickFiles: async () => [] });

    await expect(invoke(undefined)).resolves.toEqual({ files: [] });
  });

  it('reports size 0 for a path that no longer exists', async () => {
    const missing = path.join(dir, 'gone.txt');
    const { invoke } = build({ pickFiles: async () => [missing] });

    await expect(invoke({ multiple: true })).resolves.toEqual({
      files: [{ path: missing, size: 0 }],
    });
  });

  it('defaults `multiple` to true, matching the desktop hosts', async () => {
    const pickFiles = jest.fn(async () => []);
    const { invoke } = build({ pickFiles });

    await invoke(undefined);
    expect(pickFiles).toHaveBeenCalledWith({ multiple: true });

    await invoke({ multiple: false });
    expect(pickFiles).toHaveBeenLastCalledWith({ multiple: false });
  });

  it('degrades to an empty selection when no host picker is registered', async () => {
    const { invoke, logger } = build(undefined);

    await expect(invoke({ multiple: true })).resolves.toEqual({ files: [] });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never propagates a picker failure to the caller', async () => {
    const { invoke, logger } = build({
      pickFiles: async () => {
        throw new Error('overlay exploded');
      },
    });

    await expect(invoke({ multiple: true })).resolves.toEqual({ files: [] });
    expect(logger.error).toHaveBeenCalled();
  });
});
