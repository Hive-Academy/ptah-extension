import {
  SURFACE_LIMITS,
  SURFACE_STORE_LIMITS,
  segmentPtahUi,
  type CompilePtahUiBlockResult,
  type CompiledPtahUiBlock,
  type PtahUiSourceName,
  type RenderPtahUiBlockResult,
  type SurfaceComponent,
  type SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  displayFenceKey,
  type PtahUiDisplayFenceStatus,
} from '../../services/ptah-ui-display-dock';

/**
 * One top-level assistant text node that holds at least one display fence
 * line (TASK_2026_623, D3). The transcript publishes these in transcript
 * order; the panel is a pure function of them (R2.9).
 */
export interface DisplayCandidate {
  /** `messageId:nodeId`. */
  readonly blockKey: string;
  readonly messageId: string;
  readonly nodeId: string;
  /** Transcript order of the owning message; higher is newer. */
  readonly orderKey: number;
  /** The node's text, streaming tail included. */
  readonly text: string;
  /** The id of the user message that opened the turn. */
  readonly turnKey: string;
  /** The message is at or past the streaming boundary (its turn is streaming). */
  readonly live: boolean;
}

/** One agent surface in the tab's display panel. */
export interface DisplaySurface {
  /** `id:<id>` or `anon:<blockKey>:<ordinal>` (D11). */
  readonly key: string;
  /** The `<id>` of `ptah-ui display <id>`; `null` for an anonymous block. */
  readonly displayId: string | null;
  /** The validated content of the fence version the panel shows. */
  readonly content: SurfaceContent;
  readonly title: string | null;
  readonly description: string | null;
  /** The turn of the fence version the panel shows. */
  readonly turnKey: string;
  /** `displayFenceKey` of the fence version the panel shows. */
  readonly fenceKey: string;
  /** R2.8 position of the fence that created the surface. */
  readonly createdSeq: number;
  /** R2.8 position of the fence that last created or updated it. */
  readonly updatedSeq: number;
  /**
   * Converted component id -> signature (own fields, children by id). The D10
   * comparison input of the next computation.
   */
  readonly componentSignatures: ReadonlyMap<string, string>;
  /**
   * Component ids whose view state survives this version (D10): present in the
   * previous version of the same key with an identical converted form. Empty
   * for a surface the previous result did not hold.
   */
  readonly retainedViewStateIds: ReadonlySet<string>;
}

/** What happened to one display fence in R2.8 order. */
export interface DisplayFenceOutcome {
  /** `displayFenceKey(messageId, nodeId, ordinal)`; equals `blockKey:ordinal`. */
  readonly fenceKey: string;
  readonly turnKey: string;
  readonly live: boolean;
  readonly status: PtahUiDisplayFenceStatus;
}

export interface DisplaySurfacesResult {
  /** At most `maxSurfacesPerRoutingId`, in creation order. */
  readonly surfaces: readonly DisplaySurface[];
  /** Keyed by `displayFenceKey`; one entry per closed display fence. */
  readonly statuses: ReadonlyMap<string, PtahUiDisplayFenceStatus>;
  /** Every closed display fence, in R2.8 order. */
  readonly fences: readonly DisplayFenceOutcome[];
}

/** One closed display fence, compiled once (D5) and not yet resolved. */
export interface CompiledDisplayFence {
  readonly candidate: DisplayCandidate;
  readonly ordinal: number;
  readonly fenceKey: string;
  readonly displayId: string | null;
  readonly compiled: CompilePtahUiBlockResult;
}

export type DisplayCompile = (
  body: string,
  surfaceId: string,
) => CompilePtahUiBlockResult;

/** Resolves and validates one compiled fence; `fenceKey` identifies it. */
export type DisplayResolve = (
  compiled: CompiledPtahUiBlock,
  candidate: DisplayCandidate,
  fenceKey: string,
) => RenderPtahUiBlockResult;

/** Display ids beginning with this prefix belong to host content (D11, R2.5). */
const RESERVED_DISPLAY_ID_PREFIX = 'ptah.';
const RESERVED_REASON = 'reserved display id';
const INTERNAL_ERROR = 'internal error';
const ANON_SURFACE_ID_PREFIX = 'display-';

/**
 * The surface id an anonymous display block compiles with:
 * `display-<node id, id-safe>-<ordinal>`, within the surface id length cap.
 * It never starts with the reserved prefix.
 */
export function anonymousDisplaySurfaceId(
  nodeId: string,
  ordinal: number,
): string {
  const suffix = `-${ordinal}`;
  const room =
    SURFACE_LIMITS.maxSurfaceIdLength -
    ANON_SURFACE_ID_PREFIX.length -
    suffix.length;
  const safeNodeId = nodeId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, room);
  return `${ANON_SURFACE_ID_PREFIX}${safeNodeId}${suffix}`;
}

