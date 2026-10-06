/**
 * Guards the shipped surface catalog reference (TASK_2026_594, Batch 11 /
 * plan F): the `ptah-surface-authoring` skill asset must document every kind
 * in `SURFACE_COMPONENT_KINDS` with exactly one fenced JSON example, and each
 * example must validate as a whole `dashboard-spec/2` + `dashboard-catalog/3`
 * document through `validateSurfaceDocument`. Examples are keyed by their
 * exact `### <kind>` heading, so `progress` cannot be satisfied by
 * `radial-progress` and `text` cannot be satisfied by `text-block`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { dashboardJsonBytes } from '@ptah-extension/shared/testing';
import {
  SURFACE_CATALOG_VERSION,
  SURFACE_COMPONENT_KINDS,
  SURFACE_SCHEMA_VERSION,
  validateSurfaceDocument,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const CATALOG_MD =
  'apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/' +
  'ptah-surface-authoring/references/catalog.md';

interface CatalogExample {
  /** The exact `###` heading text that owns the fence. */
  readonly kind: string;
  /** The fence info string, which must be `json`. */
  readonly fenceInfo: string;
  /** The raw fence body, parsed as JSON by the tests. */
  readonly source: string;
}

function parseCatalogExamples(text: string): CatalogExample[] {
  const entries: CatalogExample[] = [];
  let kind: string | null = null;
  let fenceInfo: string | null = null;
  let fenceLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^### (.+)$/.exec(line);
    if (fenceInfo === null && heading) {
      kind = heading[1].trim();
      continue;
    }
    const fence = /^```(.*)$/.exec(line);
    if (fence === null) {
      if (fenceInfo !== null) fenceLines.push(line);
      continue;
    }
    if (kind === null)
      throw new Error(`fence outside any kind section: ${line}`);
    if (fenceInfo === null) {
      fenceInfo = fence[1].trim();
      fenceLines = [];
      continue;
    }
    entries.push({ kind, fenceInfo, source: fenceLines.join('\n') });
    fenceInfo = null;
  }
  return entries;
}

function readCatalog(): string {
  return fs.readFileSync(path.join(findRepoRoot(), CATALOG_MD), 'utf8');
}

describe('shipped surface catalog reference', () => {
  const examples = parseCatalogExamples(readCatalog());

  it('documents exactly one fenced example per SURFACE_COMPONENT_KINDS kind', () => {
    const kinds = examples.map((entry) => entry.kind);
    expect(kinds).toHaveLength(SURFACE_COMPONENT_KINDS.length);
    expect(new Set(kinds)).toEqual(new Set([...SURFACE_COMPONENT_KINDS]));
  });

  it('keys every example by an exact kind heading and a json fence', () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const entry of examples) {
      expect([...SURFACE_COMPONENT_KINDS]).toContain(entry.kind);
      expect(entry.fenceInfo).toBe('json');
    }
  });

  it('renders each example under the heading kind it claims', () => {
    for (const entry of examples) {
      const component = JSON.parse(entry.source) as Record<string, unknown>;
      expect(component['kind']).toBe(entry.kind);
    }
  });

  it('validates every example inside a dashboard-spec/2 + dashboard-catalog/3 envelope', () => {
    for (const entry of examples) {
      const component = JSON.parse(entry.source);
      const document = {
        schemaVersion: SURFACE_SCHEMA_VERSION,
        catalogVersion: SURFACE_CATALOG_VERSION,
        surfaceId: 'catalog-example',
        title: { text: 'Catalog example' },
        components: [component],
      };
      const validated = validateSurfaceDocument(document, dashboardJsonBytes);
      if (!validated.ok) {
        throw new Error(
          `catalog example "${entry.kind}" is not a valid surface document: ${validated.reason}`,
        );
      }
    }
  });
});