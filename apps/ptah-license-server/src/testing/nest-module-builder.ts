/**
 * Lightweight NestJS-style testing module builder for the license server.
 *
 * **Why manual instead of `@nestjs/testing`**: `@nestjs/testing` is not
 * declared in this workspace's package.json (only `@nestjs/common`,
 * `@nestjs/core`, `@nestjs/config`, etc.). Rather than require a new
 * dependency to unblock W0.B4, this harness implements a minimal
 * `Test.createTestingModule`-compatible surface covering what license-
 * server specs actually need:
 *
 *   - `.get(token)` for retrieving providers by class/string/symbol.
 *   - Factory provider resolution (`useFactory` + `inject`).
 *   - Class providers with `@Inject()`/constructor param auto-wire (from
 *     `reflect-metadata` `design:paramtypes` plus a per-class
 *     `__nestInjectTokens__` registry we populate here).
 *   - `.overrideProvider(token).useValue(...)` chaining.
 *
 * Defaults applied:
 *   - `PrismaService` → `createMockPrisma()` via `useValue`.
 *   - `ConfigService` → a mock with `get(key, default?)` backed by an
 *     in-memory map (seeded from `options.config`).
 *
 * If we later adopt `@nestjs/testing` as a devDependency, this file can
 * be swapped to delegate to it with zero spec churn since the public
 * surface (`createTestingNestModule`, `.get()`, `.overrideProvider`) is
 * the same shape.
 */

import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { Type } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrisma, type MockPrisma } from './mock-prisma.factory';

type InjectionToken =
  | Type<unknown>
  | string
  | symbol
  | { new (...args: never[]): unknown };

interface ValueProvider {
  provide: InjectionToken;
  useValue: unknown;
}

interface ClassProvider {
  provide: InjectionToken;
  useClass: Type<unknown>;
}

interface FactoryProvider {
  provide: InjectionToken;
  useFactory: (...args: unknown[]) => unknown;
  inject?: InjectionToken[];
}

export type Provider =
  | ValueProvider
  | ClassProvider
  | FactoryProvider
  | Type<unknown>;

/** Minimal `TestingModule` surface. */
export interface TestingModule {
  get<T = unknown>(token: InjectionToken): T;
}

/** Per-call configuration for `createTestingNestModule`. */
export interface CreateTestingNestModuleOptions {
  /** Reserved for forward-compat with @nestjs/testing (unused today). */
  imports?: unknown[];
  /** Providers to register (class, value, factory). */
  providers?: Provider[];
  /** Reserved for controllers when we wire `@nestjs/testing`. */
  controllers?: Type<unknown>[];
  /**
   * Per-token override map. Applied after providers are registered; last
   * write wins, mirroring `.overrideProvider()`.
   */
  overrides?: Array<{ token: InjectionToken; useValue: unknown }>;
  /** Seed values for the mock ConfigService. */
  config?: Record<string, unknown>;
  /** Optional pre-built MockPrisma. Defaults to a fresh instance. */
  prisma?: MockPrisma;
}

/** Result bundle returned from `createTestingNestModule`. */
export interface CreateTestingNestModuleResult {
  module: TestingModule;
  prisma: MockPrisma;
  config: Record<string, unknown>;
}

function isClassProvider(p: Provider): p is ClassProvider {
  return typeof p === 'object' && 'useClass' in p;
}

function isFactoryProvider(p: Provider): p is FactoryProvider {
  return typeof p === 'object' && 'useFactory' in p;
}

function isValueProvider(p: Provider): p is ValueProvider {
  return typeof p === 'object' && 'useValue' in p;
}

function tokenLabel(token: InjectionToken): string {
  if (typeof token === 'function') return token.name || '[Function]';
  return String(token);
}

/**
 * Register an injection token for a specific constructor parameter.
 * Spec code calls this when a service uses an `@Inject()` token so the
 * manual harness can resolve it.
 *
 * In production, NestJS's `@Inject()` decorator does the same via
 * `reflect-metadata`. We cannot rely on it here without depending on
 * `@nestjs/common`'s internal metadata keys — fortunately, they ARE
 * exported and compatible. We read `self:paramtypes` / `design:paramtypes`.
 */
