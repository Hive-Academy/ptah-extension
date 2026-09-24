/**
 * Long-task bucketing plus CDP trace and CPU-profile summarization for Playwright perf
 * specs (TASK_2026_437 Batch 22). Pure, `Page`-independent transforms —
 * nothing here touches Playwright's `Page`/`ElementHandle`/`test` types, so
 * this module is safe to import from a Jest/Node context too if a future
 * spec wants to unit-test the classification logic directly.
 *
 * Extracted from `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
 * (`b22-code-style-review-delta.md`, revision 3 grew that file from 378 to
 * 1,184 lines by adding this code inline; this project's own precedent for
 * diagnostics helpers — `skill-telemetry-db.ts`, `png-pixels.ts`,
 * `git-diff-mock.ts` — keeps them in `src/support/`, not inside the spec
 * that consumes them). No behavior change from the extraction.
 *
 * Three independent concerns live here:
 *   1. `bucketByClick` / `bucketByMarker` assign long tasks to the most recent
 *      click or marker timestamp through the shared `bucketByTime` loop.
 *   2. `findRendererMainThread` / `summarizeTraceEvents` reduce a CDP trace to
 *      renderer-main-thread event counts and durations.
 *   3. `classifyFrame`/`summarizeCpuProfile` classifies a raw CDP profile into
 *      named source-area buckets and a top-functions-by-self-time list.
 */

/**
 * One entry of `PerformanceLongTaskTiming.attribution` — describes which
 * frame/container the browser attributes the task to. For a same-frame,
 * no-iframe page, Chromium typically reports exactly one attribution entry
 * with `containerType: 'window'` and empty `containerSrc`/`containerId`/
 * `containerName` — captured anyway since a consumer may ask for it
 * explicitly, and an unexpected non-empty value would be worth knowing about.
 */
export interface LongTaskAttribution {
  readonly containerType: string;
  readonly containerSrc: string;
  readonly containerId: string;
  readonly containerName: string;
}

export interface LongTaskEntry {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
  readonly attribution: LongTaskAttribution[];
}

export interface TileBucket {
  readonly label: string;
  readonly count: number;
  readonly maxMs: number;
  readonly totalMs: number;
}

function summarizeBucket(
  label: string,
  entries: readonly LongTaskEntry[],
): TileBucket {
  return {
    label,
    count: entries.length,
    maxMs: entries.reduce((m, e) => Math.max(m, e.duration), 0),
    totalMs: entries.reduce((sum, e) => sum + e.duration, 0),
  };
}

/**
 * Assigns each long task to the tile whose click most recently preceded it
 * (last click at or before the task's `startTime`), so the aggregate
 * `max`/`total` can be broken down into per-tile — and, since click order is
 * open order, tile 0 doubles as "cold start" and the rest as "steady state".
 */
export function bucketByTime(
  entries: readonly LongTaskEntry[],
  points: readonly { label: string; atMs: number }[],
  beforeLabel: string,
): TileBucket[] {
  const sortedPoints = [...points].sort((a, b) => a.atMs - b.atMs);
  const buckets = new Map<string, LongTaskEntry[]>();
  const before: LongTaskEntry[] = [];
  for (const e of entries) {
    let owner: string | null = null;
    for (const c of sortedPoints) {
      if (c.atMs <= e.startTime) owner = c.label;
      else break;
    }
    if (owner === null) {
      before.push(e);
    } else {
      let bucket = buckets.get(owner);
      if (!bucket) {
        bucket = [];
        buckets.set(owner, bucket);
      }
      bucket.push(e);
    }
  }
  const rows: TileBucket[] = [];
  if (before.length > 0) {
    rows.push(summarizeBucket(beforeLabel, before));
  }
  for (const c of sortedPoints) {
    rows.push(summarizeBucket(c.label, buckets.get(c.label) ?? []));
  }
  return rows;
}

export function bucketByClick(
  entries: readonly LongTaskEntry[],
  clicks: readonly { label: string; atMs: number }[],
): TileBucket[] {
  return bucketByTime(entries, clicks, 'before-first-click');
}

/** Assigns each long task to the last marker visible at or before its start. */
export function bucketByMarker(
  entries: readonly LongTaskEntry[],
  markers: readonly { label: string; atMs: number }[],
): TileBucket[] {
  return bucketByTime(entries, markers, 'before-first-marker');
}

export interface TraceEvent {
  readonly name: string;
  readonly cat?: string;
  readonly ph?: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts?: number;
  readonly dur?: number;
  readonly args?: Record<string, unknown>;
}

export interface TraceEventSummary {
  readonly totalMs: number;
  readonly byName: {
    readonly name: string;
    readonly count: number;
    readonly totalMs: number;
  }[];
}

/**
 * Finds Chromium's renderer main thread from trace metadata. The
 * `TracingStartedInBrowser` frame process ids constrain the search when that
 * metadata is present; `thread_name=CrRendererMain` supplies the thread id.
 */
