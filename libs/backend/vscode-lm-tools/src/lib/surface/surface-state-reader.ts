/**
 * Reads over the host copy (plan Component 10 reads, Component 12 get-state).
 *
 * - `read` is the complete read for RPC: whole `SurfaceStateView`s, no bound
 *   beyond the store's own.
 * - `describeForAgent` is the bounded text for MCP. `view: 'state'` for one
 *   surface is complete and within `maxStateReadBytes` by the escaped worst
 *   case (data model, form values keyed by unique path, selection
 *   description, last submit and fixed metadata, with U+2028/U+2029 escaped;
 *   implementation-plan.md "Batch 9 read-budget decision"), and so is the
 *   complete tree of `view: 'structure'`. Without
 *   a surface id it lists every surface id and revision first, then as many
 *   complete states as fit, then a marker naming the omitted ids. A state is
 *   never cut in half. `view: 'structure'` returns the component tree of one
 *   surface.
 *
 * Every read goes through the store, which touches recency. Reads never
 * throw; only the constructor rejects an unsupported bound.
 */
import type {
  SurfaceContent,
  SurfaceDataModel,
  SurfaceDataValue,
  SurfaceFormValues,
  SurfaceGetStateInput,
  SurfaceInput,
  SurfaceStateView,
} from '@ptah-extension/shared';
import {
  SURFACE_LIMITS,
  checkSubmitValues,
  collectSurfaceInputs,
  describeSurfaceSelection,
  readSurfacePath,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceRecord, SurfaceStateStore } from './surface-state.store';

export type SurfaceStateSource = Pick<SurfaceStateStore, 'get' | 'list'>;

export type SurfaceStoreReadResult =
  | {
      readonly status: 'found';
      readonly routingId: string;
      readonly surfaces: readonly SurfaceStateView[];
    }
  | { readonly status: 'not-found' };

export type SurfaceAgentReadResult =
  | {
      readonly status: 'found';
      readonly text: string;
      readonly truncated: boolean;
      /** Surfaces listed in the index whose complete state did not fit. */
      readonly omittedSurfaceIds: readonly string[];
    }
  /** The routing id holds no surface, or not the named one. */
  | { readonly status: 'not-found'; readonly text: string }
  /** Defensive: a single complete state or tree above the read bound. */
  | { readonly status: 'too-large'; readonly text: string }
  /** Defensive: `view: 'structure'` without a surface id (the schema rejects it first). */
  | { readonly status: 'rejected'; readonly text: string };

export interface SurfaceStateReaderOptions {
  readonly maxStateReadBytes?: number;
}

/** The record as the wire view the renderer and RPC carry. */
export function toSurfaceStateView(record: SurfaceRecord): SurfaceStateView {
  return {
    surfaceId: record.surfaceId,
    revision: record.revision,
    content: record.content,
    selection: record.selection,
    lastSubmit: record.lastSubmit,
  };
}

/**
 * Form values keyed by unique bound path (Req 3.7): one canonical value per
 * path, the ids of every input bound to it, and each input's submit issues
 * (`<componentId>: <message>`). A path absent from the data model reads as
 * the kind's empty value. v1 content has no inputs, so it yields `{}`.
 */
export function collectSurfaceFormValues(
  content: SurfaceContent,
): SurfaceFormValues {
  if (content.contract !== 'dashboard-spec/2') return {};
  const byPath = new Map<
    string,
    { value: SurfaceDataValue; inputs: string[]; submitIssues: string[] }
  >();
  for (const input of collectSurfaceInputs(content.surface.components)) {
    let entry = byPath.get(input.path);
    if (entry === undefined) {
      entry = {
        value: readValue(content.dataModel, input),
        inputs: [],
        submitIssues: [],
      };
      byPath.set(input.path, entry);
    }
    entry.inputs.push(input.id);
    const check = checkSubmitValues([input], content.dataModel);
    if (!check.ok)
      for (const issue of check.issues)
        entry.submitIssues.push(`${issue.componentId}: ${issue.message}`);
  }
  // `fromEntries` defines own properties, so no key can reach a prototype.
  return Object.fromEntries(byPath);
}

function readValue(
  model: SurfaceDataModel,
  input: SurfaceInput,
): SurfaceDataValue {
  const read = readSurfacePath(model, input.path, input.kind);
  return read.ok && read.value !== undefined ? read.value : null;
}

