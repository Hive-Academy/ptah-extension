import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import {
  bucketByClick,
  bucketByMarker,
  findRendererMainThread,
  summarizeTraceEvents,
  type CpuProfile,
  type LongTaskEntry,
} from './perf-diagnostics';
import {
  checkTileScrollSanity,
  collectRafAttribution,
  stopTraceCapture,
  type OpenTilesResult,
  type RafAttributionRow,
  type TraceCapture,
} from './perf-page-capture';
import type { SessionFixture } from './perf-session-fixture';

export interface MeasurementSummary {
  readonly entries: LongTaskEntry[];
  readonly preWindowExcluded: { count: number; totalMs: number };
  readonly perClick: ReturnType<typeof bucketByClick>;
  readonly perMarker: ReturnType<typeof bucketByMarker>;
  readonly maxDuration: number;
  readonly totalDuration: number;
}

interface MeasurementUsabilityDiagnostics {
  readonly outputDirectory: string;
  readonly scenario: string;
}

export interface OptionalDiagnostics {
  readonly rafAttribution: RafAttributionRow[];
  readonly traceSummary: ReturnType<typeof summarizeTraceEvents> | null;
}

export function resolvePerfOutputDirectory(
  override: string | undefined,
): string {
  return override ?? path.join(os.tmpdir(), 'ptah-perf');
}

export function writeDiagnostics(
  outputDirectory: string,
  name: string,
  data: unknown,
): void {
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const file = path.join(
      outputDirectory,
      `ac11-perf-${name}-${Date.now()}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[AC-11 perf] wrote diagnostics: ${file}`);
  } catch (error: unknown) {
    console.warn(
      `[AC-11 perf] failed to write diagnostics for "${name}":`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function writeCpuProfile(
  outputDirectory: string,
  profile: CpuProfile,
): void {
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const profilePath = path.join(
      outputDirectory,
      `ac11-perf-cold-3tile-${Date.now()}.cpuprofile`,
    );
    fs.writeFileSync(profilePath, JSON.stringify(profile), 'utf8');
    console.log(`[AC-11 perf] wrote raw CPU profile: ${profilePath}`);
  } catch (error: unknown) {
    console.warn(
      '[AC-11 perf] failed to write raw CPU profile:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function summarizeMeasurement(
  observed: readonly LongTaskEntry[],
  openResult: OpenTilesResult,
  sessions: readonly SessionFixture[],
): MeasurementSummary {
  const preWindow = observed.filter(
    (entry) => entry.startTime < openResult.windowStartMs,
  );
  const entries = observed.filter(
    (entry) =>
      entry.startTime >= openResult.windowStartMs &&
      entry.startTime <= openResult.windowEndMs,
  );
  const clickPoints = sessions.map((session, index) => ({
    label: session.marker,
    atMs: openResult.clickTimes[index],
  }));
  const markerPoints = sessions.map((session, index) => ({
    label: session.marker,
    atMs: openResult.markerTimes[index],
  }));
  return {
    entries,
    preWindowExcluded: {
      count: preWindow.length,
      totalMs: preWindow.reduce((sum, entry) => sum + entry.duration, 0),
    },
    perClick: bucketByClick(entries, clickPoints),
    perMarker: bucketByMarker(entries, markerPoints),
    maxDuration: entries.reduce(
      (max, entry) => Math.max(max, entry.duration),
      0,
    ),
    totalDuration: entries.reduce((sum, entry) => sum + entry.duration, 0),
  };
}

export function logMeasurementBuckets(
  scenario: string,
  measurement: MeasurementSummary,
): void {
  for (const [basis, buckets] of [
    ['click', measurement.perClick],
    ['marker', measurement.perMarker],
  ] as const) {
    console.log(`[AC-11 perf][${scenario}] per-tile bucket by ${basis}:`);
    for (const bucket of buckets) {
      console.log(
        `[AC-11 perf][${scenario}]   ${bucket.label}: count=${bucket.count} ` +
          `max=${bucket.maxMs.toFixed(2)}ms total=${bucket.totalMs.toFixed(2)}ms`,
      );
    }
  }
}

export function assertUsableMeasurement(
  openResult: OpenTilesResult,
  diagnostics: MeasurementUsabilityDiagnostics,
): void {
  if (openResult.measurementError) {
    writeDiagnostics(
      diagnostics.outputDirectory,
      `${diagnostics.scenario}-measurement-unusable`,
      {
        scenario: diagnostics.scenario,
        measurementUsable: false,
        measurementError: openResult.measurementError,
        openResult,
      },
    );
    throw new Error(
      `[AC-11 perf] measurement unusable: ${openResult.measurementError}`,
    );
  }
  if (!openResult.ok) {
    throw new Error(
      `[AC-11 perf] tiles did not all render their markers within the window ` +
        `(timedOut=${openResult.timedOut}); measurement is unusable for this run`,
    );
  }
  if (!openResult.settled) {
    throw new Error(
      '[AC-11 perf] measurement unusable: tiles did not settle within 10 s',
    );
  }
}

export async function assertScrollSanity(
  page: Page,
  sessions: readonly SessionFixture[],
): Promise<void> {
  const failures = await checkTileScrollSanity(
    page,
    sessions.map((session) => session.marker),
  );
  if (failures.length > 0) {
    throw new Error(
      `[AC-11 functional] scroll sanity failed: ${JSON.stringify(failures)}`,
    );
  }
}

export async function captureOptionalDiagnostics(
  page: Page,
  traceCapture: TraceCapture | null,
  rafEnabled: boolean,
): Promise<OptionalDiagnostics> {
  const rafAttribution = rafEnabled ? await collectRafAttribution(page) : [];
  if (!traceCapture) return { rafAttribution, traceSummary: null };
  const events = await stopTraceCapture(traceCapture);
  const mainThread = findRendererMainThread(events);
  if (!mainThread) {
    throw new Error(
      '[AC-11 perf] trace unusable: renderer main thread metadata not found',
    );
  }
  return {
    rafAttribution,
    traceSummary: summarizeTraceEvents(events, mainThread),
  };
}
