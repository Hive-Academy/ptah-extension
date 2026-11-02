# A3 — Remove Codex proxy consumers

## Summary

Removed Codex translation-proxy acquisition, one-shot auth, curator proxy entries, and DI registrations. Direct Codex requests to the pool, resolver (including draft override), and curator manager throw `AuthRequiredError` with `providerId: 'openai-codex'` and the native-runtime message. The SDK provider classifier remains pure for historical reads; the query launch gate rejects a stale Codex proxy token. Codex home/auth/account-usage services remain registered for the native runtime.

## Step 0 hit list

The required `git grep -n -E "SDK_CODEX_PROXY|CodexTranslationProxy|CODEX_PROXY_TOKEN_PLACEHOLDER|codexProxy|codex-translation-proxy|resolveCodexProxyPolicy|legacy-session-start" -- libs/ apps/` ran before edits. The 181 baseline hits below were reconstructed from `HEAD` to retain their original line numbers after edits. Each line is assigned to A3, A4, or A5. `A5 unlisted` means the inventory batch table did not name that file; later cleanup must review it, not assume it is dead.

```text
A5 unlisted | libs/backend/agent-sdk/src/lib/auth-env.port.ts:10:    | 'legacy-session-start';
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts:938:    coordinator.register('REAL-sdk-id', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts:1186:      coordinator.register('old-id', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:11:const ACTIVE: CompactionSessionClass = { codexProxy: false, e2Passed: true };
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:64:        coordinator.register(SID, { codexProxy: true, e2Passed: true }),
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:72:          coordinator.register(SID, { codexProxy: false, e2Passed }),
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:78:      coordinator.register(SID, { codexProxy: false, e2Passed: null });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:377:      coordinator.register(SID, { codexProxy: true, e2Passed: null });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts:445:      coordinator.register(SID, { codexProxy: true, e2Passed: null });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts:76:  return !sessionClass.codexProxy && sessionClass.e2Passed === true;
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-state.types.ts:77:  readonly codexProxy: boolean;
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.helpers.ts:89:    codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.coalesce.spec.ts:81:    coordinator.register(id, { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.coalesce.spec.ts:195:        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.coalesce.spec.ts:218:        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.coalesce.spec.ts:252:        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts:47:  coordinator.register('s', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts:551:    h.coordinator.register('new-s', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:178:            codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:506:  sessionBound(sessionId: string, runToken: string, codexProxy: boolean, nativeAnthropic?: boolean): void {
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:507:    this.enqueue({ type: 'session-bound', sessionId, runToken, codexProxy, nativeAnthropic });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:41:      readonly codexProxy: boolean;
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:188:  readonly codexProxy: boolean;
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:238:  sessionBound(sessionId: string, runToken: string, codexProxy: boolean): void;
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.spec.ts:18:  codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.spec.ts:107:    expect(gate({ ...state, codexProxy: true })).toBe('not-actable');
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.ts:53:  if (state.codexProxy) return 'not-actable';
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts:19:  codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts:131:      { ...step(initial, turn()).state, codexProxy: true },
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts:178:        codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts:431:        codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts:475:        codexProxy: false,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.ts:55:  if (state.codexProxy) return 'codex-proxy';
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.ts:113:        codexProxy: signal.codexProxy,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts:513:      coordinator.register('real-1', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts:549:      coordinator.register('real-1', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts:567:      coordinator.register('codex-1', { codexProxy: true, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts:582:      coordinator.register('real-1', { codexProxy: false, e2Passed: true });
A3 | libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:131:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A3 | libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:216:  if (authEnv.ANTHROPIC_AUTH_TOKEN === CODEX_PROXY_TOKEN_PLACEHOLDER) {
A3 | libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1803:      [CODEX_PROXY_TOKEN_PLACEHOLDER]: 'OpenAI Codex',
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:10:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:1321:      ANTHROPIC_AUTH_TOKEN: CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:1373:      CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.idle.spec.ts:174:    coordinator.register('current', { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.idle.spec.ts:175:    coordinator.register('new-id', { codexProxy: false, e2Passed: true });
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.idle-signals.spec.ts:134:    const [[sessionId, runToken, codexProxy]] = h.idle.sessionBound.mock.calls;
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.idle-signals.spec.ts:135:    expect([sessionId, codexProxy]).toEqual(['sdk', false]);
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:845:        register(id, { codexProxy: false, e2Passed: true }),
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:867:      codexProxy: false,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:876:  it('classes the Codex proxy route as codexProxy', async () => {
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:892:      codexProxy: true,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:1308:        codexProxy: false,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:69:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:154:          case CODEX_PROXY_TOKEN_PLACEHOLDER:
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:231:    codexProxy: boolean,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:505:        { sessionId: id, state, codexProxy: this.sessionClass.codexProxy },
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:512:        this.sessionClass.codexProxy,
A4 | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1632:        codexProxy: rec.capacityRoute?.providerId === 'openai-codex',
A5 unlisted | libs/backend/agent-sdk/src/lib/legacy-runtime-auth.spec.ts:56:      reason: 'legacy-session-start',
A5 unlisted | libs/backend/auth-providers-tokens/src/lib/tokens.ts:41:  SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy'),
A5 unlisted | libs/backend/auth-providers/src/index.ts:53:  resolveCodexProxyPolicy,
A5 unlisted | libs/backend/auth-providers/src/index.ts:116:  CodexTranslationProxy,
A5 unlisted | libs/backend/auth-providers/src/index.ts:121:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts:991:      { ...context, reason: 'legacy-session-start' as const },
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts:1062:        reason: 'legacy-session-start',
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-manager.ts:34:import { resolveCodexProxyPolicy } from './codex-proxy-policy';
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-manager.ts:167:      resolveCodexProxyPolicy(operationContext) !== 'native-return' &&
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-manager.ts:254:      resolveCodexProxyPolicy(operationContext) === 'native-return';
A5 unlisted | libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts:26:    'legacy-session-start',
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:5:import { resolveCodexProxyPolicy } from './codex-proxy-policy';
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:13:    'legacy-session-start',
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:17:    expect(resolveCodexProxyPolicy()).toBe('legacy-strategy');
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:24:        resolveCodexProxyPolicy({
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:35:      resolveCodexProxyPolicy({
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:41:      reason === 'legacy-session-start' ? 'legacy-strategy' : 'native-return',
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:49:        resolveCodexProxyPolicy({
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts:64:    expect(resolveCodexProxyPolicy(context)).toBe('legacy-strategy');
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts:6:export function resolveCodexProxyPolicy(
A5 | libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts:11:    context.reason !== 'legacy-session-start'
A3 | libs/backend/auth-providers/src/lib/auth/curator-proxy-manager.ts:6:import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../providers/codex';
A3 | libs/backend/auth-providers/src/lib/auth/curator-proxy-manager.ts:34:    codexProxy: ITranslationProxy,
A3 | libs/backend/auth-providers/src/lib/auth/curator-proxy-manager.ts:50:        { proxy: codexProxy, token: CODEX_PROXY_TOKEN_PLACEHOLDER },
A5 | libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts:23:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 | libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts:61:    ANTHROPIC_AUTH_TOKEN: CODEX_PROXY_TOKEN_PLACEHOLDER,
A3 | libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:82:  CodexTranslationProxy,
A3 | libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:83:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A3 | libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:507:          proxy: new CodexTranslationProxy(
A3 | libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:512:          authToken: CODEX_PROXY_TOKEN_PLACEHOLDER,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:169:  codexProxy: jest.Mocked<ITranslationProxy>;
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:186:  const codexProxy = createMockTranslationProxy();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:200:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:214:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:293:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts:299:      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts:52:    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY)
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts:53:    private readonly codexProxy: ITranslationProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts:71:    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:123:  codexProxy: jest.Mocked<ITranslationProxy>;
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:131:  const codexProxy = createMockTranslationProxy();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:140:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:149:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:219:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts:229:      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.ts:40:    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY)
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.ts:41:    private readonly codexProxy: ITranslationProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.ts:51:    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:10: *       * Stops codexProxy before configuring (cross-contamination guard).
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:169:  codexProxy: jest.Mocked<ITranslationProxy>;
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:180:  const codexProxy = createMockTranslationProxy();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:192:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:205:    codexProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:253:        expect(harness.codexProxy.stop).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:365:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:375:      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:392:        harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:419:        for (const proxy of [harness.codexProxy, harness.copilotProxy]) {
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:442:      { reason: 'legacy-session-start', hostNativeCodex: true },
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:443:      { reason: 'legacy-session-start', hostNativeCodex: false },
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:447:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:464:      expect(harness.codexProxy.start).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:465:      expect(harness.codexProxy.getUrl).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:480:      expect(harness.codexProxy.start).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:491:      expect(harness.codexProxy.start).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:583:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:587:      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:600:      harness.codexProxy.isRunning.mockReturnValue(true);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:605:      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:623:      harness.codexProxy.isRunning.mockReturnValue(false);
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts:628:      expect(harness.codexProxy.stop).not.toHaveBeenCalled();
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:21:import { resolveCodexProxyPolicy } from '../codex-proxy-policy';
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:54:    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY)
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:55:    private readonly codexProxy: ITranslationProxy,
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:69:      await this.stopProxyIfRunning(this.codexProxy, 'Codex');
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:77:    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:84:    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
A3 | libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:274:    if (resolveCodexProxyPolicy(operationContext) === 'native-return') {
A3 | libs/backend/auth-providers/src/lib/di/register.ts:38:import { CodexTranslationProxy } from '../providers/codex';
A3 | libs/backend/auth-providers/src/lib/di/register.ts:259:    { useClass: CodexTranslationProxy },
A5 | libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts:13:export const CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed';
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts:12:import { CodexTranslationProxy } from './codex-translation-proxy';
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts:123:    const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts:165:    const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts:253:    const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:9:import { CodexTranslationProxy } from './codex-translation-proxy';
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:122:      const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:227:      const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:318:  async function send429(proxy: CodexTranslationProxy): Promise<void> {
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:329:      new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:345:      new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts:366:    await send429(child.resolve(CodexTranslationProxy));
A4 | libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:30:export class CodexTranslationProxy extends TranslationProxyBase {
A4 | libs/backend/auth-providers/src/lib/providers/codex/index.ts:8:export { CodexTranslationProxy } from './codex-translation-proxy';
A4 | libs/backend/auth-providers/src/lib/providers/codex/index.ts:14:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A3 | libs/backend/auth-providers/src/lib/providers/register-providers.ts:42:  CodexTranslationProxy,
A3 | libs/backend/auth-providers/src/lib/providers/register-providers.ts:115:    AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY,
A3 | libs/backend/auth-providers/src/lib/providers/register-providers.ts:116:    { useClass: CodexTranslationProxy },
A5 unlisted | libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:21:import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../providers/codex/codex-provider.types';
A5 unlisted | libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:257:  it.each([CODEX_PROXY_TOKEN_PLACEHOLDER, OLLAMA_AUTH_TOKEN_PLACEHOLDER])(
A5 unlisted | libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:390:    ['a proxy placeholder', CODEX_PROXY_TOKEN_PLACEHOLDER],
A5 unlisted | libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:50:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:86:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:31:import { CodexTranslationProxy } from '../providers/codex/codex-translation-proxy';
A5 unlisted | libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts:2289:class CodexLaneProbe extends CodexTranslationProxy {
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:10: * `CodexTranslationProxy` running in THIS jest process on a loopback port.
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:22: * `CodexTranslationProxy`, so scenarios cannot leak state into each other.
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:53:import { CodexTranslationProxy } from '../providers/codex/codex-translation-proxy';
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:670: * `CodexTranslationProxy` are in-process `http.Server`s in THIS same
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:774:// Shared scenario scaffolding: temp project + REAL CodexTranslationProxy +
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:782:  readonly proxy: CodexTranslationProxy;
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:845:  const proxy = new CodexTranslationProxy(
A4 | libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:964:    'S1 Skill: real SDK/CLI calls the Skill tool with args forwarded, real CodexTranslationProxy relays to the (mocked) upstream, final result is success',
A5 unlisted | libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:18:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1606:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.idle-coalesce.spec.ts:24:    sessionClass: { codexProxy: boolean; e2Passed: boolean },
A5 unlisted | libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.idle-coalesce.spec.ts:114:    coordinator.register(sessionId, { codexProxy: false, e2Passed: true });
A5 unlisted | libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:70:  CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:1567:          ANTHROPIC_AUTH_TOKEN: CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:1591:            env?.ANTHROPIC_AUTH_TOKEN === CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:1615:          CODEX_PROXY_TOKEN_PLACEHOLDER,
A5 unlisted | libs/shared/src/lib/providers/proxy-token-placeholders.ts:12:export const CODEX_PROXY_TOKEN_PLACEHOLDER = 'codex-proxy-managed';
```