/**
 * The smallest supported `maxStateReadBytes`. Derived from the default store
 * limits: an index of `maxSurfacesPerRoutingId` (8) lines, each naming an id
 * of at most 2,003 characters (a `v1:` id; v2 ids are at most 128) plus its
 * revision and contract, is about 16.5 KB; the marker naming all 8 ids is
 * about 16.3 KB; error texts quote at most 256 id characters. 40 KiB covers
 * index + marker + any error text with room to spare. The default read bound
 * (`SURFACE_LIMITS.maxStateReadBytes`, 548 KiB) is far above it. A bound
 * between the two is accepted for tests and constrained hosts; there a large
 * complete state or tree answers `too-large` instead of being cut.
 */
export const SURFACE_READER_MIN_STATE_READ_BYTES = 40 * 1024;

export class SurfaceStateReader {
  private readonly maxStateReadBytes: number;

  /**
   * Throws `RangeError` for a bound below
   * `SURFACE_READER_MIN_STATE_READ_BYTES` or not a safe integer: that is a
   * wiring error, not a runtime condition. Reads never throw.
   */
  constructor(
    private readonly store: SurfaceStateSource,
    options: SurfaceStateReaderOptions = {},
  ) {
    const bound = options.maxStateReadBytes ?? SURFACE_LIMITS.maxStateReadBytes;
    if (
      !Number.isSafeInteger(bound) ||
      bound < SURFACE_READER_MIN_STATE_READ_BYTES
    )
      throw new RangeError(
        `maxStateReadBytes must be an integer of at least ${SURFACE_READER_MIN_STATE_READ_BYTES}; got ${String(bound)}.`,
      );
    this.maxStateReadBytes = bound;
  }

  /** Complete read for RPC. A named surface that is absent is `not-found`. */
  read(routingId: string, surfaceId?: string): SurfaceStoreReadResult {
    if (surfaceId !== undefined) {
      const record = this.store.get(routingId, surfaceId);
      return record === undefined
        ? { status: 'not-found' }
        : {
            status: 'found',
            routingId,
            surfaces: [toSurfaceStateView(record)],
          };
    }
    return {
      status: 'found',
      routingId,
      surfaces: this.store.list(routingId).map(toSurfaceStateView),
    };
  }

  /**
   * Bounded text for the agent (`ptah_surface_get_state`). Every variant,
   * including the index, the marker and the error texts, is at most
   * `maxStateReadBytes` UTF-8 bytes.
   */
  describeForAgent(
    routingId: string,
    input: SurfaceGetStateInput,
  ): SurfaceAgentReadResult {
    return this.bounded(this.describe(routingId, input));
  }

  private describe(
    routingId: string,
    input: SurfaceGetStateInput,
  ): SurfaceAgentReadResult {
    const view = input.view ?? 'state';
    if (input.surfaceId === undefined)
      return view === 'structure'
        ? {
            status: 'rejected',
            text: 'The structure view requires surfaceId.',
          }
        : this.describeAll(routingId);
    const record = this.store.get(routingId, input.surfaceId);
    if (record === undefined)
      return {
        status: 'not-found',
        text: `Surface ${quoteId(input.surfaceId)} was not found for this conversation.`,
      };
    const text =
      view === 'structure'
        ? `Surface structure (complete):\n${structureJson(record)}`
        : `Surface state (complete). Read the component tree with view "structure".\n${stateJson(record)}`;
    if (utf8Bytes(text) > this.maxStateReadBytes)
      return {
        status: 'too-large',
        text: `Surface ${quoteId(record.surfaceId)} ${view} exceeds maxStateReadBytes ${this.maxStateReadBytes}; nothing partial is returned.`,
      };
    return { status: 'found', text, truncated: false, omittedSurfaceIds: [] };
  }

