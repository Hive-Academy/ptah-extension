import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  ClaudeRpcService,
  PluginCatalogService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import { MARKETPLACE_RPC_TIMEOUTS } from '@ptah-extension/chat-ui';
import type {
  PluginConfigHomeCandidate,
  PluginConfigHomeStatus,
} from '@ptah-extension/shared';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';

/** One button of the notice. */
export interface ConfigHomeAction {
  /** Unique within the notice; the busy marker follows it. */
  readonly key: string;
  readonly label: string;
  readonly action: 'adopt' | 'dismiss';
  /** The candidate's own absolute folder, sent back verbatim. */
  readonly folder: string;
  /** The folder as shown, relative to the harness root. */
  readonly shownFolder: string;
}

/** One message of the notice with its buttons. */
export interface ConfigHomeBlock {
  readonly key: string;
  readonly role: 'alert' | 'status';
  readonly text: string;
  readonly actions: readonly ConfigHomeAction[];
}

function normalized(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}

/**
 * `folder` relative to `root` (`packages/app`), or the folder itself when it
 * is not under the root. Windows drive paths compare without case.
 */
export function relativeFolder(root: string, folder: string): string {
  const base = normalized(root);
  const target = normalized(folder);
  const windows = /^[a-zA-Z]:\//.test(base);
  const fold = (value: string) => (windows ? value.toLowerCase() : value);
  if (fold(target) === fold(base)) return '.';
  const prefix = `${base}/`;
  return fold(target).startsWith(fold(prefix))
    ? target.slice(prefix.length)
    : folder;
}

function savedOn(candidate: PluginConfigHomeCandidate | undefined): string {
  if (candidate?.lastUpdated === undefined) return '';
  const date = new Date(candidate.lastUpdated);
  if (Number.isNaN(date.getTime())) return '';
  return ` on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)}`;
}

function adopt(folder: string, shownFolder: string): ConfigHomeAction {
  return {
    key: `adopt:${folder}`,
    label: `Use settings from ${shownFolder}`,
    action: 'adopt',
    folder,
    shownFolder,
  };
}

function dismiss(folder: string, shownFolder: string): ConfigHomeAction {
  return {
    key: `dismiss:${folder}`,
    label: 'Dismiss',
    action: 'dismiss',
    folder,
    shownFolder,
  };
}

/**
 * The notice for one config-home status (plan :1344-1356, D14), or no block
 * at all for `home`, `null` or a status without candidates.
 */
export function configHomeBlocks(
  status: PluginConfigHomeStatus | null,
): readonly ConfigHomeBlock[] {
  if (status === null || status.candidates.length === 0) return [];
  const shown = (folder: string) => relativeFolder(status.harnessRoot, folder);
  switch (status.state) {
    case 'home':
      return [];
    case 'conflict': {
      const governing =
        status.candidates.find((c) => c.folder === status.governingFolder) ??
        status.candidates[0];
      return [
        {
          key: 'conflict',
          role: 'alert',
          text:
            'Folders in this repository have different plugin settings. ' +
            `Ptah is using the settings saved in ${shown(governing.folder)}` +
            `${savedOn(governing)} until you choose.`,
          actions: status.candidates.map((c) =>
            adopt(c.folder, shown(c.folder)),
          ),
        },
      ];
    }
    case 'differs':
      return status.candidates
        .filter((c) => c.differsFromHome)
        .map((c) => ({
          key: `differs:${c.folder}`,
          role: 'status',
          text:
            `${shown(c.folder)} has its own saved plugin settings that differ ` +
            "from this repository's. They are kept but not applied.",
          actions: [
            adopt(c.folder, shown(c.folder)),
            dismiss(c.folder, shown(c.folder)),
          ],
        }));
    case 'imported':
      return status.candidates.map((c) => ({
        key: `imported:${c.folder}`,
        role: 'status',
        text: `Plugin settings saved in ${shown(c.folder)} now apply to the whole repository.`,
        actions: [dismiss(c.folder, shown(c.folder))],
      }));
  }
}

/** Fixed failure copy; the host's error text is never shown. */
export function configHomeFailure(action: ConfigHomeAction): string {
  return action.action === 'adopt'
    ? `Could not use the plugin settings from ${action.shownFolder}. Try again.`
    : 'Could not dismiss the plugin settings notice. Try again.';
}

/**
 * PluginConfigHomeNoticeComponent — the D14 plugin settings notice at the top
 * of the installed page (Electron only: no other host sends `configHome`).
 *
 * Reads `PluginCatalogService.configHome` and renders nothing when it is
 * `null`. A button calls `plugins:resolve-config-home` and then reloads the
 * catalogue through the inventory's plugins slice; every button is disabled
 * while a call runs. The answer's `libraryPass` goes to the inventory, whose
 * failed-pass state drives the page's C10 notice. A failure is emitted as fixed copy through `failed` for
 * the page's config-change failure state (`actionError`); `failed(null)`
 * clears it when the next call starts.
 */
@Component({
  selector: 'ptah-plugin-config-home-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
  template: `
    @for (block of blocks(); track block.key) {
      <div
        class="alert alert-warning mb-2 block text-xs last:mb-0"
        data-testid="plugin-config-home-notice"
        [attr.data-state]="block.key.split(':')[0]"
        [attr.role]="block.role"
        [attr.aria-busy]="busyKey() !== null"
      >
        <p class="[overflow-wrap:anywhere]">{{ block.text }}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          @for (action of block.actions; track action.key) {
            <button
              type="button"
              class="btn btn-xs h-auto min-h-6 max-w-full justify-start whitespace-normal py-1 text-left [overflow-wrap:anywhere]"
              data-testid="plugin-config-home-action"
              [attr.data-action]="action.action"
              [disabled]="busyKey() !== null"
              (click)="run(action)"
            >
              @if (busyKey() === action.key) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
              }
              {{ action.label }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class PluginConfigHomeNoticeComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly catalog = inject(PluginCatalogService);
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly scope = inject(WorkspaceScopeService);

  /** Fixed failure copy for the page's `actionError`, or `null` to clear it. */
  public readonly failed = output<string | null>();

  protected readonly blocks = computed(() =>
    configHomeBlocks(this.catalog.configHome()),
  );

  /** The action whose call is running, or `null`. */
  protected readonly busyKey = signal<string | null>(null);

  private destroyed = false;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
  }

  protected run(action: ConfigHomeAction): void {
    if (this.busyKey() !== null) return;
    void this.resolve(action);
  }

  private async resolve(action: ConfigHomeAction): Promise<void> {
    this.busyKey.set(action.key);
    this.failed.emit(null);
    const workspace = this.scope.generation();
    let ok: boolean;
    try {
      const result = await this.rpc.call(
        'plugins:resolve-config-home',
        { action: action.action, folder: action.folder },
        { timeout: MARKETPLACE_RPC_TIMEOUTS.PLUGIN_INSTALL_MS },
      );
      ok = result.isSuccess();
      if (result.isSuccess()) {
        // C10: an adopt whose files were written but whose Library pass
        // failed. Recorded before the reload so the page says so at once.
        this.inventory.recordLibraryPass(result.data.libraryPass, workspace);
        // The catalogue carries the new status; a failed reload shows as the
        // plugins group's own load error.
        await this.inventory.reload('plugins');
      }
    } catch {
      // degradation-audit: reported — fixed copy in the page's actionError.
      ok = false;
    }
    if (this.destroyed) return;
    this.busyKey.set(null);
    if (!ok) this.failed.emit(configHomeFailure(action));
  }
}
