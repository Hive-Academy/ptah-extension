import type { DashboardJsonByteCounter } from './dashboard-spec.validator';
import type { PtahUiAgentsInput } from './ptah-ui-agents-source';
import { convertPtahUi, type PtahUiConversion } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { resolvePtahUi, type PtahUiLimitsInput } from './ptah-ui-resolver';
import type { PtahUiParseFailureCode, PtahUiSourceName } from './ptah-ui.types';
import type { SurfaceContent } from './surface.types';
import { validateSurfaceDocument } from './surface.validator';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';

export interface RenderPtahUiBlockInput {
  readonly surfaceId: string;
  readonly snapshot: TurnSourceSnapshot | null;
  /** Live `$agents` facts; absent or null renders `$agents` unavailable (D5). */
  readonly agents?: PtahUiAgentsInput | null;
  /** The latest lane plan-limit read; absent or null renders `$limits` unavailable. */
  readonly limits?: PtahUiLimitsInput | null;
  readonly countBytes: DashboardJsonByteCounter;
}

/** Everything a compiled block needs to resolve; the surface id is compiled in. */
export type ResolvePtahUiBlockInput = Omit<RenderPtahUiBlockInput, 'surfaceId'>;

export type RenderPtahUiBlockResult =
  | { readonly ok: true; readonly content: SurfaceContent }
  | { readonly ok: false; readonly reason: string };

/** A parsed and converted block, computed once per body (D5). */
export interface CompiledPtahUiBlock {
  readonly ok: true;
  readonly conversion: PtahUiConversion;
  /** The host sources the block names; callers compute only these inputs. */
  readonly usedSources: ReadonlySet<PtahUiSourceName>;
}

export type CompilePtahUiBlockResult =
  | CompiledPtahUiBlock
  | {
      readonly ok: false;
      /** Absent for an internal error. */
      readonly code?: PtahUiParseFailureCode;
      readonly reason: string;
    };

/** Display ids beginning with this prefix belong to host content (D11, R2.5). */
const RESERVED_SURFACE_ID_PREFIX = 'ptah.';

/** Parses and converts an untrusted fence body once, without throwing. */
export function compilePtahUiBlock(
  body: string,
  surfaceId: string,
): CompilePtahUiBlockResult {
  if (surfaceId.startsWith(RESERVED_SURFACE_ID_PREFIX))
    return { ok: false, code: 'reserved-id', reason: 'reserved display id' };
  try {
    const parsed = parsePtahUi(body);
    if (!parsed.ok)
      return {
        ok: false,
        code: parsed.failure.code,
        reason: parsed.failure.message,
      };
    const conversion = convertPtahUi(parsed.doc, surfaceId);
    return {
      ok: true,
      conversion,
      usedSources: new Set(
        conversion.bindings.map((binding) => binding.source),
      ),
    };
  } catch {
    return { ok: false, reason: 'internal error' };
  }
}

/**
 * Resolves a compiled block against the current sources and validates the
 * result. Invalid output falls back atomically: no partial surface (R2.6).
 */
export function resolveCompiledPtahUiBlock(
  compiled: CompiledPtahUiBlock,
  input: ResolvePtahUiBlockInput,
): RenderPtahUiBlockResult {
  try {
    const content = resolvePtahUi(compiled.conversion, input.snapshot, {
      agents: input.agents,
      limits: input.limits,
    });
    const validated = validateSurfaceDocument(
      content.surface,
      input.countBytes,
    );
    if (!validated.ok) {
      return {
        ok: false,
        reason: validationFailureReason(validated.reason),
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

/** Runs the complete untrusted ptah-ui fence boundary without throwing. */
export function renderPtahUiBlock(
  body: string,
  input: RenderPtahUiBlockInput,
): RenderPtahUiBlockResult {
  const compiled = compilePtahUiBlock(body, input.surfaceId);
  if (!compiled.ok) return { ok: false, reason: compiled.reason };
  return resolveCompiledPtahUiBlock(compiled, input);
}

/**
 * Short, fixed reasons for validator failures: no zod paths reach the user. A
 * breached catalog budget is named in the parser's words, e.g.
 * `maxTreeDepth (8) exceeded` (R3.3).
 */
function validationFailureReason(reason: string): string {
  if (reason.startsWith('surface could not be validated:'))
    return 'internal error';
  const breached = /\bover the (max[A-Za-z]+) limit of (\d+)\b/.exec(reason);
  if (breached !== null) return `${breached[1]} (${breached[2]}) exceeded`;
  if (/\b(?:max|limit|budget)\b/i.test(reason))
    return 'block exceeds a display limit';
  if (/\brow\b/i.test(reason)) return 'invalid table row';
  return 'invalid display content';
}
