import { z } from 'zod';
// Type-only: the eager sync service imports this module, so it holds no
// runtime import of the lazy `display-panel` / `turn-recap` entries. The
// artifact record schema is loaded on demand (the `artifact.store.ts` rule).
import type { DisplaySurface } from '@ptah-extension/chat-ui/display-panel';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import type {
  ArtifactRecord,
  DisplayWindowAction,
  DisplayWindowActionPushPayload,
  DisplayWindowJsonObject,
  DisplayWindowJsonValue,
} from '@ptah-extension/shared';
import type { ArtifactRecordSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import type { DisplayDockSelection } from '../display-dock/display-dock.state';

/**
 * The wire shape of the detached Display window (TASK_2026_853_3401, D4).
 *
 * The main renderer builds a `DisplayWindowView` from the bound tab's dock and
 * turns it into JSON with {@link toWire} (Maps and Sets become arrays). The
 * child window parses it back with {@link parseWireState}, which validates
 * every field before it reaches view state. Pure functions; no Angular.
 */

/** Bumped when the wire shape changes; a mismatched snapshot is refused. */
export const DISPLAY_WINDOW_WIRE_VERSION = 1;

/** Same strings as the display panel's strip keys (see `display-sheet.component.ts`). */
export const DISPLAY_WINDOW_SUMMARY_KEY = 'summary';
export const DISPLAY_WINDOW_ARTIFACT_KEY_PREFIX = 'artifact:';

export type DisplayWindowThemeMode = 'dark' | 'light';

/** What the detached window's display panel renders, for one tab. */
export interface DisplayWindowView {
  readonly theme: {
    readonly name: string;
    readonly mode: DisplayWindowThemeMode;
  };
  readonly open: boolean;
  readonly pinned: boolean;
  /** Strip items in the panel: summary (when present), surfaces and artifacts. */
  readonly count: number;
  readonly selectedKey: string | null;
  readonly scrollToSelectedOnMount: boolean;
  readonly fullscreenArtifactId: string | null;
  readonly summary: TurnSummaryModel | null;
  readonly summaryTurnKey: string;
  readonly surfaces: readonly DisplaySurface[];
  readonly viewStates: ReadonlyMap<string, SurfaceViewState>;
  readonly artifacts: readonly ArtifactRecord[];
  readonly actionError: string | null;
  /**
   * Shown in place of the panel when the main renderer cannot send content
   * (the snapshot is too large, or no chat tab is bound); `null` otherwise.
   */
  readonly notice: string | null;
}

/** A parsed snapshot: the tab it belongs to, its revision and its view. */
export interface DisplayWindowParsedSnapshot {
  readonly tabId: string;
  readonly revision: number;
  readonly view: DisplayWindowView;
}

// ---------------------------------------------------------------------------
// Strip key <-> dock selection
// ---------------------------------------------------------------------------

/** The panel strip key of a dock selection; `null` lets the panel pick. */
export function selectionKey(selection: DisplayDockSelection): string | null {
  if (selection === null) return null;
  if (selection.kind === 'summary') return DISPLAY_WINDOW_SUMMARY_KEY;
  if (selection.kind === 'artifact') {
    return `${DISPLAY_WINDOW_ARTIFACT_KEY_PREFIX}${selection.artifactId}`;
  }
  return selection.surfaceKey;
}

/** The dock selection a panel strip key denotes. */
export function selectionForKey(key: string): DisplayDockSelection {
  if (key === DISPLAY_WINDOW_SUMMARY_KEY) return { kind: 'summary' };
  if (key.startsWith(DISPLAY_WINDOW_ARTIFACT_KEY_PREFIX)) {
    return {
      kind: 'artifact',
      artifactId: key.slice(DISPLAY_WINDOW_ARTIFACT_KEY_PREFIX.length),
    };
  }
  return { kind: 'surface', surfaceKey: key };
}

// ---------------------------------------------------------------------------
// JSON conversion
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON copy of `value`: Maps become `[key, value]` arrays, Sets become
 * arrays, `undefined` properties and functions are dropped, and a non-finite
 * number becomes `null` (what `JSON.stringify` would write).
 */
export function toJsonValue(value: unknown): DisplayWindowJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Map) {
    return [...value.entries()].map(([key, entry]) => [
      toJsonValue(key),
      toJsonValue(entry),
    ]);
  }
  if (value instanceof Set)
    return [...value].map((entry) => toJsonValue(entry));
  if (Array.isArray(value))
    return value.map((entry: unknown) => toJsonValue(entry));
  if (isPlainObject(value)) {
    const out: Record<string, DisplayWindowJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function') continue;
      out[key] = toJsonValue(entry);
    }
    return out;
  }
  return null;
}

