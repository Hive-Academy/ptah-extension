/**
 * Settings RPC Handlers
 *
 * Handles `settings:export` and `settings:import` for every host (VS Code,
 * Electron, CLI). Native dialogs go through `ISaveDialogProvider` (export) and
 * `IUserInteraction.showOpenDialog?` (import); the import file is read with
 * `node:fs/promises` since every host runs in a Node-capable process.
 *
 * Platform-agnostic settings collection / import is delegated to
 * `SettingsExportService` and `SettingsImportService` from `@ptah-extension/agent-sdk`.
 *
 * TASK_2026_107 Bug 6: Lifted from
 * `apps/ptah-electron/src/services/rpc/handlers/settings-rpc.handlers.ts` so all
 * three apps consume it via `registerAllRpcHandlers()`. The Electron-specific
 * `dialog.showMessageBox` plaintext warning is dropped — the renderer is the
 * appropriate place to present it (and already does).
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SECRET_KEYS,
  countPopulatedSecrets,
} from '@ptah-extension/agent-sdk';
import type {
  SettingsExportService,
  SettingsImportService,
  PtahSettingsExport,
} from '@ptah-extension/agent-sdk';
import {
  PtahSettingsExportSchema,
  CURRENT_SETTINGS_EXPORT_VERSION,
} from './settings-export.schema';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IPlatformCommands,
  ISaveDialogProvider,
  IUserInteraction,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';

@injectable()
export class SettingsRpcHandlers {
  static readonly METHODS = [
    'settings:export',
    'settings:import',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_SETTINGS_EXPORT)
    private readonly settingsExportService: SettingsExportService,
    @inject(SDK_TOKENS.SDK_SETTINGS_IMPORT)
    private readonly settingsImportService: SettingsImportService,
    @inject(TOKENS.SAVE_DIALOG_PROVIDER)
    private readonly saveDialogProvider: ISaveDialogProvider,
    @inject(PLATFORM_TOKENS.USER_INTERACTION)
    private readonly userInteraction: IUserInteraction,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
  ) {}

  register(): void {
    this.registerExport();
    this.registerImport();

    this.logger.debug('Settings RPC handlers registered', {
      methods: ['settings:export', 'settings:import'],
    });
  }

  /**
   * settings:export — collect, save through native dialog, return summary.
   */
  private registerExport(): void {
    this.rpcHandler.registerMethod('settings:export', async () => {
      try {
        const source = this.detectSource();
        const exportData =
          await this.settingsExportService.collectSettings(source);

        const jsonContent = JSON.stringify(exportData, null, 2);
        const filePath = await this.saveDialogProvider.showSaveAndWrite({
          defaultFilename: 'ptah-settings-export.json',
          filters: { 'JSON Files': ['json'] },
          title: 'Export Ptah Settings',
          content: Buffer.from(jsonContent, 'utf-8'),
        });

        if (!filePath) {
          this.logger.info('[RPC] settings:export cancelled by user');
          return { exported: false, cancelled: true };
        }

        const secretCount = countPopulatedSecrets(exportData);
        const configCount = Object.keys(exportData.config).length;

        this.logger.info('[RPC] settings:export completed', {
          filePath,
          secretCount,
          configCount,
        });

        return {
          exported: true,
          filePath,
          secretCount,
          configCount,
        };
      } catch (error) {
        this.logger.error(
          '[RPC] settings:export failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          exported: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * settings:import — show open dialog, read file, delegate to service,
   * apply config values via IWorkspaceProvider, optionally reload after a
   * license key import.
   */
  private registerImport(): void {
    this.rpcHandler.registerMethod('settings:import', async () => {
      try {
        // Hosts without a native picker (CLI / headless) cannot drive an
        // interactive import. Return cancelled rather than throwing so the
        // renderer can fall back to a paste-based flow.
        if (!this.userInteraction.showOpenDialog) {
          this.logger.info(
            '[RPC] settings:import unavailable on this host (no showOpenDialog)',
          );
          return { cancelled: true };
        }

        const filePaths = await this.userInteraction.showOpenDialog({
          title: 'Import Ptah Settings',
          properties: ['openFile'],
        });

        if (filePaths.length === 0) {
          this.logger.info('[RPC] settings:import cancelled by user');
          return { cancelled: true };
        }

        const filePath = filePaths[0];

        const fs = await import('node:fs/promises');
        const fileContent = await fs.readFile(filePath, 'utf-8');

        if (!fileContent.trim()) {
          this.logger.warn('[RPC] settings:import - empty file selected', {
            filePath,
          });
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: ['Selected file is empty'],
            },
          };
        }

        let parsedData: unknown;
        try {
          parsedData = JSON.parse(fileContent);
        } catch (parseError) {
          this.logger.warn('[RPC] settings:import - malformed JSON', {
            filePath,
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          });
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: [
                `Malformed JSON: ${
                  parseError instanceof Error
                    ? parseError.message
                    : String(parseError)
                }`,
              ],
            },
          };
        }

        if (!parsedData || typeof parsedData !== 'object') {
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: ['File does not contain a valid JSON object'],
            },
          };
        }

        // Validate the parsed payload against the versioned Zod schema.
        // We do NOT expose raw Zod error details to the client — those can
        // contain user-supplied values.  Log details internally only.
        const parseResult = PtahSettingsExportSchema.safeParse(parsedData);
        if (!parseResult.success) {
          this.logger.warn('[RPC] settings:import - schema validation failed', {
            filePath,
            issues: parseResult.error.issues.map((i) => ({
              path: i.path,
              code: i.code,
            })),
          });
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: [
                'The selected file is not a valid Ptah settings export.',
              ],
            },
          };
        }

        const validated = parseResult.data;

        // Version check (Q4 — Option B): reject exports produced by a newer
        // version of Ptah.  Older versions are accepted; the schema uses
        // .passthrough() to handle unknown fields from future revisions.
        if (validated.version > CURRENT_SETTINGS_EXPORT_VERSION) {
          this.logger.warn('[RPC] settings:import - export version too high', {
            fileVersion: validated.version,
            currentVersion: CURRENT_SETTINGS_EXPORT_VERSION,
          } as unknown as Error);
          return {
            cancelled: false,
            result: {
              imported: [],
              skipped: [],
              errors: [
                `Unsupported settings export version: ${validated.version}. ` +
                  `This export was produced by a newer version of Ptah. ` +
                  `Update Ptah to import it.`,
              ],
            },
          };
        }

        // Cast is safe: Zod has validated the required fields and
        // CURRENT_SETTINGS_EXPORT_VERSION >= validated.version so the shape
        // is compatible with PtahSettingsExport.
        const exportData = validated as unknown as PtahSettingsExport;

        // Delegate secrets / provider keys to the platform-agnostic service.
        const importResult =
          await this.settingsImportService.importSettings(exportData);

        // Config values: SettingsImportService reports config as skipped
        // because IWorkspaceProvider used to be read-only. The interface now
        // exposes setConfiguration() so we can write them here and promote
        // each entry from skipped → imported.
        if (exportData.config && Object.keys(exportData.config).length > 0) {
          for (const [key, value] of Object.entries(exportData.config)) {
            try {
              await this.workspaceProvider.setConfiguration('ptah', key, value);
              const skippedIdx = importResult.skipped.findIndex((s) =>
                s.startsWith(`config:${key}`),
              );
              if (skippedIdx !== -1) {
                importResult.skipped.splice(skippedIdx, 1);
              }
              importResult.imported.push(`config:${key}`);
            } catch (configError) {
              importResult.errors.push(
                `config:${key}: ${
                  configError instanceof Error
                    ? configError.message
                    : String(configError)
                }`,
              );
            }
          }
          this.logger.info('[RPC] Config values imported', {
            count: Object.keys(exportData.config).length,
          });
        }

        this.logger.info('[RPC] settings:import completed', {
          filePath,
          imported: importResult.imported.length,
          skipped: importResult.skipped.length,
          errors: importResult.errors.length,
        });

        // If a license key was imported, verify with the server first so the
        // in-memory cache is fresh; then schedule a window reload. If
        // verification fails we leave reload off — otherwise the stale cache
        // would push the user back to the welcome screen.
        if (importResult.imported.includes(SECRET_KEYS.LICENSE_KEY)) {
          this.logger.info(
            '[RPC] License key imported, verifying and scheduling reload',
          );
          try {
            const status = await this.licenseService.verifyLicense();
            if (status.valid) {
              setTimeout(() => {
                void this.platformCommands.reloadWindow();
              }, 1500);
            } else {
              this.logger.warn(
                '[RPC] License key imported but verification returned invalid',
                { reason: status.reason } as unknown as Error,
              );
            }
          } catch (verifyError) {
            this.logger.warn(
              '[RPC] License verification after import failed — user should restart manually',
              verifyError instanceof Error
                ? verifyError
                : new Error(String(verifyError)),
            );
          }
        }

        return {
          cancelled: false,
          result: importResult,
        };
      } catch (error) {
        this.logger.error(
          '[RPC] settings:import failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          cancelled: false,
          result: {
            imported: [],
            skipped: [],
            errors: [error instanceof Error ? error.message : String(error)],
          },
        };
      }
    });
  }

  /**
   * Detect the host platform from runtime characteristics so the export
   * carries the correct `source` field. We avoid taking another DI token
   * just for this; the renderer treats the value as informational.
   */
  private detectSource(): 'vscode' | 'electron' | 'cli' {
    // Electron: process.versions.electron is set in both main and renderer.
    if (
      typeof process !== 'undefined' &&
      typeof process.versions === 'object' &&
      typeof (process.versions as { electron?: string }).electron === 'string'
    ) {
      return 'electron';
    }
    // VS Code extension host: env var is set by the runtime.
    if (typeof process !== 'undefined' && process.env['VSCODE_PID']) {
      return 'vscode';
    }
    return 'cli';
  }
}
