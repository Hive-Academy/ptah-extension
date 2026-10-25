import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import {
  bucketByClick,
  findRendererMainThread,
  summarizeTraceEvents,
  type LongTaskEntry,
  type TraceEvent,
} from '../../support/perf-diagnostics';
import {
  collectLongTasks,
  installLongTaskObserver,
  startTraceCapture,
  stopTraceCapture,
  type CDPSession,
} from '../../support/perf-page-capture';
import {
  makeSessionFixture,
  prepareCanvasWithSessions,
  sessionRowButton,
} from '../../support/perf-session-fixture';

const repoRoot = resolve(__dirname, '../../../../..');
const label = process.env['PTAH_MOTION_LABEL'];
if (label && !/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Invalid PTAH_MOTION_LABEL');
const outputDir = join(repoRoot, '.ptah/specs/TASK_2026_683_3c29/measurements');
const assertMotion = process.env['PTAH_MOTION_ASSERT'] === '1';
const splitPaneSelector = '[data-testid="rail-pane-container"] > section[data-pane-side]';
const probeVersion = 3;

type Scenario = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';
const expectedWindowCounts: Record<Scenario, number> = { S1: 30, S2: 10, S3: 5, S4: 3, S5: 2, S6: 44, S7: 4, S8: 4 };
interface FocusRecord { tag: string | null; testId: string | null; title: string | null }
interface InputEventRecord extends FocusRecord { type: 'pointerdown' | 'click'; viewTransitionActive: boolean; rootClasses: string; path: string[]; stack: string[]; listButton: string | null }
interface AnimationSample { type: 'CSSAnimation' | 'CSSTransition' | 'other'; name: string | null; target: string }
interface TaskFrame { event: string; functionName: string | null; url: string | null; durationMs: number }
interface TaskAttribution { startTime: number; duration: number; classification: 'motion' | 'render' | 'unknown'; topFrames: TaskFrame[]; reason?: string }
interface PlacementRecord {
  id: string | null;
  visibleAtSwitch: boolean;
  visibleAt50Ms: boolean;
  entranceIndex: number | null;
  delayMs: number | null;
  animationNames: string[];
}
interface Sample {
  atMs: number;
  animations: number;
  animationTargets: string[];
  animationDetails?: AnimationSample[];
  splitPaneAnimations: number;
  splitPaneSelector: string;
  viewTransition: boolean;
  focus: FocusRecord;
  surface: string;
  splitPanes: number;
  railShifts: number | null;
  focusSwaps: number | null;
  headerRect: number[] | null;
  composerRect: number[] | null;
  blank: boolean;
}
interface ScrollSample { frame: number; scrollTop: number | null; scrollHeight: number | null }
interface CounterSample { nodes: number; jsEventListeners: number }
interface AnimationRecord { phase: 'start' | 'end'; name: string; selector: string; atMs: number }
interface EntranceRecord {
  source: 'start' | 'observed';
  name: string;
  selector: string;
  id: string | null;
  entranceIndex: number | null;
  delayMs: number | null;
  atMs: number;
  visibleAtSwitch: boolean;
  visibleAtStart: boolean;
}
interface WindowRecord {
  scenario: Scenario;
  name: string;
  reducedMotion: boolean;
  clickTimes: number[];
  windowStartMs: number;
  windowEndMs: number;
  longTasks: { count: number; maxMs: number; sumMs: number; entries: LongTaskEntry[]; perClick: ReturnType<typeof bucketByClick>; attributedTasks?: TaskAttribution[]; stackAvailable?: boolean };
  layoutShift: number;
  layoutShiftAll: number;
  layoutShiftNoInput: number;
  trace: 'unavailable' | { droppedFrames: number; layoutCount: number; updateLayoutTreeCount: number; forcedLayouts: null; motionForcedLayouts: null; motionLongTasks: number; attribution: 'motion' | 'render' | 'unknown'; summary: ReturnType<typeof summarizeTraceEvents> | null };
  armed: boolean;
  samples: { at0: Sample; at50: Sample; at100: Sample; at400: Sample };
  viewTransitionStarted: boolean;
  viewTransitionEvents: AnimationRecord[];
  splitPaneEvents: AnimationRecord[];
  entrance: { visibleAtSwitch: string[]; placements: PlacementRecord[]; events: EntranceRecord[]; animatedCount: number; firstVisibleIndex: number | null; firstVisibleDelayMs: number | null };
  scrollFrames: ScrollSample[];
  railShiftsDelta: number | null;
  m0RailShiftsDelta?: number | null;
  focusSwapsDelta: number | null;
  frames: { file: string; atMs: number }[];
  screencast: 'available' | 'unavailable';
  targetRetained?: boolean;
  outcome: Record<string, unknown>;
}

// The callback is stringified by Playwright; keep every dependency inside it.
async function installWindowProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __ptahMotionProbe?: {
      clickAt: number | null;
      visibleAtSwitch: string[];
      clickTimes: number[];
      clickListener: EventListener;
      keyListener: EventListener;
      animationListener: EventListener;
      pointerListener: EventListener;
      inputEvents: InputEventRecord[];
      placements: PlacementRecord[];
      viewTransitionEvents: AnimationRecord[];
      splitPaneEvents: AnimationRecord[];
      entranceEvents: EntranceRecord[];
      arm: () => void;
      rearm: () => void;
      shifts: number;
      shiftsAll: number;
      observer: PerformanceObserver | null;
      samples: { at0?: Sample; at50?: Sample; at100?: Sample; at400?: Sample };
      scrollFrames: ScrollSample[];
    } };
    const activeScroller = () => [...document.querySelectorAll<HTMLElement>('[data-testid="chat-transcript-scroller"]')]
      .find((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
    const visibleMessages = (): string[] => {
      const scroller = activeScroller();
      return [...(scroller?.querySelectorAll<HTMLElement>('.chat-msg-slot') ?? [])]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = el.closest<HTMLElement>('[data-testid="chat-transcript-scroller"]')?.getBoundingClientRect();
          return !!s && r.bottom > s.top && r.top < s.bottom;
        })
        .map((el, index) => el.getAttribute('data-ptah-transcript-message-id') ?? `visible-${index}`);
    };
    const probe = {
      clickAt: null as number | null, visibleAtSwitch: visibleMessages(), clickTimes: [] as number[], shifts: 0, shiftsAll: 0,
      generation: 0,
      observer: null as PerformanceObserver | null,
      samples: {} as { at0?: Sample; at50?: Sample; at100?: Sample; at400?: Sample },
      scrollFrames: [] as ScrollSample[],
      placements: [] as PlacementRecord[],
      viewTransitionEvents: [] as AnimationRecord[],
      splitPaneEvents: [] as AnimationRecord[],
      entranceEvents: [] as EntranceRecord[],
      inputEvents: [] as InputEventRecord[],
      observedStagger: new WeakSet<Element>(),
    };
    const visibleInScroller = (el: Element): boolean => {
      const scroller = activeScroller();
      if (!scroller || (el !== scroller && !scroller.contains(el))) return false;
      const item = (el.closest('.chat-msg-slot') ?? el).getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      return item.bottom > viewport.top && item.top < viewport.bottom;
    };
    const recordEntrance = (el: Element, name: string, source: 'start' | 'observed') => {
      const slot = el.closest<HTMLElement>('.chat-msg-slot');
      const modern = (name === 'ptahPaneSwitchEnter' || name.endsWith('_ptahPaneSwitchEnter')) && el.matches('.chat-scroll-container.ptah-pane-switch-enter');
      const legacy = name === 'ptahStaggerUp' && el.matches('.st-t');
      if (!modern && !legacy) return;
      if (legacy && probe.observedStagger.has(el)) return;
      if (legacy) probe.observedStagger.add(el);
      const rawIndex = modern ? null : getComputedStyle(el).getPropertyValue('--i').trim();
      const style = getComputedStyle(el);
      const rawDelay = style.animationDelay.split(',')[0]?.trim() ?? '';
      const delay = Number.parseFloat(rawDelay) * (rawDelay.endsWith('ms') ? 1 : 1000);
      const id = slot?.getAttribute('data-ptah-transcript-message-id') ?? null;
      const record: EntranceRecord = { source, name: modern ? 'ptahPaneSwitchEnter' : name, selector: modern ? '.chat-scroll-container.ptah-pane-switch-enter' : '.st-t', id,
        entranceIndex: rawIndex !== null && rawIndex !== '' && Number.isFinite(Number(rawIndex)) ? Number(rawIndex) : null,
        delayMs: Number.isFinite(delay) ? delay : null, atMs: performance.now() - (probe.clickAt ?? performance.now()),
        visibleAtSwitch: id !== null && probe.visibleAtSwitch.includes(id), visibleAtStart: source === 'observed' && visibleInScroller(el) };
      probe.entranceEvents.push(record);
      if (source === 'start') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          record.visibleAtStart = visibleInScroller(el);
        }));
      }
    };
    const animationListener: EventListener = (event) => {
      if (probe.clickAt === null || performance.now() - probe.clickAt > 600) return;
      const animation = event as AnimationEvent;
      const target = animation.target;
      const phase = animation.type === 'animationstart' ? 'start' : 'end';
      const atMs = performance.now() - probe.clickAt;
      if (animation.pseudoElement.startsWith('::view-transition')) {
        probe.viewTransitionEvents.push({ phase, name: animation.animationName, selector: animation.pseudoElement, atMs });
      }
      if (target instanceof Element && target.matches('[data-testid="rail-pane-container"] > section[data-pane-side]')) {
        probe.splitPaneEvents.push({ phase, name: animation.animationName,
          selector: `[data-testid="rail-pane-container"] > section[data-pane-side="${target.getAttribute('data-pane-side')}"]`, atMs });
      }
      if (phase === 'start' && target instanceof Element) recordEntrance(target, animation.animationName, 'start');
    };
    document.addEventListener('animationstart', animationListener, true);
    document.addEventListener('animationend', animationListener, true);
    const rect = (selector: string): number[] | null => {
      const element = [...document.querySelectorAll<HTMLElement>(selector)]
        .find((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
      const r = element?.getBoundingClientRect();
      return r ? [r.x, r.y, r.width, r.height] : null;
    };
    const sample = (): Sample => {
      const animations = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
      const animationDetails: AnimationSample[] = animations.map((a) => {
        const effect = a.effect;
        const target = effect instanceof KeyframeEffect ? effect.target : null;
        const type = a instanceof CSSAnimation ? 'CSSAnimation' : a instanceof CSSTransition ? 'CSSTransition' : 'other';
        const name = a instanceof CSSAnimation ? (a.animationName === 'ptahPaneSwitchEnter' || a.animationName.endsWith('_ptahPaneSwitchEnter') ? 'ptahPaneSwitchEnter' : a.animationName) : null;
        return { type, name, target: target instanceof Element
          ? `${target.tagName.toLowerCase()}.${target.getAttribute('class') ?? ''}${target.getAttribute('data-testid') ? `[data-testid="${target.getAttribute('data-testid')}"]` : ''}:${name ?? ''}`
          : 'pseudo' };
      });
      return {
        atMs: performance.now() - (probe.clickAt ?? performance.now()),
        animations: animations.length,
        animationTargets: animationDetails.map((animation) => animation.target), animationDetails,
        splitPaneAnimations: [...document.querySelectorAll<HTMLElement>('[data-testid="rail-pane-container"] > section[data-pane-side]')]
          .reduce((count, pane) => count + pane.getAnimations({ subtree: false })
            .filter((animation) => animation instanceof CSSAnimation && animation.effect instanceof KeyframeEffect && animation.effect.target === pane).length, 0),
        splitPaneSelector: '[data-testid="rail-pane-container"] > section[data-pane-side]',
        viewTransition: document.documentElement.matches(':active-view-transition'),
        focus: { tag: document.activeElement?.tagName ?? null, testId: document.activeElement?.getAttribute('data-testid') ?? null, title: document.activeElement?.getAttribute('title') ?? null },
        surface: document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.getAttribute('title') ?? location.pathname,
        splitPanes: document.querySelectorAll('[data-testid="rail-pane-container"] > [data-pane-side]').length,
        railShifts: document.querySelector('[data-canvas-rail-shifts]') ? Number(document.querySelector('[data-canvas-rail-shifts]')?.getAttribute('data-canvas-rail-shifts')) : null,
        focusSwaps: document.querySelector('[data-canvas-focus-swaps]') ? Number(document.querySelector('[data-canvas-focus-swaps]')?.getAttribute('data-canvas-focus-swaps')) : null,
        headerRect: rect('ptah-canvas-focus-header'), composerRect: rect('ptah-chat-input'),
        blank: ![...document.querySelectorAll<HTMLElement>('ptah-canvas-rail-board, ptah-tasks-view, ptah-dashboard-grid, ptah-settings, ptah-thoth-shell')]
          .some((el) => el.getClientRects().length > 0),
      };
    };
    const placementSample = (): PlacementRecord[] => {
      const sc = activeScroller();
      const sr = sc?.getBoundingClientRect();
      return [...(sc?.querySelectorAll<HTMLElement>('.chat-msg-slot') ?? [])].map((el): PlacementRecord => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const names = style.animationName.split(',').map((s) => s.trim()).filter((s) => s !== 'none');
        const i = style.getPropertyValue('--i').trim();
        const delay = Number.parseFloat(style.animationDelay) * (style.animationDelay.includes('ms') ? 1 : 1000);
        return {
          id: el.getAttribute('data-ptah-transcript-message-id'),
          visibleAtSwitch: probe.visibleAtSwitch.includes(el.getAttribute('data-ptah-transcript-message-id') ?? ''),
          visibleAt50Ms: !!sr && r.bottom > sr.top && r.top < sr.bottom,
          entranceIndex: names.length && i !== '' && Number.isFinite(Number(i)) ? Number(i) : null,
          delayMs: names.length && Number.isFinite(delay) ? delay : null,
          animationNames: names,
        };
      });
    };
    const readScroll = (frame: number, generation: number) => {
      if (generation !== probe.generation) return;
      const active = activeScroller();
      probe.scrollFrames.push({ frame, scrollTop: active?.scrollTop ?? null, scrollHeight: active?.scrollHeight ?? null });
      if (frame < 3) requestAnimationFrame(() => readScroll(frame + 1, generation));
    };
    const capture = () => {
      const generation = ++probe.generation;
      probe.clickAt = performance.now();
      probe.visibleAtSwitch.splice(0, probe.visibleAtSwitch.length, ...visibleMessages());
      probe.samples = {};
      probe.placements.length = 0;
      probe.viewTransitionEvents.length = 0;
      probe.splitPaneEvents.length = 0;
      probe.entranceEvents.length = 0;
      probe.observedStagger = new WeakSet<Element>();
      probe.scrollFrames.length = 0;
      probe.shifts = 0;
      probe.shiftsAll = 0;
      probe.samples.at0 = sample();
      requestAnimationFrame(() => {
        if (generation !== probe.generation) return;
        for (const animation of document.getAnimations()) {
          if (!(animation instanceof CSSAnimation) || animation.animationName !== 'ptahStaggerUp') continue;
          const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          if (target instanceof Element) recordEntrance(target, animation.animationName, 'observed');
        }
      });
      setTimeout(() => { if (generation === probe.generation) { probe.samples.at50 = sample(); probe.placements.push(...placementSample()); } }, 50);
      setTimeout(() => { if (generation === probe.generation) probe.samples.at100 = sample(); }, 100);
      setTimeout(() => { if (generation === probe.generation) probe.samples.at400 = sample(); }, 400);
      requestAnimationFrame(() => readScroll(1, generation));
    };
    const arm = () => { if (probe.clickAt === null) capture(); };
    const rearm = () => { probe.clickTimes.length = 0; capture(); probe.clickTimes.push(probe.clickAt ?? performance.now()); };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 80)}${el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : ''}`;
    const recordInput = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      probe.inputEvents.push({ type: event.type as 'pointerdown' | 'click', tag: target?.tagName ?? null,
        testId: target?.getAttribute('data-testid') ?? null, title: target?.getAttribute('title') ?? null,
        viewTransitionActive: document.documentElement.classList.contains('ptah-vt-active'),
        rootClasses: document.documentElement.className,
        path: (() => { const out: string[] = []; for (let el = target; el && out.length < 6; el = el.parentElement) out.push(describe(el)); return out; })(),
        stack: event instanceof MouseEvent ? [`at ${event.clientX},${event.clientY}`, ...document.elementsFromPoint(event.clientX, event.clientY).slice(0, 6).map(describe)] : [],
        listButton: (() => { const r = document.querySelector('ptah-tasks-view button[data-testid="tasks-view-mode-list"]')?.getBoundingClientRect(); return r ? `${r.x},${r.y} ${r.width}x${r.height}` : null; })() });
    };
    const pointerListener: EventListener = (event) => { if ((event as PointerEvent).isTrusted) recordInput(event); };
    const clickListener: EventListener = (event) => { if ((event as MouseEvent).isTrusted) { recordInput(event); arm(); probe.clickTimes.push(performance.now()); } };
    const keyListener: EventListener = (event) => { if ((event as KeyboardEvent).key === 'Enter') arm(); };
    document.addEventListener('click', clickListener, true);
    document.addEventListener('pointerdown', pointerListener, true);
    document.addEventListener('keydown', keyListener, true);
    w.__ptahMotionProbe = { ...probe, get clickAt() { return probe.clickAt; }, get samples() { return probe.samples; }, get shifts() { return probe.shifts; }, get shiftsAll() { return probe.shiftsAll; }, get observer() { return probe.observer; }, clickListener, pointerListener, keyListener, animationListener, arm, rearm };
    try {
      probe.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean; sources?: { node?: Node }[] };
          if (probe.clickAt !== null && entry.startTime >= probe.clickAt && entry.startTime < probe.clickAt + 600 && shift.sources?.some((source) => source.node instanceof Element && !!source.node.closest('ptah-canvas-rail, ptah-chat-transcript'))) {
            probe.shiftsAll += shift.value ?? 0;
            if (!shift.hadRecentInput) probe.shifts += shift.value ?? 0;
          }
        }
      });
      probe.observer.observe({ type: 'layout-shift' });
    } catch { /* unsupported observer: zero recorded with no crash */ }
  });
}

async function counters(page: Page): Promise<CounterSample | null> {
  let session: CDPSession | null = null;
  try {
    session = await page.context().newCDPSession(page);
    const result = await session.send('Memory.getDOMCounters');
    return { nodes: Number(result['nodes']), jsEventListeners: Number(result['jsEventListeners']) };
  } catch { return null; }
  finally { await session?.detach().catch(() => undefined); }
}

function attributeLongTasks(events: TraceEvent[] | null, entries: LongTaskEntry[], anchorMs: number | null): { tasks: TaskAttribution[]; stackAvailable: boolean } {
  const main = events ? findRendererMainThread(events) : null;
  const timeline = events && main ? events.filter((event) => event.pid === main.pid && event.tid === main.tid) : [];
  const anchor = events?.find((event) => event.ts !== undefined &&
    (event.name === 'ptah-motion-trace-anchor' || JSON.stringify(event.args ?? {}).includes('ptah-motion-trace-anchor')));
  const offsetUs = anchor?.ts !== undefined && anchorMs !== null ? anchor.ts - anchorMs * 1000 : null;
  const stackAvailable = timeline.some((event) => {
    const data = event.args?.['data'];
    if (!data || typeof data !== 'object') return false;
    const values = data as { functionName?: unknown; url?: unknown; stackTrace?: unknown };
    return typeof values.functionName === 'string' || typeof values.url === 'string' || Array.isArray(values.stackTrace);
  });
  const tasks = entries.map((entry): TaskAttribution => {
    const unknown = (reason: string): TaskAttribution => ({ startTime: entry.startTime, duration: entry.duration, classification: 'unknown', topFrames: [], reason });
    if (offsetUs === null) return unknown('trace timing anchor unavailable');
    const start = entry.startTime * 1000 + offsetUs;
    const end = start + entry.duration * 1000;
    const overlap = (event: TraceEvent) => event.ts === undefined || event.dur === undefined ? 0 :
      Math.max(0, Math.min(event.ts + event.dur, end) - Math.max(event.ts, start));
    const run = timeline.filter((event) => event.name === 'RunTask' && overlap(event) > 0)
      .sort((a, b) => overlap(b) - overlap(a))[0];
    if (run?.ts === undefined || run.dur === undefined) return unknown('no overlapping trace task');
    const runStart = run.ts;
    const runEnd = run.ts + run.dur;
    const children = timeline.filter((event) => event.ts !== undefined && event.ts >= runStart && event.ts < runEnd &&
      ['FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame'].includes(event.name));
    const frames = children.flatMap((event): TaskFrame[] => {
      const data = event.args?.['data'];
      if (!data || typeof data !== 'object') return [];
      const values = data as { functionName?: unknown; url?: unknown; stackTrace?: unknown };
      const direct: TaskFrame = { event: event.name, functionName: typeof values.functionName === 'string' ? values.functionName : null,
        url: typeof values.url === 'string' ? values.url : null, durationMs: (event.dur ?? 0) / 1000 };
      const stack = Array.isArray(values.stackTrace) ? values.stackTrace.filter((frame): frame is { functionName?: string; url?: string } =>
        !!frame && typeof frame === 'object') : [];
      return [direct, ...stack.map((frame) => ({ event: event.name, functionName: frame.functionName ?? null,
        url: frame.url ?? null, durationMs: (event.dur ?? 0) / 1000 }))];
    }).filter((frame) => frame.functionName !== null || frame.url !== null);
    const motion = /surface-view-transitions|transcript-entrance|transcript-session-entrance|rail-pane-enter|SurfaceTransitionTracker|startViewTransition|ChatView|ChatTranscript|CanvasLaneView|CanvasRailBoard|onViewTransitionCreated|skipOnInput|afterTransition|chat-view\.component|chat-transcript\.component|canvas-lane-view\.component|canvas-rail-board\.component/i;
    const motionFrame = frames.some((frame) => motion.test(`${frame.functionName ?? ''} ${frame.url ?? ''}`));
    const namedFrame = frames.some((frame) => !!frame.functionName?.trim() && !/^(?:\(?anonymous\)?|<anonymous>)$/i.test(frame.functionName.trim()));
    return { startTime: entry.startTime, duration: entry.duration,
      classification: motionFrame ? 'motion' : namedFrame ? 'render' : 'unknown',
      topFrames: frames.sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
      ...(!motionFrame && !namedFrame ? { reason: 'no named frames' } : {}) };
  });
  return { tasks, stackAvailable };
}

function traceResult(events: TraceEvent[], tasks: TaskAttribution[]): Exclude<WindowRecord['trace'], 'unavailable'> {
  const main = findRendererMainThread(events);
  const inMain = main ? events.filter((e) => e.pid === main.pid && e.tid === main.tid) : events;
  const layouts = inMain.filter((e) => e.name === 'Layout');
  const stack = (e: TraceEvent) => JSON.stringify(e.args ?? {});
  return {
    droppedFrames: events.filter((e) => e.name === 'DroppedFrame' || (e.name.includes('PipelineReporter') && /dropped/i.test(stack(e)))).length,
    layoutCount: layouts.length,
    updateLayoutTreeCount: inMain.filter((e) => e.name === 'UpdateLayoutTree').length,
    forcedLayouts: null,
    motionForcedLayouts: null,
    motionLongTasks: tasks.filter((task) => task.duration > 50 && task.classification === 'motion').length,
    attribution: tasks.some((task) => task.classification === 'motion') ? 'motion' : tasks.some((task) => task.classification === 'render') ? 'render' : 'unknown',
    summary: main ? summarizeTraceEvents(events, main) : null,
  };
}

test.skip(!label, 'set PTAH_MOTION_LABEL=m0|m1 to record');
test('records Electron navigation and session motion S1-S8', async ({ ui, electronApp }) => {
  test.setTimeout(1_800_000);
  const runLabel = label ?? 'unlabeled';
  const framesDir = resolve(outputDir, `${runLabel}-frames`);
  if (!framesDir.startsWith(resolve(outputDir) + sep)) throw new Error('Frames path escaped measurements directory');
  const outputPath = join(outputDir, `${runLabel}.json`);
  const partialPath = join(outputDir, `${runLabel}.partial.json`);
  if (existsSync(outputPath) && process.env['PTAH_MOTION_OVERWRITE'] !== '1') throw new Error(`${outputPath} exists; set PTAH_MOTION_OVERWRITE=1 to replace it`);
  if (assertMotion && runLabel === 'm0') throw new Error('PTAH_MOTION_ASSERT=1 requires an M1 label; record M0 first');
  const baselinePath = join(outputDir, 'm0.json');
  if (assertMotion && !existsSync(baselinePath)) throw new Error('Record M0 first: measurements/m0.json is missing');
  const baseline = assertMotion ? JSON.parse(readFileSync(baselinePath, 'utf8')) as { probeVersion?: number; complete?: boolean; windows?: WindowRecord[] } : null;
  if (assertMotion && baseline?.probeVersion !== probeVersion) {
    throw new Error(`M1 requires M0 probe version ${probeVersion}; re-record m0.json with this recorder`);
  }
  if (assertMotion && (!baseline?.complete || !Array.isArray(baseline.windows) || Object.entries(expectedWindowCounts).some(([scenario, count]) => baseline.windows?.filter((row) => row.scenario === scenario).length !== count))) {
    throw new Error('M1 requires a complete M0 baseline with all 102 scenario windows');
  }
  if (process.env['PTAH_MOTION_OVERWRITE'] === '1') rmSync(outputPath, { force: true });
  rmSync(partialPath, { force: true });
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const page = ui.page;
  const rows: WindowRecord[] = [];
  const longTaskNeedsReview = () => rows.flatMap((row) => {
    const m0MaxMs = baseline?.windows?.find((old) => old.scenario === row.scenario && old.name === row.name)?.longTasks.maxMs;
    if (m0MaxMs === undefined || m0MaxMs > 50) return [];
    return (row.longTasks.attributedTasks ?? []).filter((task) => task.duration > 50 && task.classification === 'unknown')
      .map((task) => ({ name: row.name, maxMs: task.duration, m0MaxMs, reason: task.reason ?? 'unknown attribution' }));
  });
  let capability: { startViewTransition: string } | null = null;
  let chromeVersion: string | null = null;
  let beforeS2: CounterSample | null = null;
  let afterS2: CounterSample | null = null;
  let clickReceipt: Record<string, number> = {};
  let windowSize: { width: number; height: number } | null = null;
  let completed = false;
  const persist = (partial = true) => writeFileSync(partial ? partialPath : outputPath, JSON.stringify({ label: runLabel, probeVersion, complete: !partial, recordedAt: new Date().toISOString(), host: { platform: 'electron', windowSize }, selectors: { splitPane: splitPaneSelector }, capability: capability ? { ...capability, chromeVersion } : null, memoryS2: { before: beforeS2, afterGc: afterS2 }, clickReceipt,
    railShiftReport: rows.filter((row) => row.m0RailShiftsDelta !== null && row.m0RailShiftsDelta !== undefined && row.railShiftsDelta !== null && row.railShiftsDelta > row.m0RailShiftsDelta)
      .map((row) => ({ name: row.name, m0: row.m0RailShiftsDelta, m1: row.railShiftsDelta })),
    longTaskNeedsReview: longTaskNeedsReview(),
    longTaskReport: rows.map((row) => ({ scenario: row.scenario, name: row.name, maxMs: row.longTasks.maxMs, m0MaxMs: baseline?.windows?.find((old) => old.scenario === row.scenario && old.name === row.name)?.longTasks.maxMs ?? null,
      attribution: row.trace === 'unavailable' ? 'unknown' : row.trace.attribution, stackAvailable: row.longTasks.stackAvailable ?? false,
      note: row.longTasks.stackAvailable ? null : 'No stack frames in trace or trace timing anchor unavailable; attribution may be unknown', tasks: row.longTasks.attributedTasks ?? [] })), windows: rows }, null, 2));
  try {
  const sessions = Array.from({ length: 5 }, (_, i) => makeSessionFixture(`MOTION_RAIL_${i}`, 600));
  const unopened = Array.from({ length: 3 }, (_, i) => makeSessionFixture(`MOTION_NEW_${i}`, i === 0 ? 60 : 360));
  await ui.mockRpc({ 'workspace:getInfo': { folders: ['C:\\ptah-e2e-ws', 'C:\\ptah-e2e-ws-2'], activeFolder: 'C:\\ptah-e2e-ws' } });
  await ui.prepare();
  windowSize = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('Electron window unavailable');
    win.setSize(1800, 1000);
    const [width, height] = win.getSize();
    return { width, height };
  });
  await prepareCanvasWithSessions(ui, [...sessions, ...unopened]);
  capability = await page.evaluate(() => ({ startViewTransition: typeof document.startViewTransition }));
  chromeVersion = await electronApp.evaluate(() => process.versions.chrome);
  const nav = (name: string) => page.getByRole('tab', { name, exact: true });
  const cards = () => page.locator('ptah-canvas-rail-board:visible ptah-canvas-rail [data-rail-card]');
  const openAndFocusSession = async (name: string, minimumCards: number) => {
    await sessionRowButton(page, name).click();
    await expect.poll(() => cards().count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(minimumCards);
    await cards().getByRole('button', { name: `${name}, done` }).evaluate((el) => {
      (window as Window & { __ptahMotionProbe?: { rearm: () => void } }).__ptahMotionProbe?.rearm();
      (el as HTMLElement).click();
    });
    await expect(page.getByRole('region', { name: `Focused session: ${name}` })).toBeVisible({ timeout: 20_000 });
  };
  const sidebar = page.locator('ptah-workspace-sidebar');
  const snapshot = async () => page.evaluate(() => ({
    rail: document.querySelector('[data-canvas-rail-shifts]')?.getAttribute('data-canvas-rail-shifts') ?? null,
    focus: document.querySelector('[data-canvas-focus-swaps]')?.getAttribute('data-canvas-focus-swaps') ?? null,
  }));

  async function measure(scenario: Scenario, name: string, action: () => Promise<void>, reducedMotion = false, outcome: Record<string, unknown> = {}, targetRetained?: boolean): Promise<void> {
    let traceCapture: Awaited<ReturnType<typeof startTraceCapture>> = null;
    let cast: CDPSession | null = null;
    let traceStopped = false;
    const captured: { data: string; timestampMs: number }[] = [];
    const frames: { file: string; atMs: number }[] = [];
    const prefix = `${scenario.toLowerCase()}-${String(rows.filter((r) => r.scenario === scenario).length + 1).padStart(2, '0')}`;
    try {
      await installLongTaskObserver(page);
      traceCapture = await startTraceCapture(page);
      const traceAnchorMs = traceCapture ? await page.evaluate(() => performance.mark('ptah-motion-trace-anchor').startTime) : null;
      const before = await snapshot();
      const clicksBefore = scenario === 'S7' ? await page.evaluate(() => ({ ...(window as Window & { __ptahMotionClicks?: Record<string, number> }).__ptahMotionClicks })) : {};
      try {
        cast = await page.context().newCDPSession(page);
        const channel = cast;
        channel.on('Page.screencastFrame', (payload) => {
          captured.push({ data: payload.data, timestampMs: (payload.metadata.timestamp ?? Date.now() / 1000) * 1000 });
          void channel.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined);
        });
        await channel.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      } catch { await cast?.detach().catch(() => undefined); cast = null; }
      await installWindowProbe(page);
      await action();
      const timing = await page.evaluate(() => {
        const p = (window as Window & { __ptahMotionProbe?: { clickAt: number | null; arm: () => void } }).__ptahMotionProbe;
        const armed = p?.clickAt !== null && p?.clickAt !== undefined;
        if (!armed) p?.arm();
        return { armed, remaining: Math.max(0, 610 - (performance.now() - (p?.clickAt ?? performance.now()))) };
      });
      await page.waitForTimeout(timing.remaining);
      const probe = await page.evaluate(() => {
        const p = (window as Window & { __ptahMotionProbe?: { clickAt: number | null; visibleAtSwitch: string[]; clickTimes: number[]; clickListener: EventListener; pointerListener: EventListener; keyListener: EventListener; animationListener: EventListener; inputEvents: InputEventRecord[]; shifts: number; shiftsAll: number; observer: PerformanceObserver | null; samples: { at0?: Sample; at50?: Sample; at100?: Sample; at400?: Sample }; scrollFrames: ScrollSample[]; placements: PlacementRecord[]; viewTransitionEvents: AnimationRecord[]; splitPaneEvents: AnimationRecord[]; entranceEvents: EntranceRecord[] } }).__ptahMotionProbe;
        p?.observer?.disconnect();
        if (p) { document.removeEventListener('click', p.clickListener, true); document.removeEventListener('pointerdown', p.pointerListener, true); document.removeEventListener('keydown', p.keyListener, true); document.removeEventListener('animationstart', p.animationListener, true); document.removeEventListener('animationend', p.animationListener, true); }
        delete (window as Window & { __ptahMotionProbe?: typeof p }).__ptahMotionProbe;
        return p ? { clickAt: p.clickAt, clickEpochMs: performance.timeOrigin + (p.clickAt ?? 0), visibleAtSwitch: p.visibleAtSwitch, clickTimes: p.clickTimes, shifts: p.shifts, shiftsAll: p.shiftsAll, samples: p.samples, scrollFrames: p.scrollFrames, placements: p.placements, viewTransitionEvents: p.viewTransitionEvents, splitPaneEvents: p.splitPaneEvents, entranceEvents: p.entranceEvents, inputEvents: p.inputEvents,
          finalSurface: document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.getAttribute('title') ?? location.pathname } : null;
      });
      if (cast) {
        await cast.send('Page.stopScreencast').catch(() => undefined);
        await cast.detach().catch(() => undefined);
        cast = null;
      }
      const windowStartMs = probe?.clickAt ?? 0;
      for (const frame of captured) {
        const atMs = frame.timestampMs - (probe?.clickEpochMs ?? 0);
        if (atMs < -100 || atMs > 650) continue;
        const file = `${prefix}-${String(frames.length).padStart(3, '0')}.png`;
        writeFileSync(join(framesDir, file), Buffer.from(frame.data, 'base64'));
        frames.push({ file, atMs });
      }
      const entries = (await collectLongTasks(page)).filter((e) => e.startTime >= windowStartMs && e.startTime < windowStartMs + 600);
      const events = traceCapture ? await stopTraceCapture(traceCapture) : null;
      const attributed = attributeLongTasks(events, entries, traceAnchorMs);
      traceStopped = true;
      const after = await snapshot();
      const at0 = probe?.samples.at0;
      const at50 = probe?.samples.at50;
      const at100 = probe?.samples.at100;
      const at400 = probe?.samples.at400;
      if (!at0 || !at50 || !at100 || !at400) throw new Error(`${name}: measurement probe did not sample`);
      const placements = probe?.placements ?? [];
      const entranceEvents = probe?.entranceEvents ?? [];
      const firstVisible = entranceEvents.find((event) => event.source === 'start' && event.name === 'ptahPaneSwitchEnter' && event.visibleAtStart);
      const delta = (key: 'rail' | 'focus') => before[key] !== null && after[key] !== null && Number.isFinite(Number(before[key])) && Number.isFinite(Number(after[key])) ? Number(after[key]) - Number(before[key]) : null;
      const clicksAfter = scenario === 'S7' ? await page.evaluate(() => ({ ...(window as Window & { __ptahMotionClicks?: Record<string, number> }).__ptahMotionClicks })) : {};
      const receipt = Object.fromEntries(Object.entries(clicksAfter).map(([key, count]) => [key, count - (clicksBefore[key] ?? 0)]));
      rows.push({
        scenario, name, reducedMotion, armed: timing.armed, targetRetained,
        clickTimes: probe?.clickTimes ?? [], windowStartMs, windowEndMs: windowStartMs + 600,
        longTasks: { count: entries.length, maxMs: Math.max(0, ...entries.map((e) => e.duration)), sumMs: entries.reduce((n, e) => n + e.duration, 0), entries, perClick: bucketByClick(entries, (probe?.clickTimes ?? []).map((atMs, i) => ({ label: `click-${i}`, atMs }))), attributedTasks: attributed.tasks, stackAvailable: attributed.stackAvailable },
        layoutShift: probe?.shifts ?? 0, layoutShiftNoInput: probe?.shifts ?? 0, layoutShiftAll: probe?.shiftsAll ?? 0, trace: events ? traceResult(events, attributed.tasks) : 'unavailable',
        samples: { at0, at50, at100, at400 },
        viewTransitionStarted: (probe?.viewTransitionEvents ?? []).some((event) => event.phase === 'start'),
        viewTransitionEvents: probe?.viewTransitionEvents ?? [], splitPaneEvents: probe?.splitPaneEvents ?? [],
        entrance: { visibleAtSwitch: probe?.visibleAtSwitch ?? [], placements, events: entranceEvents,
          animatedCount: entranceEvents.filter((event) => event.source === 'start' && event.name === 'ptahPaneSwitchEnter').length,
          firstVisibleIndex: firstVisible?.entranceIndex ?? null, firstVisibleDelayMs: firstVisible?.delayMs ?? null },
        scrollFrames: probe?.scrollFrames ?? [], railShiftsDelta: delta('rail'),
        m0RailShiftsDelta: baseline?.windows?.find((old) => old.scenario === scenario && old.name === name)?.railShiftsDelta ?? null,
        focusSwapsDelta: delta('focus'),
        frames, screencast: frames.length ? 'available' : 'unavailable',
        outcome: scenario === 'S7' ? { ...outcome, clickReceipt: receipt, reached: name === 'pointer-during-transition' ? { Analytics: (receipt['Analytics'] ?? 0) > 0, Tasks: (receipt['Tasks'] ?? 0) > 0, 'tasks-button': (receipt['tasks-button'] ?? 0) > 0 } : null,
          inputEvents: name === 'pointer-during-transition' ? probe?.inputEvents ?? [] : null, finalSurface: probe?.finalSurface ?? null } : outcome,
      });
      persist();
    } finally {
      if (cast) { await cast.send('Page.stopScreencast').catch(() => undefined); await cast.detach().catch(() => undefined); }
      if (traceCapture && !traceStopped) await stopTraceCapture(traceCapture).catch(() => undefined);
      await page.evaluate(() => {
        const p = (window as Window & { __ptahMotionProbe?: { clickListener: EventListener; pointerListener: EventListener; keyListener: EventListener; animationListener: EventListener; observer: PerformanceObserver | null } }).__ptahMotionProbe;
        p?.observer?.disconnect();
        if (p) { document.removeEventListener('click', p.clickListener, true); document.removeEventListener('pointerdown', p.pointerListener, true); document.removeEventListener('keydown', p.keyListener, true); document.removeEventListener('animationstart', p.animationListener, true); document.removeEventListener('animationend', p.animationListener, true); }
        delete (window as Window & { __ptahMotionProbe?: typeof p }).__ptahMotionProbe;
      }).catch(() => undefined);
      await collectLongTasks(page).catch(() => undefined);
    }
  }

  // S1: ten complete Canvas -> Tasks -> Analytics -> Canvas round trips.
  for (let i = 0; i < 10; i++) {
    await measure('S1', `round-${i + 1}-tasks`, () => nav('Tasks').click());
    await measure('S1', `round-${i + 1}-analytics`, () => nav('Analytics').click());
    await measure('S1', `round-${i + 1}-canvas`, () => nav('Chat').click());
  }
  // Populate the four retained Rail tabs before recording focus swaps.
  for (const [index, session] of sessions.slice(0, 4).entries()) {
    await openAndFocusSession(session.name, index + 1);
  }
  const retainedTabIds = await cards().evaluateAll((els) => els.slice(0, 4).map((el) => el.getAttribute('data-tab-id')).filter((id): id is string => !!id));
  if (retainedTabIds.length !== 4) throw new Error('Expected four retained Rail cards');
  const retainedCard = (index: number) => page.locator(`ptah-canvas-rail-board:visible ptah-canvas-rail [data-rail-card][data-tab-id="${retainedTabIds[index]}"]`);
  beforeS2 = await counters(page);
  for (let i = 0; i < 10; i++) {
    await measure('S2', `retained-${i + 1}`, () => retainedCard(i % 4).click());
  }
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.detach();
    afterS2 = await counters(page);
  } catch { afterS2 = await counters(page); }
  const remainingS3 = [...sessions];
  for (let i = 0; i < sessions.length; i++) {
    const candidates = await Promise.all(remainingS3.map(async (session) => {
      const card = cards().filter({ hasText: session.name });
      const tabId = await card.count() ? await card.getAttribute('data-tab-id') : null;
      const retained = tabId !== null && await page.locator(`ptah-chat-transcript[data-tab-id="${tabId}"]`).count() > 0;
      return { session, retained };
    }));
    const chosen = candidates.find((candidate) => !candidate.retained) ?? candidates[0];
    if (!chosen) throw new Error('S3 candidate pool unexpectedly empty');
    if (chosen.retained) console.warn(`S3 ${i + 1}: no non-retained candidate; recording ${chosen.session.name} with targetRetained=true`);
    remainingS3.splice(remainingS3.indexOf(chosen.session), 1);
    await measure('S3', `non-retained-${i + 1}`, () => openAndFocusSession(chosen.session.name, 4), false, { targetSession: chosen.session.name }, chosen.retained);
  }
  for (const [i, session] of unopened.entries()) {
    await measure('S4', `first-open-${i + 1}`, () => openAndFocusSession(session.name, 5 + i));
  }
  // Restore the four original transcripts to the retention set for S5 and S6.
  for (const session of sessions.slice(0, 4)) {
    await openAndFocusSession(session.name, 4);
  }
  const clickCenter = async (target: Locator) => {
    const box = await target.boundingBox();
    if (!box) throw new Error('Pointer target has no visible bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await measure('S5', 'rapid-focus-five', async () => {
    for (let i = 0; i < 5; i++) {
      await clickCenter(retainedCard(i % 4));
      if (i < 4) await page.waitForTimeout(80);
    }
  });
  await measure('S5', 'rapid-page-three', async () => {
    for (const [i, target] of ['Tasks', 'Analytics', 'Chat'].entries()) {
      await clickCenter(nav(target));
      if (i < 2) await page.waitForTimeout(80);
    }
  });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 10; i++) {
    await measure('S6', `reduced-round-${i + 1}-tasks`, () => nav('Tasks').click(), true);
    await measure('S6', `reduced-round-${i + 1}-analytics`, () => nav('Analytics').click(), true);
    await measure('S6', `reduced-round-${i + 1}-canvas`, () => nav('Chat').click(), true);
  }
  for (let i = 0; i < 10; i++) {
    const target = retainedCard((i + 1) % 4);
    expect(await target.locator('ptah-compact-rail-card.rc-focused').count(), `S6 reduced-retained-${i + 1} target must differ from focus`).toBe(0);
    await measure('S6', `reduced-retained-${i + 1}`, () => target.click(), true);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // S7: capture actual click receipt in the capture phase, keyboard focus, and remount focus.
  await page.evaluate(() => {
    const w = window as Window & { __ptahMotionClicks?: Record<string, number> };
    w.__ptahMotionClicks = {};
    document.addEventListener('click', (event) => {
      const t = event.target as HTMLElement;
      const key = t.closest('[role="tab"]')?.getAttribute('title') ?? (t.closest('ptah-tasks-view button') ? 'tasks-button' : null);
      if (key) { const clicks = w.__ptahMotionClicks; if (clicks) clicks[key] = (clicks[key] ?? 0) + 1; }
    }, true);
  });
  await measure('S7', 'pointer-during-transition', async () => {
    await clickCenter(nav('Analytics'));
    await page.waitForTimeout(80);
    await clickCenter(nav('Tasks'));
    const button = page.locator('ptah-tasks-view button[data-testid="tasks-view-mode-list"]');
    if (await button.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false)) await clickCenter(button);
  });
  await measure('S7', 'keyboard-during-transition', async () => {
    await nav('Analytics').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  });
  await nav('Chat').click();
  await cards().first().locator('.rc-select').focus();
  expect(await cards().first().locator('.rc-select').evaluate((el) => el === document.activeElement), 'S7 focus precondition').toBe(true);
  await measure('S7', 'focus-restoration', async () => {
    await nav('Tasks').click();
  });
  await page.locator('[data-test="config-menu-item-thoth"]').click();
  // The Workspaces panel starts closed. Open it outside the measured window.
  await page.getByRole('button', { name: 'Toggle Workspaces panel' }).click();
  await expect(sidebar).toBeVisible();
  await measure('S7', 'workspace-remount-focus', async () => {
    await page.locator('ptah-thoth-shell button').first().focus();
    await sidebar.getByTitle('C:\\ptah-e2e-ws-2', { exact: true }).click();
  });
  // A workspace switch remounts the active configuration surface. Restore the
  // Thoth surface used at the start of this S7 window before leaving it.
  await ui.goto('thoth');
  await expect(page.locator('ptah-thoth-shell')).toBeVisible();
  clickReceipt = await page.evaluate(() => (window as Window & { __ptahMotionClicks?: Record<string, number> }).__ptahMotionClicks ?? {});
  await sidebar.getByTitle('C:\\ptah-e2e-ws', { exact: true }).click();
  await ui.goto('thoth');
  await expect(page.locator('ptah-thoth-shell')).toBeVisible();
  // The remount can leave Tasks selected in the original workspace. Re-enter
  // Chat explicitly and wait for the expanded Rail before starting S8.
  await ui.goto('canvas');
  await nav('Chat').click();
  await expect(nav('Chat'), 'S8 Canvas route after workspace remount').toHaveAttribute('aria-selected', 'true');
  for (const [index, session] of sessions.slice(0, 3).entries()) {
    if (await cards().filter({ hasText: session.name }).count() === 0) await openAndFocusSession(session.name, index + 1);
  }
  await expect.poll(() => cards().count(), { message: 'S8 requires three expanded Rail cards', timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await expect(cards().first(), 'S8 requires visible expanded Rail cards').toBeVisible();

  // S8: the menu is opened before each window; the split entrance is measured on the action click.
  const split = async (reduced: boolean) => {
    for (let i = 0; i < 2; i++) {
      await cards().nth(0).click();
      await cards().nth(2).getByRole('button', { name: 'Session actions' }).click();
      expect(await page.getByRole('menuitem', { name: 'Open beside' }).getAttribute('aria-disabled')).not.toBe('true');
      await measure(reduced ? 'S6' : 'S8', `${reduced ? 'reduced-' : ''}split-open-${i + 1}`, () => page.getByRole('menuitem', { name: 'Open beside' }).click(), reduced);
      await page.locator('[data-testid="rail-pane-container"] [data-pane-side]').first().getByRole('button', { name: 'More session actions' }).click();
      await measure(reduced ? 'S6' : 'S8', `${reduced ? 'reduced-' : ''}split-close-${i + 1}`, () => page.getByRole('menuitem', { name: 'Close split' }).click(), reduced);
    }
  };
  await split(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await split(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  if (assertMotion) {
    if (!baseline?.windows) throw new Error('Validated M0 baseline missing');
    for (const row of rows.filter((r) => r.scenario === 'S7')) {
      const old = baseline.windows.find((r) => r.scenario === 'S7' && r.name === row.name);
      expect.soft(old, `M0 focus record for ${row.name}`).toBeDefined();
      for (const sample of ['at0', 'at100', 'at400'] as const) {
        expect.soft(row.samples[sample].focus, `${row.name} ${sample} focus vs M0`).toEqual(old?.samples[sample].focus);
      }
    }
    const pointer = rows.find((r) => r.scenario === 'S7' && r.name === 'pointer-during-transition');
    const reached = pointer?.outcome['reached'] as Record<string, boolean> | undefined;
    for (const target of ['Analytics', 'Tasks', 'tasks-button']) expect.soft(reached?.[target], `S7 ${target} click receipt`).toBe(true);
    for (const row of rows) {
      const oldRow = baseline.windows.find((old) => old.scenario === row.scenario && old.name === row.name);
      expect.soft(oldRow, `${row.name} M0 record`).toBeDefined();
      if (oldRow) {
        if (row.scenario === 'S8' || row.name.includes('split-')) {
          expect.soft(row.layoutShift, `${row.name} layout shift without recent input vs M0`).toBeLessThanOrEqual(oldRow.layoutShift + 0.001);
        } else {
          expect.soft(row.layoutShiftAll, `${row.name} layout shift including recent input vs M0`).toBeLessThanOrEqual(oldRow.layoutShiftAll + 0.001);
        }
        expect.soft(!(row.longTasks.attributedTasks ?? []).some((task) => task.duration > Math.max(50, oldRow.longTasks.maxMs) && task.classification === 'motion'), `${row.name} new motion-caused >50 ms long task versus M0`).toBe(true);
        if (oldRow.longTasks.maxMs <= 50) {
          expect.soft(!(row.longTasks.attributedTasks ?? []).some((task) => task.duration > 50 && task.classification === 'unknown'), `${row.name} new >50 ms long task with unknown attribution`).toBe(true);
        }
      }
      if (row.scenario === 'S2' || row.name === 'rapid-focus-five' || row.name.startsWith('reduced-retained-')) {
        expect.soft(row.focusSwapsDelta, `${row.name} focus swaps`).toBe(row.name === 'rapid-focus-five' ? 5 : 1);
      }
      if (row.reducedMotion) {
        expect.soft((row.samples.at50.animationDetails ?? []).filter((animation) => animation.type === 'CSSAnimation' && animation.name === 'ptahPaneSwitchEnter' && animation.target.includes('chat-scroll-container')).length, row.name).toBe(0);
        if (row.name.includes('split-')) expect.soft(row.splitPaneEvents.filter((event) => event.phase === 'start').length, `${row.name} reduced split entrance`).toBe(0);
      }
      if (row.scenario === 'S2' || row.scenario === 'S3' || row.scenario === 'S4') {
        const animated = row.entrance.events.filter((event) => event.source === 'start' && event.name === 'ptahPaneSwitchEnter');
        if (row.scenario === 'S2') expect.soft(animated.length, `${row.name} entrance exists`).toBeGreaterThan(0);
        if (animated.length > 0) {
          expect.soft(animated.every((event) => event.visibleAtStart), `${row.name} entrance viewport`).toBe(true);
          expect.soft(animated.length, `${row.name} one pane entrance`).toBe(1);
          expect.soft(row.entrance.firstVisibleDelayMs, `${row.name} first visible delay`).toBe(0);
        }
      }
      expect.soft(row.entrance.events.filter((event) => event.name === 'ptahStaggerUp').length, `${row.name} old stagger absent`).toBe(0);
      if (row.scenario === 'S8' && row.name.includes('open')) {
        expect.soft(row.samples.at50.splitPanes, row.name).toBe(2);
        expect.soft(row.splitPaneEvents.filter((event) => event.phase === 'start').length, `${row.name} split entrance`).toBeGreaterThan(0);
      }
    }
    for (const target of ['tasks', 'analytics', 'canvas']) {
      expect.soft(rows.filter((r) => r.scenario === 'S1' && r.name.endsWith(target)).some((r) => r.viewTransitionStarted), `S1 ${target} transition`).toBe(true);
    }
    expect.soft(rows.filter((r) => r.scenario === 'S1' && r.name.endsWith('canvas')).every((r) => r.samples.at100.viewTransition), 'S1 return to Chat stays active at +100 ms').toBe(true);
    expect.soft(rows.filter((r) => r.scenario === 'S6').every((r) => !r.viewTransitionStarted && Object.values(r.samples).every((sample) => !sample.viewTransition)), 'S6 view transitions absent').toBe(true);
  }
  for (const [scenario, count] of Object.entries(expectedWindowCounts)) {
    if (rows.filter((row) => row.scenario === scenario).length !== count) throw new Error(`Incomplete ${scenario} recording: expected ${count} windows`);
  }
  persist(false);
  rmSync(partialPath, { force: true });
  completed = true;
  } finally {
    if (!completed) { try { persist(true); } catch { /* preserve the original failure */ } }
  }
});