### Unlisted callers for later review

The `A5 unlisted` hits include live-looking consumers in compaction/session state, auth-manager policy calls, quota owner resolution, CLI registry, RPC handler specs, and the shared placeholder export. A4's session executor specs also contain references beyond its named implementation file. Their exact later ownership is unconfirmed; this batch leaves them intact.

## Files changed

- `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts` and `.spec.ts`: reject Codex acquisition, remove Codex construction/readiness and owner-key injection, replace the retired proxy quota test with a coded refusal test.
- `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts` and `.spec.ts`: reject Codex before quota/early returns and for draft overrides; remove Codex proxy authentication. Quota specs now use OpenRouter to keep testing non-Codex behavior.
- `libs/backend/auth-providers/src/lib/auth/curator-proxy-manager.ts` and `.spec.ts`: remove Codex proxy entry and injection; reject direct Codex `ensureProxy` calls.
- `libs/backend/auth-providers/src/lib/providers/register-providers.ts`, `libs/backend/auth-providers/src/lib/di/register.ts`: remove the two Codex proxy registrations and the curator factory argument. Codex native auth/home/usage registrations remain.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` and `.spec.ts`: retain pure Codex identity classification for historical reads; remove Codex from the missing-base-URL mapping. The runner now rejects the stale token at query launch.
- `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts`, `local-native.strategy.ts`, `local-proxy.strategy.ts` and their `.spec.ts` files: drop only the stranded Codex proxy injections/stop calls and their assertions. The OAuth strategy's native Codex return and explicit legacy failure remain.
- `libs/backend/auth-providers/src/lib/auth/draft-verification.service.spec.ts`: update the resolver constructor after removal of its Codex auth dependency.

No app composition-root guard entry referenced either removed token, so no guard changed. `libs/backend/auth-providers-tokens/src/lib/tokens.ts` still declares both symbols for A5. The proxy class, its specs, Codex index, translation helpers, policy, and session executor remain for A4/A5.

## Preserve list

- `ProviderProxyPool` still isolates Copilot, Kimi Code, OpenRouter, OpenCode, Sakana, LM Studio, and custom OpenAI proxies by workspace/credential.
- `ProviderAuthResolver` still resolves direct Anthropic, CLI, other API-key/OAuth/local providers, applies the quota gate, and builds per-provider draft snapshots.
- `CuratorProxyManager` still starts, reuses, idles, and disposes Copilot, OpenRouter, LM Studio, and Kimi Code proxies.
- Provider and curator DI still registers non-Codex proxies; Codex home, auth identity, account usage, and usage client remain registered.
- `SdkQueryOptionsBuilder` still recognizes non-Codex proxy placeholders and retains its MCP configuration logic.
- OAuth, local-native, and local-proxy strategies still configure Copilot, Kimi Code, Ollama, Ollama Cloud, and LM Studio with their existing proxy and watcher behavior.

## Decisions

| Decision | Reason |
| --- | --- |
| Reject Codex before shared-provider fallback in pool and resolver. | An old Codex request must fail with a coded native-runtime error even when the active provider or proxy slot differs. |
| Classify a stale Codex placeholder as `openai-codex` and reject it at the SDK query launch gate. | Keep model, cost, and provenance reads pure while preventing an SDK Codex proxy launch. |
| Keep Codex auth/home/usage and proxy-only definitions. | Native Codex still needs identity and usage; A4/A5 own deletion of the remaining proxy definitions and references. |
| Keep the quota tests on OpenRouter. | The quota gate still needs a non-Codex active-provider case after Codex is refused before the gate. |

## Open risks

- Tests, typecheck, lint, build, Nx, Jest, and diagnostics were prohibited and were not run. Static checks do not prove runtime behavior or cross-host compilation.
- `ptah_ast_analyze` returned clean parses for 16 of 17 edited TypeScript files. `provider-proxy-pool.spec.ts` had one recovered node; the same recovery occurs on its HEAD version, so this is not new evidence of a syntax regression.
- The Step 0 search found many references outside the explicit A3/A4/A5 file lists. A5 must inspect them before deleting the placeholder, policy, or compaction state. A4 must remove its own direct proxy references.
- Other concurrent worktree files were present/modified but were not edited for A3: `.ptah/specs/TASK_2026_714_c8a2/d9-live-failure-diagnosis.md`, `task-D9-fix1-report.md`, `task-D9-fix3-report.md`, and `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`, `.spec.ts`, `codex-protocol-validator.ts`, `.spec.ts`, `codex-session-history.spec.ts`.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0: 4,343 files scanned; 281 unsuppressed repository sites; `libs/backend/auth-providers` 21 against baseline 24; `libs/backend/agent-sdk` 4 against baseline 4. No baseline changed. `git diff --check` passed. Edited A3 files have LF and no BOM.

## Revision 1

Independent review: `code-logic-review-A3.md` (REVISE 6/10). The changes below address all seven findings. The revised audit exited 0: 4,344 files scanned, 281 unsuppressed sites; auth-providers 21/24, agent-sdk 4/4, skill-synthesis 1/5. No baseline changed. `git diff --check` passed. Tests, typecheck, lint, build, Nx, Jest, and diagnostics remained prohibited and were not run.

| Defect | Fix and location | Spec |
| --- | --- | --- |
| Pure provider classifier threw on historical Codex env. | `getActiveProviderId` returns `openai-codex` for a Codex placeholder after base-URL validation (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:208`). All actual SDK query calls share the refusal in `SdkQueryRunner.launch` (`sdk-query-runner.service.ts:347`), before `queryFn`; the provenance tap skips only refused Codex proxy envs (`:705`) and retains other providers' order. | `sdk-query-options-builder.spec.ts:2143`; `sdk-query-runner.service.spec.ts:695,1334,1369`. |
| Model/cost and runner specs retained stale expectations. | Historical pricing stays readable; the classifier is tested directly (`libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts:68`). Runner specs now expect coded refusal and no query for the stale placeholder; a later OpenRouter query still launches. | `model-resolver.spec.ts:68`; `sdk-query-runner.service.spec.ts:1334,1369`. |
| Lane resolver rethrew Codex auth refusal. | Map `AuthRequiredError` to the existing `auth-unresolvable` lane stall (`libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts:234`). Explicit and inherited Codex routes retain a coded refusal from the auth resolver; native runtime lanes do not use it. | `lane-resolver.service.spec.ts:255`; `provider-auth-resolver.spec.ts:1068`. |
| Codex cooldown was bypassed. | `ProviderAuthResolver.resolve` checks quota before native-runtime refusal (`libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:163`). | `provider-auth-resolver.spec.ts:1057`. |
| Draft probe treated Codex refusal as unknown. | The failure classifier recognizes only `AuthRequiredError` carrying `providerId: 'openai-codex'` (`libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:195,753`), and its detail uses a fixed safe message; other providers retain their prior classification. Editing this source file was necessary for the requested probe classification, in addition to the explicitly named spec. | `draft-verification.service.spec.ts:138,150,554`. |
| Refusal message was repeated. | `codex-native-runtime-refusal.ts:3,6` exports the auth-providers message and error factory, reused by the pool, resolver, curator manager, draft detail, and OAuth strategy. The agent-sdk launch gate keeps its identical literal because importing auth-providers into agent-sdk would create a dependency cycle. | Existing coded refusal specs plus runner and draft specs above. |
| Dead proxy-only symbols need later cleanup. | Kept A4/A5 definitions and harnesses intact; exact later work is listed below. | A4/A5 ownership, no deletion in A3. |