function isJsonObject(
  value: DisplayWindowJsonValue,
): value is DisplayWindowJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonObject(value: unknown): DisplayWindowJsonObject {
  const json = toJsonValue(value);
  return isJsonObject(json) ? json : {};
}

/** The JSON state of a view, ready for `displayWindow:publishState`. */
export function toWire(view: DisplayWindowView): DisplayWindowJsonObject {
  return {
    version: DISPLAY_WINDOW_WIRE_VERSION,
    theme: { name: view.theme.name, mode: view.theme.mode },
    open: view.open,
    pinned: view.pinned,
    count: view.count,
    selectedKey: view.selectedKey,
    scrollToSelectedOnMount: view.scrollToSelectedOnMount,
    fullscreenArtifactId: view.fullscreenArtifactId,
    summary: view.summary === null ? null : toJsonObject(view.summary),
    summaryTurnKey: view.summaryTurnKey,
    surfaces: view.surfaces.map((surface) => ({
      key: surface.key,
      displayId: surface.displayId,
      content: toJsonObject(surface.content),
      title: surface.title,
      description: surface.description,
      turnKey: surface.turnKey,
      fenceKey: surface.fenceKey,
      createdSeq: surface.createdSeq,
      updatedSeq: surface.updatedSeq,
      componentSignatures: [...surface.componentSignatures.entries()].map(
        ([id, signature]) => [id, signature],
      ),
      retainedViewStateIds: [...surface.retainedViewStateIds],
    })),
    viewStates: [...view.viewStates.entries()].map(([key, state]) => [
      key,
      toJsonObject(state),
    ]),
    artifacts: view.artifacts.map((record) => toJsonObject(record)),
    actionError: view.actionError,
    notice: view.notice,
  };
}

/**
 * UTF-8 byte length of a string, without allocating an encoded copy. Used to
 * honour `DISPLAY_WINDOW_STATE_MAX_BYTES` before a publish.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Parsing (the child window, and actions on the main side)
// ---------------------------------------------------------------------------

/** A JSON value as `JSON.parse` returns it (finite numbers only). */
function isJsonValue(value: unknown): value is DisplayWindowJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((entry: unknown) => isJsonValue(entry));
  if (isPlainObject(value))
    return Object.values(value).every((entry) => isJsonValue(entry));
  return false;
}

const JsonValueSchema = z.custom<DisplayWindowJsonValue>(isJsonValue);

/**
 * The surface content the panel renders. The main renderer already validated
 * it against the surface contract; here the contract tag and the shape of its
 * two variants are checked, and the payload must be plain JSON. The
 * declarative renderer binds text only (no HTML), so no markup is trusted.
 */
const SurfaceContentSchema = z.custom<DisplaySurface['content']>(
  (value) =>
    isPlainObject(value) &&
    isJsonValue(value) &&
    ((value['contract'] === 'dashboard-spec/2' &&
      isPlainObject(value['surface']) &&
      isPlainObject(value['dataModel'])) ||
      (value['contract'] === 'dashboard-spec/1' &&
        isPlainObject(value['spec']))),
);

/** The summary model: plain JSON with its card list; rendered as text. */
const TurnSummaryModelSchema = z.custom<TurnSummaryModel>(
  (value) =>
    isPlainObject(value) &&
    isJsonValue(value) &&
    typeof value['incomplete'] === 'boolean' &&
    typeof value['testsInBackground'] === 'boolean' &&
    Array.isArray(value['cards']) &&
    value['cards'].every(
      (card: unknown) =>
        isPlainObject(card) && typeof card['kind'] === 'string',
    ),
);

const SurfaceComponentViewStateSchema = z.strictObject({
  sort: z
    .strictObject({
      columnKey: z.string(),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  filter: z.string().optional(),
  page: z.number().int().nonnegative().optional(),
  chartAsTable: z.boolean().optional(),
  expanded: z.boolean().optional(),
});

/** A surface renderer's view state (`SurfaceViewState`), validated field by field. */
export const SurfaceViewStateWireSchema = z.strictObject({
  components: z.record(z.string(), SurfaceComponentViewStateSchema),
  drafts: z.record(z.string(), JsonValueSchema),
});

const SurfaceWireSchema = z.strictObject({
  key: z.string().min(1),
  displayId: z.string().nullable(),
  content: SurfaceContentSchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
  turnKey: z.string(),
  fenceKey: z.string(),
  createdSeq: z.number(),
  updatedSeq: z.number(),
  componentSignatures: z.array(z.tuple([z.string(), z.string()])),
  retainedViewStateIds: z.array(z.string()),
});

const ThemeWireSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  mode: z.enum(['dark', 'light']),
});

const DisplayWindowActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('select'), key: z.string().min(1) }),
  z.strictObject({ type: z.literal('fullscreen-closed') }),
  z.strictObject({
    type: z.literal('view-state'),
    surfaceKey: z.string().min(1),
    viewState: SurfaceViewStateWireSchema,
  }),
  z.strictObject({ type: z.literal('open-file'), path: z.string().min(1) }),
  z.strictObject({ type: z.literal('review') }),
  z.strictObject({ type: z.literal('attach') }),
]);

const ActionPushSchema = z.strictObject({
  tabId: z.string().min(1),
  action: DisplayWindowActionSchema,
});

/** A validated action from the detached window, with its view state typed. */
export type DisplayWindowParsedAction =
  | Exclude<DisplayWindowAction, { readonly type: 'view-state' }>
  | {
      readonly type: 'view-state';
      readonly surfaceKey: string;
      readonly viewState: SurfaceViewState;
    };

/** The `displayWindow:action` push payload, validated; `null` when invalid. */
export function parseActionPush(
  payload: unknown,
): {
  readonly tabId: string;
  readonly action: DisplayWindowParsedAction;
} | null {
  const parsed = ActionPushSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** The action in the shape `displayWindow:action` sends. */
export function actionToWire(
  tabId: string,
  action: DisplayWindowParsedAction,
): DisplayWindowActionPushPayload {
  if (action.type !== 'view-state') return { tabId, action };
  return {
    tabId,
    action: {
      type: 'view-state',
      surfaceKey: action.surfaceKey,
      viewState: toJsonObject(action.viewState),
    },
  };
}

type ArtifactRecordSchemaType = typeof ArtifactRecordSchema;

function snapshotSchema(artifactRecord: ArtifactRecordSchemaType) {
  const state = z.strictObject({
    version: z.literal(DISPLAY_WINDOW_WIRE_VERSION),
    theme: ThemeWireSchema,
    open: z.boolean(),
    pinned: z.boolean(),
    count: z.number().int().nonnegative(),
    selectedKey: z.string().nullable(),
    scrollToSelectedOnMount: z.boolean(),
    fullscreenArtifactId: z.string().nullable(),
    summary: TurnSummaryModelSchema.nullable(),
    summaryTurnKey: z.string(),
    surfaces: z.array(SurfaceWireSchema),
    viewStates: z.array(z.tuple([z.string(), SurfaceViewStateWireSchema])),
    artifacts: z.array(artifactRecord),
    actionError: z.string().nullable(),
    notice: z.string().nullable(),
  });
  return z.strictObject({
    tabId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    state,
  });
}

let cachedSnapshotSchema: Promise<ReturnType<typeof snapshotSchema>> | null =
  null;

function loadSnapshotSchema(): Promise<ReturnType<typeof snapshotSchema>> {
  cachedSnapshotSchema ??=
    import('@ptah-extension/shared/mcp-apps-contracts').then(
      (contracts) => snapshotSchema(contracts.ArtifactRecordSchema),
      (error: unknown) => {
        cachedSnapshotSchema = null;
        throw error;
      },
    );
  return cachedSnapshotSchema;
}

/**
 * A `displayWindow:state` push or `displayWindow:getState` result, validated
 * and converted back to the panel's types; `null` when it is not a valid
 * snapshot of this wire version. Rejects when the schema chunk fails to load.
 */
export async function parseWireState(
  snapshot: unknown,
): Promise<DisplayWindowParsedSnapshot | null> {
  const schema = await loadSnapshotSchema();
  const parsed = schema.safeParse(snapshot);
  if (!parsed.success) return null;
  const { tabId, revision, state } = parsed.data;
  return {
    tabId,
    revision,
    view: {
      theme: state.theme,
      open: state.open,
      pinned: state.pinned,
      count: state.count,
      selectedKey: state.selectedKey,
      scrollToSelectedOnMount: state.scrollToSelectedOnMount,
      fullscreenArtifactId: state.fullscreenArtifactId,
      summary: state.summary,
      summaryTurnKey: state.summaryTurnKey,
      surfaces: state.surfaces.map((surface) => ({
        ...surface,
        componentSignatures: new Map(surface.componentSignatures),
        retainedViewStateIds: new Set(surface.retainedViewStateIds),
      })),
      viewStates: new Map(state.viewStates),
      artifacts: state.artifacts,
      actionError: state.actionError,
      notice: state.notice,
    },
  };
}