function resolveClassDeps(cls: Type<unknown>): InjectionToken[] {
  // Nest stores `@Inject()` overrides at `self:paramtypes` as
  //   [{ index: number, param: InjectionToken }, ...]
  // and the default reflected types at `design:paramtypes`.
  const injectMetadata: Array<{ index: number; param: InjectionToken }> =
    Reflect.getMetadata('self:paramtypes', cls) ?? [];
  const designTypes: Array<Type<unknown> | undefined> =
    Reflect.getMetadata('design:paramtypes', cls) ?? [];

  const count = Math.max(
    designTypes.length,
    injectMetadata.reduce((m, e) => Math.max(m, e.index + 1), 0),
  );

  const deps: InjectionToken[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const explicit = injectMetadata.find((e) => e.index === i);
    if (explicit) {
      deps[i] = explicit.param;
    } else if (designTypes[i]) {
      deps[i] = designTypes[i] as Type<unknown>;
    } else {
      deps[i] = cls; // unresolvable; will throw on lookup.
    }
  }
  return deps;
}

/**
 * Build a compiled test module with Prisma + Config pre-mocked.
 *
 * ```ts
 * const { module, prisma } = await createTestingNestModule({
 *   providers: [SampleService],
 *   config: { FOO: 'bar' },
 * });
 * const svc = module.get(SampleService);
 * ```
 */
export async function createTestingNestModule(
  options: CreateTestingNestModuleOptions = {},
): Promise<CreateTestingNestModuleResult> {
  const prisma = options.prisma ?? createMockPrisma();
  const config = { ...(options.config ?? {}) };

  const mockConfigService: Pick<ConfigService, 'get'> = {
    get: <T = unknown>(key: string, defaultValue?: T): T => {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        return config[key] as T;
      }
      return defaultValue as T;
    },
  };

  // Canonicalise providers — class shorthand becomes { provide, useClass }.
  const providers: Array<ValueProvider | ClassProvider | FactoryProvider> = [
    { provide: PrismaService, useValue: prisma },
    { provide: ConfigService, useValue: mockConfigService },
    ...(options.providers ?? []).map((p) => {
      if (typeof p === 'function') {
        return { provide: p, useClass: p } as ClassProvider;
      }
      return p;
    }),
  ];

  // Apply overrides — append a new value provider for each to shadow prior.
  for (const override of options.overrides ?? []) {
    providers.push({ provide: override.token, useValue: override.useValue });
  }

  // Build a token -> provider map (last write wins).
  const providerByToken = new Map<InjectionToken, Provider>();
  for (const p of providers) {
    providerByToken.set((p as { provide: InjectionToken }).provide, p);
  }

  const instances = new Map<InjectionToken, unknown>();
  const resolving = new Set<InjectionToken>();

  const resolve = (token: InjectionToken): unknown => {
    if (instances.has(token)) return instances.get(token);
    if (resolving.has(token)) {
      throw new Error(
        `[createTestingNestModule] Circular dependency detected for ${tokenLabel(token)}`,
      );
    }
    const provider = providerByToken.get(token);
    if (!provider) {
      throw new Error(
        `[createTestingNestModule] No provider for token ${tokenLabel(token)}`,
      );
    }
    resolving.add(token);
    try {
      let instance: unknown;
      if (isValueProvider(provider)) {
        instance = provider.useValue;
      } else if (isFactoryProvider(provider)) {
        const injected = (provider.inject ?? []).map((t) => resolve(t));
        instance = provider.useFactory(...injected);
      } else if (isClassProvider(provider)) {
        const cls = provider.useClass;
        const deps = resolveClassDeps(cls).map((t) => resolve(t));
        instance = new cls(...(deps as never[]));
      } else {
        throw new Error(
          `[createTestingNestModule] Unsupported provider shape for ${tokenLabel(token)}`,
        );
      }
      instances.set(token, instance);
      return instance;
    } finally {
      resolving.delete(token);
    }
  };

  const module: TestingModule = {
    get<T = unknown>(token: InjectionToken): T {
      return resolve(token) as T;
    },
  };

  return { module, prisma, config };
}