Revision 1 files edited: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, `.spec.ts`, `sdk-query-runner.service.ts`, `.spec.ts`; `libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts` (new), `provider-proxy-pool.ts`, `provider-auth-resolver.ts`, `.spec.ts`, `curator-proxy-manager.ts`, `strategies/oauth-proxy.strategy.ts`, `draft-verification.service.ts`, `.spec.ts`, `model-resolver.spec.ts`; `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts`, `.spec.ts`; and this report. No coordinator or other lane files were edited.

**A4 must:** delete `providers/codex/codex-translation-proxy.ts` and its direct specs (`codex-translation-proxy.spec.ts`, `codex-stream-parity.spec.ts`); remove exports from `providers/codex/index.ts` and `auth-providers/src/index.ts`; replace the real-Codex proxy harness in `translation/translation-proxy-base.spec.ts` and `translation/translation-proxy.sdk.integration.spec.ts` while preserving base-class coverage and all non-Codex translation helpers; remove Codex SDK accommodation in `agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` and its affected specs.

**A5 must:** remove the unregistered `SDK_CODEX_PROXY` and `SDK_CURATOR_CODEX_PROXY` declarations in `auth-providers-tokens/src/lib/tokens.ts`; review/remove proxy-only `ICodexOwnerKeySource` in `providers/codex/codex-provider.types.ts` and exports while keeping native account usage; remove `auth/codex-proxy-policy.ts` and its spec only after checking OAuth legacy refusal; review historical Codex proxy cases in `auth/model-resolver.spec.ts`, the placeholder readers in `agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`, and `auth-providers/src/lib/quota/provider-owner.resolver.ts`; review `agent-sdk/src/lib/detector/windows-hide-spawn.guard.spec.ts` and every `A5 unlisted` Step 0 hit before deleting shared placeholder/compaction symbols. Keep `@openai/codex-sdk`, native auth/home/usage, MCP, other providers, and shared translation helpers.

