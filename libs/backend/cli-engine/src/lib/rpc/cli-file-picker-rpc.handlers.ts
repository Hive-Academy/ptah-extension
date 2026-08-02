/**
 * Headless `file:pick` handler.
 *
 * Serves the same contract as the Electron and VS Code implementations —
 * `{ multiple? }` in, `{ files: [{ path, size }] }` out, empty on cancel —
 * with the modal dialog replaced by whatever {@link IHeadlessFilePicker} the
 * host registered. Deliberately no divergence in meaning: a caller cannot
 * tell which host answered.
 *
 * `file:pick-images` is NOT served here. It returns image bytes for
 * attachment, which needs a surface the TUI does not have; the
 * `filePickerImages` capability stays off and the method stays excluded.
 */

import { injectable, inject, type DependencyContainer } from 'tsyringe';
import * as fs from 'fs/promises';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';

import {
  HEADLESS_FILE_PICKER,
  type IHeadlessFilePicker,
} from './headless-file-picker.port.js';

@injectable()
export class CliFilePickerRpcHandlers {
  static readonly METHODS = [
    'file:pick',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'file:pick',
      async (params: { multiple?: boolean } | undefined) => {
        const multiple = params?.multiple !== false;

        if (!this.container.isRegistered(HEADLESS_FILE_PICKER)) {
          this.logger.warn(
            '[cli RPC] file:pick called but no host picker is registered',
          );
          return { files: [] };
        }

        try {
          const picker =
            this.container.resolve<IHeadlessFilePicker>(HEADLESS_FILE_PICKER);
          const paths = await picker.pickFiles({ multiple });

          const files: Array<{ path: string; size: number }> = [];
          for (const path of paths) {
            const stat = await fs.stat(path).catch(() => null);
            files.push({ path, size: stat?.size ?? 0 });
          }
          return { files };
        } catch (error: unknown) {
          this.logger.error(
            '[cli RPC] file:pick failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { files: [] };
        }
      },
    );
  }
}
