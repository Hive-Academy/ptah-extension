import type { DashboardJsonByteCounter } from './dashboard-spec.validator';
import { convertPtahUi } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { resolvePtahUi } from './ptah-ui-resolver';
import type { SurfaceContent } from './surface.types';
import { validateSurfaceDocument } from './surface.validator';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';

export interface RenderPtahUiBlockInput {
  readonly surfaceId: string;
  readonly snapshot: TurnSourceSnapshot | null;
  readonly countBytes: DashboardJsonByteCounter;
}

export type RenderPtahUiBlockResult =
  | { readonly ok: true; readonly content: SurfaceContent }
  | { readonly ok: false; readonly reason: string };

/** Runs the complete untrusted ptah-ui fence boundary without throwing. */
export function renderPtahUiBlock(
  body: string,
  input: RenderPtahUiBlockInput,
): RenderPtahUiBlockResult {
  try {
    const parsed = parsePtahUi(body);
    if (!parsed.ok) return { ok: false, reason: parsed.failure.message };
    const content = resolvePtahUi(
      convertPtahUi(parsed.doc, input.surfaceId),
      input.snapshot,
    );
    const validated = validateSurfaceDocument(
      content.surface,
      input.countBytes,
    );
    if (!validated.ok) {
      return {
        ok: false,
        reason: validated.reason.startsWith('surface could not be validated:')
          ? 'internal error'
          : validated.reason,
      };
    }
    return {
      ok: true,
      content: {
        contract: 'dashboard-spec/2',
        surface: validated.surface,
        dataModel: validated.surface.dataModel ?? {},
      },
    };
  } catch {
    return { ok: false, reason: 'internal error' };
  }
}
