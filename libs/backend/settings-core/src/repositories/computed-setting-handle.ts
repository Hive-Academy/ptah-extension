import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import type { SettingDefinition } from '../schema/definition';
import type { SettingHandle } from './setting-handle';

/**
 * A SettingHandle whose storage key is computed at runtime from auth context.
 *
 * The actual key in the settings store is `provider.<authKey>.<suffix>`,
 * where `authKey` is derived from the current `authMethod` + `anthropicProviderId`
 * values. This means a single logical setting (e.g. "selected model") maps to
 * different physical keys depending on which provider the user has selected.
 *
 * Key resolution happens on every get/set/watch-fire — never cached — so the
 * handle always reflects the current auth context without requiring a restart.
 *
 * Example:
 *   authMethod = 'thirdParty', anthropicProviderId = 'openrouter'
 *   → physical key = 'provider.thirdParty.openrouter.selectedModel'
 *
 *   authMethod = 'apiKey'
 *   → physical key = 'provider.apiKey.selectedModel'
 */
export class ComputedSettingHandle<T> implements SettingHandle<T> {
  private readonly store: ISettingsStore;
  private readonly def: SettingDefinition<T>;
  private readonly resolveKey: () => string;
  private readonly authMethodKey: string;
  private readonly anthropicProviderIdKey: string;

  constructor(
    store: ISettingsStore,
    def: SettingDefinition<T>,
    resolveKey: () => string,
    authMethodKey: string,
    anthropicProviderIdKey: string,
  ) {
    this.store = store;
    this.def = def;
    this.resolveKey = resolveKey;
    this.authMethodKey = authMethodKey;
    this.anthropicProviderIdKey = anthropicProviderIdKey;
  }

  get(): T {
    const key = this.resolveKey();
    const raw = this.store.readGlobal<unknown>(key);
    const parsed = this.def.schema.safeParse(raw);
    return parsed.success ? parsed.data : this.def.default;
  }

  async set(value: T): Promise<void> {
    const validated = this.def.schema.parse(value);
    const key = this.resolveKey();
    await this.store.writeGlobal(key, validated);
  }

  watch(cb: (value: T) => void): IDisposable {
    // Track the currently subscribed key so we can re-subscribe when auth changes.
    let currentKey = this.resolveKey();
    let innerSub: IDisposable = this.store.watchGlobal(currentKey, () => {
      cb(this.get());
    });

    // Re-subscribe when auth method or provider id changes.
    const resubscribe = () => {
      const newKey = this.resolveKey();
      if (newKey !== currentKey) {
        innerSub.dispose();
        currentKey = newKey;
        innerSub = this.store.watchGlobal(currentKey, () => {
          cb(this.get());
        });
      }
      // Always fire — the auth change itself means the effective value changed.
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

    // Fire immediately with the current value.
    cb(this.get());

    return {
      dispose: () => {
        innerSub.dispose();
        authMethodSub.dispose();
        providerIdSub.dispose();
      },
    };
  }
}