/** The panel key of a display fence (D11). */
export function displaySurfaceKey(
  displayId: string | null,
  blockKey: string,
  ordinal: number,
): string {
  return displayId === null ? `anon:${blockKey}:${ordinal}` : `id:${displayId}`;
}

/**
 * Candidates in R2.8 order: message order (`orderKey`), then the input order,
 * which the transcript gives in text-node order. Stable.
 */
function orderedCandidates(
  candidates: readonly DisplayCandidate[],
): readonly DisplayCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        a.candidate.orderKey - b.candidate.orderKey || a.index - b.index,
    )
    .map((entry) => entry.candidate);
}

/**
 * Segments every candidate and compiles each closed display fence once, in
 * R2.8 order. Unclosed (streaming) fences yield nothing (R2.7). Reads no host
 * source, so a source change never re-runs it.
 */
export function compileDisplayFences(
  candidates: readonly DisplayCandidate[],
  compile: DisplayCompile,
): readonly CompiledDisplayFence[] {
  const fences: CompiledDisplayFence[] = [];
  for (const candidate of orderedCandidates(candidates)) {
    for (const segment of segmentPtahUi(candidate.text)) {
      if (segment.kind !== 'fence' || segment.target !== 'display') continue;
      const displayId = segment.displayId ?? null;
      fences.push({
        candidate,
        ordinal: segment.ordinal,
        fenceKey: displayFenceKey(
          candidate.messageId,
          candidate.nodeId,
          segment.ordinal,
        ),
        displayId,
        compiled: compileFence(
          compile,
          segment.body,
          displayId,
          candidate,
          segment.ordinal,
        ),
      });
    }
  }
  return fences;
}

function compileFence(
  compile: DisplayCompile,
  body: string,
  displayId: string | null,
  candidate: DisplayCandidate,
  ordinal: number,
): CompilePtahUiBlockResult {
  if (displayId?.startsWith(RESERVED_DISPLAY_ID_PREFIX)) {
    return { ok: false, code: 'reserved-id', reason: RESERVED_REASON };
  }
  const surfaceId =
    displayId ?? anonymousDisplaySurfaceId(candidate.nodeId, ordinal);
  try {
    return compile(body, surfaceId);
  } catch {
    return { ok: false, reason: INTERNAL_ERROR };
  }
}

/** The host sources any compiled fence names; callers read only these. */
export function displayFenceSources(
  fences: readonly CompiledDisplayFence[],
): ReadonlySet<PtahUiSourceName> {
  const used = new Set<PtahUiSourceName>();
  for (const fence of fences) {
    if (fence.compiled.ok)
      for (const name of fence.compiled.usedSources) used.add(name);
  }
  return used;
}

interface Applied {
  readonly fence: CompiledDisplayFence;
  readonly key: string;
  readonly content: SurfaceContent;
  readonly title: string | null;
  readonly description: string | null;
  readonly signatures: ReadonlyMap<string, string>;
  readonly seq: number;
}

interface SurfaceEntry {
  readonly createdSeq: number;
  latest: Applied;
  /** Every fence applied to this surface since it was created. */
  readonly fenceKeys: string[];
}

/**
 * Resolves compiled fences in R2.8 order and applies the D11 id rule and the
 * surface cap (`SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`, LRU by create
 * or update). Pure: the same fences, resolve results and `previous` give an
 * equal result, so a reload rebuilds the panel (R2.9).
 *
 * - An invalid fence (compile or resolve failure, a reserved id) gets
 *   `invalid` and leaves the panel unchanged (R2.6).
 * - A valid fence whose key exists replaces that surface's content (R2.3); the
 *   fences it replaced become `superseded`.
 * - A new key over the cap drops the least recently created or updated
 *   surface; all its fences become `evicted` (R1.12).
 * - `previous` (the surfaces the dock holds) feeds the D10 view-state rule.
 */