  /**
   * Index first, then complete states, then (only when needed) a marker
   * naming the omitted ids. If every complete state fits without a marker,
   * all are returned. Otherwise states are packed in index order, each
   * accepted only if it fits together with the marker for the ids that would
   * still be omitted after it; that marker only shrinks as states are added,
   * so the final text stays within the bound.
   */
  private describeAll(routingId: string): SurfaceAgentReadResult {
    const records = this.store.list(routingId);
    if (records.length === 0)
      return {
        status: 'not-found',
        text: 'No surface state exists for this conversation.',
      };
    const index = [
      `Surfaces in this conversation (${records.length}):`,
      ...records.map(
        (record) =>
          `- ${JSON.stringify(record.surfaceId)} revision ${record.revision} (${record.content.contract})`,
      ),
    ].join('\n');
    const states = records.map((record) => {
      const text = stateJson(record);
      // +1 for the newline that joins it to the text before it.
      return { surfaceId: record.surfaceId, text, bytes: utf8Bytes(text) + 1 };
    });
    const indexBytes = utf8Bytes(index);
    const everything = states.reduce(
      (total, state) => total + state.bytes,
      indexBytes,
    );
    if (everything <= this.maxStateReadBytes)
      return {
        status: 'found',
        text: [index, ...states.map((state) => state.text)].join('\n'),
        truncated: false,
        omittedSurfaceIds: [],
      };

    const included = new Set<string>();
    let used = indexBytes;
    for (const state of states) {
      const stillOmitted = states
        .filter((other) => other !== state && !included.has(other.surfaceId))
        .map((other) => other.surfaceId);
      const markerBytes =
        stillOmitted.length === 0
          ? 0
          : utf8Bytes(
              `\n${truncationMarker(stillOmitted, this.maxStateReadBytes)}`,
            );
      if (used + state.bytes + markerBytes <= this.maxStateReadBytes) {
        included.add(state.surfaceId);
        used += state.bytes;
      }
    }
    const omitted = states
      .filter((state) => !included.has(state.surfaceId))
      .map((state) => state.surfaceId);
    const parts = [
      index,
      ...states
        .filter((state) => included.has(state.surfaceId))
        .map((state) => state.text),
    ];
    if (omitted.length > 0)
      parts.push(truncationMarker(omitted, this.maxStateReadBytes));
    return {
      status: 'found',
      text: parts.join('\n'),
      truncated: omitted.length > 0,
      omittedSurfaceIds: omitted,
    };
  }

  /**
   * Final byte guard over every variant. With the default store limits and a
   * bound of at least `SURFACE_READER_MIN_STATE_READ_BYTES` the index, the
   * marker and the error texts always fit, so this only fires for a store
   * configured beyond the defaults. The replacement texts are fixed and short.
   */
  private bounded(result: SurfaceAgentReadResult): SurfaceAgentReadResult {
    if (utf8Bytes(result.text) <= this.maxStateReadBytes) return result;
    switch (result.status) {
      case 'not-found':
        return {
          status: 'not-found',
          text: 'The surface was not found for this conversation.',
        };
      case 'rejected':
        return { status: 'rejected', text: 'The state request was rejected.' };
      default:
        return {
          status: 'too-large',
          text: `The surface read exceeds maxStateReadBytes ${this.maxStateReadBytes}; nothing partial is returned.`,
        };
    }
  }
}

function truncationMarker(ids: readonly string[], bound: number): string {
  return `[truncated: the complete state of ${ids.length} surface(s) did not fit in maxStateReadBytes ${bound}: ${ids
    .map((id) => JSON.stringify(id))
    .join(', ')}. Read each one with its surfaceId.]`;
}

/** Error texts quote at most this many UTF-16 units of a caller-supplied id. */
const MAX_QUOTED_ID_LENGTH = 256;

function quoteId(id: string): string {
  return id.length <= MAX_QUOTED_ID_LENGTH
    ? JSON.stringify(id)
    : `${JSON.stringify(id.slice(0, MAX_QUOTED_ID_LENGTH))}...`;
}

/**
 * One complete state as compact JSON: metadata, data model, form values,
 * selection (with its host-resolved description) and last submit. The title
 * and tree are structure and are read with `view: 'structure'`.
 */
function stateJson(record: SurfaceRecord): string {
  const content = record.content;
  const selection =
    record.selection === null
      ? null
      : {
          componentId: record.selection.componentId,
          target: record.selection.target,
          description: describeSurfaceSelection(content, record.selection),
        };
  const state =
    content.contract === 'dashboard-spec/2'
      ? {
          surfaceId: record.surfaceId,
          revision: record.revision,
          contract: content.contract,
          dataModel: content.dataModel,
          formValues: collectSurfaceFormValues(content),
          selection,
          lastSubmit: record.lastSubmit,
        }
      : {
          surfaceId: record.surfaceId,
          revision: record.revision,
          contract: content.contract,
          selection,
          lastSubmit: record.lastSubmit,
        };
  return escapeLineSeparators(JSON.stringify(state));
}

function structureJson(record: SurfaceRecord): string {
  const content = record.content;
  return escapeLineSeparators(
    JSON.stringify({
      surfaceId: record.surfaceId,
      revision: record.revision,
      contract: content.contract,
      structure:
        content.contract === 'dashboard-spec/2'
          ? content.surface
          : content.spec,
    }),
  );
}

/** U+2028 and U+2029 are valid in JSON but read as line breaks; keep them escaped. */
function escapeLineSeparators(text: string): string {
  return text.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
