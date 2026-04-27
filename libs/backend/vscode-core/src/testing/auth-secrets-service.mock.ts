/**
 * Mock factory for {@link AuthSecretsService} (vscode-core).
 *
 * Backs `getCredential` / `setCredential` / `deleteCredential` / `hasCredential`
 * and the per-provider variants with in-memory Maps so tests can seed
 * credentials via overrides and assert on stored values without touching
 * VS Code's SecretStorage.
 *
 * Production source: `libs/backend/vscode-core/src/services/auth-secrets.service.ts`
 * Consumption pattern: `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:55-56`.
 */

import type {
  AuthCredentialType,
  AuthSecretsService,
  IAuthSecretsService,
} from '../services/auth-secrets.service';

export interface MockAuthSecretsOverrides {
  /** Seed credentials keyed by AuthCredentialType (e.g. `{ apiKey: 'sk-...' }`). */
  credentials?: Partial<Record<AuthCredentialType, string>>;
  /** Seed per-provider API keys keyed by provider id. */
  providerKeys?: Record<string, string>;
}

/**
 * Mock `AuthSecretsService` with in-memory Map-backed storage plus
 * jest.fn-based assertion surfaces. Use the exported helpers `__dumpCredentials`
 * / `__dumpProviderKeys` to inspect stored state in assertions.
 */
export interface MockAuthSecretsService extends jest.Mocked<IAuthSecretsService> {
  __dumpCredentials(): Map<AuthCredentialType, string>;
  __dumpProviderKeys(): Map<string, string>;
  __reset(): void;
}

/**
 * Create a jest.Mocked<IAuthSecretsService> seeded from an in-memory Map.
 * Every method is a jest.fn that actually mutates/reads the Map, so tests
 * can both drive behavior and assert call counts.
 */
export function createMockAuthSecretsService(
  overrides?: MockAuthSecretsOverrides,
): MockAuthSecretsService {
  const credentials = new Map<AuthCredentialType, string>();
  const providerKeys = new Map<string, string>();

  // Seed
  if (overrides?.credentials) {
    for (const [key, value] of Object.entries(overrides.credentials) as [
      AuthCredentialType,
      string,
    ][]) {
      if (value) credentials.set(key, value);
    }
  }
  if (overrides?.providerKeys) {
    for (const [providerId, value] of Object.entries(overrides.providerKeys)) {
      if (value) providerKeys.set(providerId, value);
    }
  }

  const mock: MockAuthSecretsService = {
    getCredential: jest.fn(async (type: AuthCredentialType) =>
      credentials.get(type),
    ),
    setCredential: jest.fn(async (type: AuthCredentialType, value: string) => {
      const trimmed = value?.trim() ?? '';
      if (!trimmed) {
        credentials.delete(type);
      } else {
        credentials.set(type, trimmed);
      }
    }),
    deleteCredential: jest.fn(async (type: AuthCredentialType) => {
      credentials.delete(type);
    }),
    hasCredential: jest.fn(async (type: AuthCredentialType) => {
      const v = credentials.get(type);
      return !!v && v.length > 0;
    }),

    getProviderKey: jest.fn(async (providerId: string) =>
      providerKeys.get(providerId),
    ),
    setProviderKey: jest.fn(async (providerId: string, value: string) => {
      const trimmed = value?.trim() ?? '';
      if (!trimmed) {
        providerKeys.delete(providerId);
      } else {
        providerKeys.set(providerId, trimmed);
      }
    }),
    deleteProviderKey: jest.fn(async (providerId: string) => {
      providerKeys.delete(providerId);
    }),
    hasProviderKey: jest.fn(async (providerId: string) => {
      const v = providerKeys.get(providerId);
      return !!v && v.length > 0;
    }),

    __dumpCredentials: () => new Map(credentials),
    __dumpProviderKeys: () => new Map(providerKeys),
    __reset: () => {
      credentials.clear();
      providerKeys.clear();
    },
  };

  return mock;
}

/**
 * Type-only re-export so downstream specs can `jest.Mocked<AuthSecretsService>`
 * without importing the implementation class directly.
 */
export type MockedAuthSecretsService = jest.Mocked<AuthSecretsService>;
