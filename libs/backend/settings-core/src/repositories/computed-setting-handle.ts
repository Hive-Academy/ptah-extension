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
    return this.resolver ? this.resolver.effectiveKey(logicalKey) : logicalKey;
  }

  get(): T {
    const key = this.physicalKey();
    const raw = this.store.readGlobal<unknown>(key);
    const parsed = this.def.schema.safeParse(raw);
    return parsed.success ? parsed.data : this.def.default;
  }

  async set(value: T, target: WorkspaceWriteTarget = 'global'): Promise<void> {
    const validated = this.def.schema.parse(value);
    if (this.resolver) {
      await this.resolver.write(this.resolveKey(), validated, target);
      return;
    }
    await this.store.writeGlobal(this.resolveKey(), validated);
  }

  watch(cb: (value: T) => void): IDisposable {
    let currentKey = this.physicalKey();
    let innerSub: IDisposable = this.store.watchGlobal(currentKey, () => {
      cb(this.get());
    });
    const resubscribe = () => {
      const newKey = this.physicalKey();
      if (newKey !== currentKey) {
        innerSub.dispose();
        currentKey = newKey;
        innerSub = this.store.watchGlobal(currentKey, () => {
          cb(this.get());
        });
      }
      cb(this.get());
    };

    const authMethodSub = this.store.watchGlobal(
      this.authMethodKey,
      resubscribe,
    );
    const providerIdSub = this.store.watchGlobal(
      this.anthropicProviderIdKey,
      resubscribe,
    );

    let activeChangeSub: IDisposable | undefined;
    if (this.resolver) {
      activeChangeSub = this.resolver.onActiveChange(() => {
        if (hasInvalidateCache(this.store)) {
          this.store.invalidateCache(this.resolveKey());
          this.store.invalidateCache(currentKey);
          this.store.invalidateCache(this.physicalKey());
        }
        resubscribe();
      });
    }

    cb(this.get());

    return {
      dispose: () => {
        innerSub.dispose();
        authMethodSub.dispose();
        providerIdSub.dispose();
        activeChangeSub?.dispose();
      },
    };
  }
}