## Revision 2

Round 1 review: `code-logic-review-A3.md`. This revision takes the review's explicit-refusal option for R1-1. `SessionRuntimeIdentity` persists `providerId` but no auth method, so after a provider switch the resolver cannot safely reconstruct the old provider's credentials. A stored non-Codex session with a different active workspace provider now receives a coded `AuthRequiredError` naming the stored provider and explaining the mismatch. The user can restore that provider in Settings and retry. A second check at profile construction prevents a provider switch between the initial check and auth materialization. Same-provider sessions retain the existing profile path; native Codex resume and legacy Codex refusal retain their precedence.

| Defect | Fix and location | Spec |
| --- | --- | --- |
| R1-1: a stored Claude session in a Codex workspace reached Codex profile construction. | Compare the stored provider with credential-aware workspace auth before model/profile construction, then recheck at profile materialization; refuse a mismatch without borrowing another provider's auth (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:270-296,370-377,542`). | Unmocked resolver cases for stored Claude plus Codex workspace, stored legacy Codex identity, and a new Codex session without native support (`workspace-provider-profile-resolver.spec.ts:890,915,938`). |
| R1-2: model and CLI probes could load an SDK query with the stale Codex placeholder. | Skip both SDK model probe paths before loading the query (`libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:537,1043`). The named-account probe also has the certified env boundary, which strips auth selectors. CLI connection tests return an explicit failure and CLI agent spawns throw a coded `AuthRequiredError` before loading the query (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:588,816`). | `sdk-model-service.spec.ts:160`; `ptah-cli-registry-spawn-model.spec.ts:208,219`. |
| R1-3: workspace Codex refusal repeated the error literal. | Reuse `codexNativeRuntimeRequired` with its existing recovery hint (`workspace-provider-profile-resolver.ts:537`; `codex-native-runtime-refusal.ts:6`). | The unmocked legacy and new Codex cases above assert the coded refusal. |

Revision 2 files edited: `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts`, `.spec.ts`, `codex-native-runtime-refusal.ts`; `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`, `.spec.ts`; `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`, `ptah-cli-registry-spawn-model.spec.ts`; and this report. No `codex-runtime/*` or `agent-sdk/codex-app-server/*` files were edited in this revision. Non-Codex provider behavior and MCP assembly remain intact.

Static inspection: Ptah Tree-sitter reported clean parses for the seven changed TypeScript source/spec files inspected. All Revision 2 edited files have LF, no CR, and no BOM. The permitted degradation audit exited 0: 4,344 files scanned, 281 unsuppressed repository sites; agent-sdk 4/4, auth-providers 21/24, cli-agent-runtime 0/1 against its existing baseline. No baseline changed. Tests, typecheck, lint, build, Nx, Jest, and diagnostics were prohibited and were not run. The named-account Codex placeholder branch is defensive because certified named envs strip auth selectors by construction; it has no direct stale-placeholder fixture.
