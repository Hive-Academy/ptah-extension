/**
 * The installed Codex CLI's own model catalog, from `codex debug models`.
 *
 * The CLI fetches `/models` with its own `client_version` and caches the
 * result, and the server hides each model from clients older than that model's
 * minimum version. So this catalog is the set this exact binary can run, in the
 * order the Codex `/model` menu shows it. Only `visibility: "list"` entries are
 * offered; hidden ones (internal review models, reserves) are not.
 */
import { z } from 'zod';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { CliModelInfo } from '../cli-adapter.interface';
import { spawnCli } from '../cli-adapter.utils';

const CodexCatalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      display_name: z.string().optional(),
      visibility: z.string().optional(),
      priority: z.number().optional(),
    }),
  ),
});

/**
 * Parse `codex debug models` stdout into the listed models, by `priority`
 * (the menu order). Anything unparseable yields `[]` so the caller falls back.
 */
export function parseCodexModelCatalog(stdout: string): CliModelInfo[] {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    // degradation-audit: optional-capability - an older CLI without
    // `debug models` prints an error; [] makes the adapter use its fallback list.
    return [];
  }
  const parsed = CodexCatalogSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.models
    .filter((model) => model.visibility === 'list')
    .map((model, index) => ({ model, index }))
    .sort(
      (a, b) =>
        (a.model.priority ?? Number.MAX_SAFE_INTEGER) -
          (b.model.priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map(({ model }) => ({
      id: model.slug,
      name: model.display_name?.trim() || model.slug,
    }));
}

/**
 * Run `codex debug models` and capture stdout. Never throws: resolves
 * `undefined` on timeout, spawn error, or empty output.
 */
export function probeCodexModelCatalog(
  binary: string,
  options: {
    readonly timeoutMs?: number;
    readonly spawner?: IProcessSpawner;
  } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = '';
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(binary, ['debug', 'models'], {
        spawner: options.spawner,
      });
    } catch {
      // degradation-audit: optional-capability - a spawn that throws means the
      // catalog is unreadable; undefined makes the adapter use its fallback list.
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, options.timeoutMs ?? 8000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      stdout += data;
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout.trim() || undefined);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}
