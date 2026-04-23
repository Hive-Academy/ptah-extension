/**
 * `@ptah-extension/platform-core/testing` — platform provider mocks + contract
 * harness. See `.ptah/specs/TASK_2025_294/implementation-plan.md` §3.2.
 *
 * Two public surfaces live here:
 *   1. `mocks/*` — `createMock*` factories returning `jest.Mocked<I...>` with
 *      in-memory stores. Consumed by downstream specs that need a stand-in for
 *      any `IPlatform*` dep.
 *   2. `contracts/*` — `run*Contract(name, createProvider)` runners that wrap
 *      the same behavioural suite around both `platform-vscode` and
 *      `platform-electron` impls to catch divergence before release.
 */

export * from './mocks';
export * from './contracts';
