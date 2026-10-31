import type { ReplayMessage, ReplayMiss, ReplayScenarioData } from './types';

function subset(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length &&
    expected.every((value, index) => subset(value, actual[index]));
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => subset(value, (actual as Record<string, unknown>)[key]));
  }
  return Object.is(expected, actual);
}

export function createRpcResponder(
  getScenario: () => Promise<ReplayScenarioData>,
  inject: (message: ReplayMessage) => void,
  report: (kind: ReplayMiss['kind'], value: string) => void,
  onCall: (method: string, params: unknown) => void,
): (message: ReplayMessage) => void {
  return (message) => {
    const payload = message.payload ?? {};
    const method = payload['method'];
    const correlationId = payload['correlationId'];
    if (typeof method !== 'string' || typeof correlationId !== 'string') {
      report('unknown-outbound', 'invalid rpc:call');
      return;
    }
    onCall(method, payload['params']);
    void getScenario().then((scenario) => {
      const cases = scenario.rpcCases?.[method] ?? [];
      const selected = cases.find((entry) => subset(entry.match, payload['params'] ?? {}));
      const error = scenario.rpcErrors?.[method];
      let response: ReplayMessage;
      if (selected) response = { type: 'rpc:response', correlationId, success: true, data: selected.data };
      else if (error) response = { type: 'rpc:response', correlationId, success: false, error: error.error,
        ...(error.errorCode ? { errorCode: error.errorCode } : {}) };
      else if (Object.prototype.hasOwnProperty.call(scenario.rpc, method)) {
        response = { type: 'rpc:response', correlationId, success: true, data: scenario.rpc[method] };
      } else {
        report('unanswered-rpc', method);
        response = { type: 'rpc:response', correlationId, success: false, error: `No PtahCode replay answer for ${method}`, errorCode: 'REPLAY_MISS' };
      }
      queueMicrotask(() => inject(response));
    }).catch(() => undefined);
  };
}
