/**
 * Model-list drift check (live).
 *
 * Vendors add and retire models every few weeks. Ptah reads live lists where
 * it can, but every provider also ships a fallback list, and OpenCode's route
 * table decides which IDs are callable at all. This suite compares each of
 * those lists with a public source and fails when one has drifted, so a
 * retired model is caught here instead of by a user.
 *
 * It makes REAL network calls to public, keyless endpoints, so it is
 * `describe.skip` unless `PTAH_LIVE_PROBES=1` is set. The weekly
 * `model-lists-probe.yml` workflow runs it and files an issue on failure.
 *
 * ```
 * PTAH_LIVE_PROBES=1 npx jest --config libs/backend/auth-providers/jest.config.ts \
 *   --testPathPatterns "model-lists.live"
 * ```
 *
 * Sources: OpenCode's own `/models` lists, `ollama.com/api/tags`, and
 * models.dev (OpenCode's public model registry) for vendors whose own list
 * needs a key. A models.dev gap is a signal to check the vendor, not proof.
 */
import 'reflect-metadata';
import {
  OPENCODE_MODEL_ROUTES,
  getAnthropicProvider,
  type OpenCodeProviderId,
} from '@ptah-extension/shared';
import { KNOWN_CLOUD_MODELS } from './providers/local/ollama-model-discovery.service';

const live = process.env['PTAH_LIVE_PROBES'] === '1';
const describeLive = live ? describe : describe.skip;

interface ModelsDevProvider {
  readonly npm?: string;
  readonly models: Record<
    string,
    { readonly provider?: { readonly npm?: string } }
  >;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Ptah-Extension/model-list-drift' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

/** models.dev package → OpenCode protocol, as in opencode-model-routes.ts. */
const NPM_PROTOCOL: Record<string, string> = {
  '@ai-sdk/anthropic': 'messages',
  '@ai-sdk/openai': 'responses',
  '@ai-sdk/openai-compatible': 'chat/completions',
};

/**
 * Live OpenCode IDs Ptah deliberately does not route: protocols Ptah has no
 * translator for (Google generateContent, Jev systemone), and IDs whose
 * protocol no source settles. Each needs a keyed test request to prove its
 * protocol before it can join the route table.
 */
const OPENCODE_UNROUTED: Record<OpenCodeProviderId, readonly string[]> = {
  'opencode-zen': ['jev-1.13', 'jev-1.13-free'],
  'opencode-go': [
    'kimi-k2.5',
    'glm-5',
    'deepseek-flash',
    'qwen3.5-plus',
    'mimo-v2-pro',
    'mimo-v2-omni',
    'hy3-preview',
    'omen-alpha',
  ],
};

/**
 * Static fallback IDs a vendor serves but models.dev has not published yet,
 * each checked against the vendor directly.
 */
const MODELS_DEV_GAPS: Record<string, readonly string[]> = {
  // Served to the native Claude login (checked with `claude -p`, 2026-10-07).
  'claude-cli': ['claude-haiku-5-5'],
};

describeLive('model-list drift (live)', () => {
  jest.setTimeout(120_000);

  let modelsDev: Record<string, ModelsDevProvider>;
  beforeAll(async () => {
    modelsDev = await getJson('https://models.dev/api.json');
  });

  describe.each([
    ['opencode-zen', 'opencode'],
    ['opencode-go', 'opencode-go'],
  ] as const)('%s route table', (providerId, modelsDevId) => {
    let liveIds: Set<string>;
    beforeAll(async () => {
      const baseUrl = getAnthropicProvider(providerId)?.baseUrl;
      const body = await getJson<{ data: { id: string }[] }>(
        `${baseUrl}/models`,
      );
      liveIds = new Set(body.data.map((m) => m.id));
    });

    it('routes no model OpenCode has retired', () => {
      const retired = Object.keys(OPENCODE_MODEL_ROUTES[providerId]).filter(
        (id) => !liveIds.has(id),
      );
      expect(retired).toEqual([]);
    });

    it('routes or deliberately excludes every model OpenCode serves', () => {
      const registry = modelsDev[modelsDevId];
      const routed = OPENCODE_MODEL_ROUTES[providerId];
      const unrouted = [...liveIds]
        .filter((id) => !(id in routed))
        .filter((id) => !OPENCODE_UNROUTED[providerId].includes(id))
        .filter((id) => {
          const npm = registry?.models[id]?.provider?.npm ?? registry?.npm;
          return npm !== '@ai-sdk/google';
        })
        .map((id) => {
          const npm = registry?.models[id]?.provider?.npm ?? registry?.npm;
          return `${id} (models.dev suggests ${npm ? (NPM_PROTOCOL[npm] ?? npm) : 'nothing'})`;
        });
      expect(unrouted).toEqual([]);
    });
  });

  describe('Ollama Cloud fallback catalog', () => {
    let liveNames: Set<string>;
    beforeAll(async () => {
      const body = await getJson<{ models: { name: string }[] }>(
        'https://ollama.com/api/tags',
      );
      liveNames = new Set(body.models.map((m) => m.name));
    });

    it('lists no model ollama.com has stopped serving', () => {
      expect(
        Object.keys(KNOWN_CLOUD_MODELS).filter((id) => !liveNames.has(id)),
      ).toEqual([]);
    });

    it('has metadata for every model ollama.com serves', () => {
      expect(
        [...liveNames].filter((id) => !(id in KNOWN_CLOUD_MODELS)),
      ).toEqual([]);
    });
  });

  it.each([
    ['z-ai', 'zai'],
    ['claude-cli', 'anthropic'],
    ['github-copilot', 'github-copilot'],
    ['moonshot', 'moonshotai'],
    ['sakana', 'sakana'],
  ])(
    '%s fallback list names only models models.dev lists',
    (providerId, modelsDevId) => {
      const known = new Set(Object.keys(modelsDev[modelsDevId]?.models ?? {}));
      const gaps = MODELS_DEV_GAPS[providerId] ?? [];
      const unknown = (getAnthropicProvider(providerId)?.staticModels ?? [])
        .map((m) => m.id)
        .filter((id) => !known.has(id) && !gaps.includes(id));
      expect(unknown).toEqual([]);
    },
  );
});