export function findRendererMainThread(
  events: readonly TraceEvent[],
): { pid: number; tid: number } | null {
  const rendererPids = new Set<number>();
  for (const event of events) {
    if (event.name !== 'TracingStartedInBrowser') continue;
    const data = event.args?.['data'];
    if (!data || typeof data !== 'object') continue;
    const frames = (data as { frames?: unknown }).frames;
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue;
      const processId = (frame as { processId?: unknown }).processId;
      if (typeof processId === 'number') rendererPids.add(processId);
    }
  }

  const match = events.find((event) => {
    if (event.name !== 'thread_name') return false;
    if (rendererPids.size > 0 && !rendererPids.has(event.pid)) return false;
    return event.args?.['name'] === 'CrRendererMain';
  });
  return match ? { pid: match.pid, tid: match.tid } : null;
}

/** Summarizes trace events on the selected renderer main thread. */
export function summarizeTraceEvents(
  events: readonly TraceEvent[],
  mainThread: { pid: number; tid: number },
): TraceEventSummary {
  const rows = new Map<string, { count: number; totalUs: number }>();
  for (const event of events) {
    if (event.pid !== mainThread.pid || event.tid !== mainThread.tid) continue;
    const current = rows.get(event.name) ?? { count: 0, totalUs: 0 };
    current.count++;
    current.totalUs += Math.max(0, event.dur ?? 0);
    rows.set(event.name, current);
  }
  const byName = [...rows.entries()]
    .map(([name, row]) => ({
      name,
      count: row.count,
      totalMs: Number((row.totalUs / 1_000).toFixed(2)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
  return {
    totalMs: Number(
      byName.reduce((sum, row) => sum + row.totalMs, 0).toFixed(2),
    ),
    byName,
  };
}

// ── CDP CPU profile summarization (PTAH_PERF_PROFILE=1 only) ────────────────

export interface CpuProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
  readonly hitCount?: number;
  readonly children?: number[];
}

export interface CpuProfile {
  readonly nodes: CpuProfileNode[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples?: number[];
  readonly timeDeltas?: number[];
}

/**
 * Function names confirmed (Batch 22 revision 2, by
 * `grep -rln "<name>" node_modules/playwright-core/lib`) to be Playwright's
 * own injected accessible-name/role/actionability engine
 * (`roleUtils.ts`/`injectedScript.ts` in Playwright's source), not app code —
 * and NOT also a standard native DOM API name, so a hit here cannot be
 * misattributed to app code calling the same native method. These are the
 * functions that dominated the profile BEFORE revision 3's fix removed
 * Playwright locator polling from the measurement window; kept as a named,
 * explicit bucket so a re-profile after the fix can show, concretely,
 * whether they dropped to ~0. Playwright upgrades can change these internal
 * names — re-grep `node_modules/playwright-core/lib` if a re-profile stops
 * finding hits here that a manual read of the raw `.cpuprofile` still shows.
 */
const PLAYWRIGHT_INJECTED_SCRIPT_UNIQUE_FUNCTIONS = new Set([
  'getTextAlternativeInternal',
  'processElement',
  'elementText',
  'getElementComputedStyle',
  'getAriaRole',
  'getElementAccessibleName',
  'beginAriaCaches',
  'endAriaCaches',
  'receivesPointerEvents',
]);

/**
 * Function names Playwright's injected script ALSO uses, but which are
 * standard native DOM/Animation APIs (`Element.getAnimations()`,
 * `Element.checkVisibility()`, `window.getComputedStyle()`,
 * `Element.getBoundingClientRect()`) that app code can call directly too —
 * confirmed live in the profile that motivated this split, where the app's
 * FLIP-animation library (since removed) called
 * `getAnimations`/`getBoundingClientRect` for its own DOM-mutation reactions.
 * A blank-source-URL hit on one of these names is therefore ambiguous between
 * "Playwright's actionability check" and "app code calling a native layout or
 * animation API" — bucketed separately so
 * a report doesn't silently attribute the app's own cost to the test
 * harness, or vice versa.
 */
const AMBIGUOUS_NATIVE_API_FUNCTIONS = new Set([
  'getAnimations',
  'getCSSContent',
  'checkVisibility',
  'getComputedStyle',
  'getBoundingClientRect',
]);

/**
 * Best-effort classification of a call frame into named source areas (app
 * mechanisms like chat-streaming finalization, session-history-replayer
 * chunks, Angular change detection/rendering, markdown/DOMPurify/marked,
 * execution-tree builder, gridstack/layout, zone, IPC/JSON parse; or
 * Playwright's own injected script; or an ambiguous native API). Matches on
 * function name OR script url. A frame with no source URL that isn't a named
 * native marker and isn't a confirmed Playwright function gets its own
 * 'no-source-url (uncategorized)' bucket rather than being silently folded
 * into 'other/unclassified' (which means "had a real source URL, but matched
 * no keyword") — an empty URL is itself informative (native binding or an
 * evaluated/injected script), and conflating the two would hide exactly the
 * ambiguity a reader needs to see.
 */
export function classifyFrame(node: CpuProfileNode): string {
  const fn = node.callFrame.functionName || '(anonymous)';
  if (fn === '(program)' || fn === '(idle)' || fn === '(garbage collector)') {
    return fn;
  }
  if (node.callFrame.url === '') {
    if (PLAYWRIGHT_INJECTED_SCRIPT_UNIQUE_FUNCTIONS.has(fn)) {
      return 'Playwright injected script (locator/actionability, confirmed unique name)';
    }
    if (AMBIGUOUS_NATIVE_API_FUNCTIONS.has(fn)) {
      return 'native DOM/Animation API (ambiguous: Playwright OR app)';
    }
  }
  const hay = `${fn} ${node.callFrame.url}`;
  if (/finalizeSessionHistory|message-finalization/i.test(hay)) {
    return 'chat-streaming finalization (C16)';
  }
  if (
    /SessionHistoryReplayer|session-history-replayer|yieldToMacrotask/i.test(
      hay,
    )
  ) {
    return 'session-history-replayer chunked replay';
  }
  if (/ExecutionTreeBuilder|execution-tree-builder/i.test(hay)) {
    return 'execution-tree builder';
  }
  if (/DOMPurify|sanitize|marked/i.test(hay)) {
    return 'markdown/DOMPurify/marked';
  }
  if (/gridstack|GridStack/i.test(hay)) {
    return 'gridstack/layout';
  }
  if (
    /[Zz]one\.js|__zone_symbol|ZoneDelegate|zoneAwareAddEventListener/.test(hay)
  ) {
    return 'zone.js';
  }
  if (/JSON\.parse|ipcRenderer|rpc-call/i.test(hay)) {
    return 'IPC / JSON parse';
  }
  if (
    /refreshView|detectChanges|ChangeDetect|ɵɵ|core\.mjs|@angular/i.test(hay)
  ) {
    return 'Angular change detection/rendering';
  }
  if (node.callFrame.url === '' && fn !== '(anonymous)') {
    return 'no-source-url (uncategorized)';
  }
  return 'other/unclassified';
}

export interface CpuProfileSummary {
  readonly grandTotalMs: number;
  readonly byCategory: { category: string; selfMs: number; selfPct: number }[];
  readonly topFunctionsBySelf: {
    functionName: string;
    url: string;
    selfMs: number;
  }[];
}

/**
 * Self time per node comes straight from `samples`/`timeDeltas` (the standard,
 * exact way to derive it from a CDP `Profiler.Profile` — not an
 * approximation): `timeDeltas[i]` is the microseconds between `samples[i-1]`
 * and `samples[i]` (the very first entry is start-of-profile to `samples[0]`),
 * so summing `timeDeltas[i]` into `samples[i]`'s node gives that node's exact
 * self time within this capture. Total (self + descendants) time by
 * INDIVIDUAL function is not computed here (a function can appear at several
 * call sites, which would need a functionName-keyed merge of the call tree to
 * do correctly) — only self time is reported per function; the category
 * rollup is the "total by area" view instead.
 */
export function summarizeCpuProfile(profile: CpuProfile): CpuProfileSummary {
  const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfTimeUs = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const dt = Math.max(0, deltas[i] ?? 0);
    const id = samples[i];
    selfTimeUs.set(id, (selfTimeUs.get(id) ?? 0) + dt);
  }

  const categoryUs = new Map<string, number>();
  const functionUs = new Map<
    string,
    { functionName: string; url: string; us: number }
  >();
  let grandTotalUs = 0;
  for (const [id, us] of selfTimeUs) {
    const node = nodesById.get(id);
    if (!node) continue;
    grandTotalUs += us;
    const category = classifyFrame(node);
    categoryUs.set(category, (categoryUs.get(category) ?? 0) + us);
    const fnKey = `${node.callFrame.functionName || '(anonymous)'}@${node.callFrame.url}`;
    const existing = functionUs.get(fnKey);
    if (existing) {
      existing.us += us;
    } else {
      functionUs.set(fnKey, {
        functionName: node.callFrame.functionName || '(anonymous)',
        url: node.callFrame.url,
        us,
      });
    }
  }

  const byCategory = [...categoryUs.entries()]
    .map(([category, us]) => ({
      category,
      selfMs: Number((us / 1000).toFixed(2)),
      selfPct:
        grandTotalUs > 0 ? Number(((us / grandTotalUs) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.selfMs - a.selfMs);

  const topFunctionsBySelf = [...functionUs.values()]
    .sort((a, b) => b.us - a.us)
    .slice(0, 15)
    .map((f) => ({
      functionName: f.functionName,
      url: f.url,
      selfMs: Number((f.us / 1000).toFixed(2)),
    }));

  return {
    grandTotalMs: Number((grandTotalUs / 1000).toFixed(2)),
    byCategory,
    topFunctionsBySelf,
  };
}
