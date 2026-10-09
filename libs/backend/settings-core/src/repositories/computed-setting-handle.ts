import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import type { SettingDefinition } from '../schema/definition';
import type {
  WorkspaceScopeResolver,
  WorkspaceWriteTarget,
} from '../scope/workspace-scope-resolver';
import type { SettingHandle } from './setting-handle';

interface CacheInvalidatingStore {
  invalidateCache(key: string): void;
}

function hasInvalidateCache(
  store: ISettingsStore,
): store is ISettingsStore & CacheInvalidatingStore {
  return (
    typeof (store as Partial<CacheInvalidatingStore>).invalidateCache ===
    'function'
  );
}

export class ComputedSettingHandle<T> implements SettingHandle<T> {
  private readonly store: ISettingsStore;
  private readonly def: SettingDefinition<T>;
  private readonly resolveKey: () => string;
  private readonly authMethodKey: string;
  private readonly anthropicProviderIdKey: string;
  private readonly resolver?: WorkspaceScopeResolver;

  constructor(
    store: ISettingsStore,
    def: SettingDefinition<T>,
    resolveKey: () => string,
    authMethodKey: string,
    anthropicProviderIdKey: string,
    resolver?: WorkspaceScopeResolver,
  ) {
    this.store = store;
    this.def = def;
    this.resolveKey = resolveKey;
    this.authMethodKey = authMethodKey;
    this.anthropicProviderIdKey = anthropicProviderIdKey;
    this.resolver = resolver;
  }

  private physicalKey(): string {
    const logicalKey = this.resolveKey();
    return this.resolver
      ? this.resolver.effectiveKey(logicalKey, this.def.appScopable === true)
      : logicalKey;
  }

  get(): T {
    const key = this.physicalKey();
    const raw = this.store.readGlobal<unknown>(key);
    const parsed = this.def.schema.safeParse(raw);
    return parsed.success ? parsed.data : this.def.default;
  }

  /**
   * @throws {Error} when `target` is 'workspace' and no workspace is active;
   *   the store is not touched. The resolver would otherwise fall back to the
   *   global key, turning a stale per-workspace save into a machine-wide one.
   */
  async set(value: T, target: WorkspaceWriteTarget = 'global'): Promise<void> {
    const validated = this.def.schema.parse(value);
    if (this.resolver) {
      const key = this.resolveKey();
      if (target === 'workspace' && !this.resolver.getActivePath()) {
        throw new Error(
          `Cannot save '${key}' for this workspace: no workspace is open.`,
        );
      }
      const appScopable = this.def.appScopable === true;
      await this.resolver.write(key, validated, target, appScopable);
      // Drop narrower overrides so the value saved at `target` is the one
      // read back — as `auth:saveSettings` does for the provider. Otherwise a
      // leftover app/workspace model shadows the new one for the new provider.
      await this.resolver.clearMoreSpecific(key, target, appScopable);
      return;
    }
    await this.store.writeGlobal(this.resolveKey(), validated);
  }

  /**
   * Notify `cb` whenever the resolved value may have changed.
   *
   * The physical key depends on the resolver-scoped `authMethod` and
   * `anthropicProviderId`, and every one of the three settings can be written
   * at any scope. A workspace write lands on a hashed `workspace.<hash>.*` key
   * and never fires a watcher on the bare key, so watching only the bare keys
   * missed a workspace-scoped provider switch and kept reporting the previous
   * provider's model. This subscribes to every candidate key of all three
   * settings (the resolver's `scopedKeys`) and re-derives that set after each
   * change, so a provider switch at any scope re-targets the model key.
   */
  watch(cb: (value: T) => void): IDisposable {
    let subs: IDisposable[] = [];
    let watched = '';

    const keysToWatch = (): string[] => {
      const modelKey = this.resolveKey();
      if (!this.resolver) {
        return [this.authMethodKey, this.anthropicProviderIdKey, modelKey];
      }
      return [
        ...this.resolver.scopedKeys(this.authMethodKey, true),
        ...this.resolver.scopedKeys(this.anthropicProviderIdKey, true),
        ...this.resolver.scopedKeys(modelKey, this.def.appScopable === true),
      ];
    };
    const subscribe = (): void => {
      const keys = [...new Set(keysToWatch())];
      const signature = keys.join('|');
      if (signature === watched) return;
      for (const sub of subs) sub.dispose();
      watched = signature;
      subs = keys.map((key) => this.store.watchGlobal(key, onChange));
    };
    const onChange = (): void => {
      subscribe();
      cb(this.get());
    };

    subscribe();

    let activeChangeSub: IDisposable | undefined;
    if (this.resolver) {
      activeChangeSub = this.resolver.onActiveChange(() => {
        if (hasInvalidateCache(this.store)) {
          this.store.invalidateCache(this.resolveKey());
          this.store.invalidateCache(this.physicalKey());
        }
        onChange();
      });
    }

    cb(this.get());

    return {
      dispose: () => {
        for (const sub of subs) sub.dispose();
        subs = [];
        activeChangeSub?.dispose();
      },
    };
  }
}
