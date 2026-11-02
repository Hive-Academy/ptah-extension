/**
 * Public Anthropic list prices (USD per token) for the models the replay
 * scenarios show. The bridge adds them to every `config:pricing-get` answer so
 * the webview can price subagent messages. They live in code, not in scenario
 * data, because the scenario privacy rules treat `*Token` keys as credentials.
 */
const DEMO_PRICING = {
  'claude-opus-5-5': {
    inputCostPerToken: 4e-6,
    outputCostPerToken: 20e-6,
    cacheReadCostPerToken: 0.2e-6,
    cacheCreationCostPerToken: 5e-6,
    provider: 'anthropic',
  },
  'claude-sonnet-5-5': {
    inputCostPerToken: 2e-6,
    outputCostPerToken: 10e-6,
    cacheReadCostPerToken: 0.2e-6,
    cacheCreationCostPerToken: 2.5e-6,
    provider: 'anthropic',
  },
} as const;

export function withDemoPricing(data: unknown): unknown {
  const answer = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const pricing = answer['pricing'] && typeof answer['pricing'] === 'object' ? answer['pricing'] : {};
  return { ...answer, pricing: { ...DEMO_PRICING, ...pricing } };
}