export function applyDisplayFences(
  fences: readonly CompiledDisplayFence[],
  resolve: DisplayResolve,
  previous: readonly DisplaySurface[] | null,
): DisplaySurfacesResult {
  const cap = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;
  const statuses = new Map<string, PtahUiDisplayFenceStatus>();
  /** Insertion order is recency: an update deletes and re-inserts its key. */
  const live = new Map<string, SurfaceEntry>();

  fences.forEach((fence, seq) => {
    const applied = resolveFence(fence, resolve, seq);
    if ('reason' in applied) {
      statuses.set(fence.fenceKey, { kind: 'invalid', reason: applied.reason });
      return;
    }
    const existing = live.get(applied.key);
    if (existing !== undefined) {
      for (const key of existing.fenceKeys) {
        const status = statuses.get(key);
        if (status !== undefined && status.kind === 'applied')
          statuses.set(key, { ...status, kind: 'superseded' });
      }
      live.delete(applied.key);
      existing.latest = applied;
      existing.fenceKeys.push(fence.fenceKey);
      live.set(applied.key, existing);
    } else {
      live.set(applied.key, {
        createdSeq: seq,
        latest: applied,
        fenceKeys: [fence.fenceKey],
      });
      if (live.size > cap) evictOldest(live, statuses);
    }
    statuses.set(fence.fenceKey, {
      kind: 'applied',
      surfaceKey: applied.key,
      title: applied.title,
      description: applied.description,
    });
  });

  const previousByKey = new Map(
    (previous ?? []).map((surface) => [surface.key, surface] as const),
  );
  const surfaces = [...live.values()]
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((entry) => toSurface(entry, previousByKey.get(entry.latest.key)));

  return {
    surfaces,
    statuses,
    fences: fences.map((fence) => ({
      fenceKey: fence.fenceKey,
      turnKey: fence.candidate.turnKey,
      live: fence.candidate.live,
      // Every fence gets a status above.
      status: statuses.get(fence.fenceKey) as PtahUiDisplayFenceStatus,
    })),
  };
}

/**
 * `buildDisplaySurfaces(candidates, compile, resolve, previous)` (component
 * 5): compile then apply, in one call.
 */
export function buildDisplaySurfaces(
  candidates: readonly DisplayCandidate[],
  compile: DisplayCompile,
  resolve: DisplayResolve,
  previous: readonly DisplaySurface[] | null,
): DisplaySurfacesResult {
  return applyDisplayFences(
    compileDisplayFences(candidates, compile),
    resolve,
    previous,
  );
}

function evictOldest(
  live: Map<string, SurfaceEntry>,
  statuses: Map<string, PtahUiDisplayFenceStatus>,
): void {
  const [oldestKey, oldest] = live.entries().next().value as [
    string,
    SurfaceEntry,
  ];
  live.delete(oldestKey);
  for (const key of oldest.fenceKeys) {
    const status = statuses.get(key);
    if (status !== undefined && status.kind !== 'invalid')
      statuses.set(key, { ...status, kind: 'evicted' });
  }
}

function resolveFence(
  fence: CompiledDisplayFence,
  resolve: DisplayResolve,
  seq: number,
): Applied | { readonly reason: string } {
  const compiled = fence.compiled;
  if (!compiled.ok) return { reason: compiled.reason };
  let result: RenderPtahUiBlockResult;
  try {
    result = resolve(compiled, fence.candidate, fence.fenceKey);
  } catch {
    return { reason: INTERNAL_ERROR };
  }
  if (!result.ok) return { reason: result.reason };
  // Titles carry no source binding, so the converted envelope's title is the
  // resolved one.
  const envelope = compiled.conversion.envelope;
  return {
    fence,
    key: displaySurfaceKey(
      fence.displayId,
      fence.candidate.blockKey,
      fence.ordinal,
    ),
    content: result.content,
    title: textOrNull(envelope.title.text),
    description: textOrNull(envelope.description?.text),
    signatures: componentSignatures(envelope.components),
    seq,
  };
}

function toSurface(
  entry: SurfaceEntry,
  previous: DisplaySurface | undefined,
): DisplaySurface {
  const latest = entry.latest;
  return {
    key: latest.key,
    displayId: latest.fence.displayId,
    content: latest.content,
    title: latest.title,
    description: latest.description,
    turnKey: latest.fence.candidate.turnKey,
    fenceKey: latest.fence.fenceKey,
    createdSeq: entry.createdSeq,
    updatedSeq: latest.seq,
    componentSignatures: latest.signatures,
    retainedViewStateIds: retainedIds(previous, latest.signatures),
  };
}

/** D10: ids present before and after with an identical converted form. */
function retainedIds(
  previous: DisplaySurface | undefined,
  next: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const retained = new Set<string>();
  if (previous === undefined) return retained;
  for (const [id, signature] of next) {
    if (previous.componentSignatures.get(id) === signature) retained.add(id);
  }
  return retained;
}

/**
 * Converted form of each component, its children listed by id only, so a
 * change inside a container does not discard the container's own view state.
 */
function componentSignatures(
  components: readonly SurfaceComponent[],
): ReadonlyMap<string, string> {
  const signatures = new Map<string, string>();
  const visit = (list: readonly SurfaceComponent[]): void => {
    for (const component of list) {
      if ('children' in component) {
        const { children, ...own } = component;
        signatures.set(
          component.id,
          JSON.stringify({
            ...own,
            children: children.map((child) => child.id),
          }),
        );
        visit(children);
      } else {
        signatures.set(component.id, JSON.stringify(component));
      }
    }
  };
  visit(components);
  return signatures;
}

function textOrNull(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
