import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  panelManifestSchema,
  type PanelManifest,
} from '../../labelling/model-panel';

const RUBRIC_PANEL_MANIFEST_PATH = [
  'labelling',
  'merged',
  'u1-rubric.manifest.json',
] as const;

export type RubricPanelManifestLoadResult =
  | { readonly ok: true; readonly panel: PanelManifest }
  | {
      readonly ok: false;
      readonly reason: 'panel-manifest-missing' | 'panel-manifest-invalid';
    };

/** Reads private U1 panel provenance without surfacing manifest bytes. */
export function loadRubricPanelManifest(
  benchDataDir: string,
): RubricPanelManifestLoadResult {
  const path = join(benchDataDir, ...RUBRIC_PANEL_MANIFEST_PATH);
  if (!existsSync(path)) return { ok: false, reason: 'panel-manifest-missing' };
  try {
    return {
      ok: true,
      panel: panelManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8'))),
    };
  } catch {
    return { ok: false, reason: 'panel-manifest-invalid' };
  }
}
