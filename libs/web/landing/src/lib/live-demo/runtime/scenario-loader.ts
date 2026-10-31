import type { ReplayScenarioData } from './types';
import { shiftRecordedTimes } from './time-shift';

// The bridge is a classic script. currentScript is only available during synchronous evaluation.
const scriptVersion = (document.currentScript as HTMLScriptElement | null)?.dataset?.['scenarioVersion'];
const scenarioVersion = scriptVersion && /^[a-f0-9]{8}$/.test(scriptVersion) ? scriptVersion : undefined;

export interface ReplayQuery { id: string; autoplay: boolean; speed: number }
export class ReplayScenarioError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ReplayScenarioError'; }
}

const objectMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (value: unknown): value is ReplayScenarioData['timeline'][number]['message'] =>
  objectMap(value) && typeof value['type'] === 'string';

export function readReplayQuery(search = location.search): ReplayQuery {
  const params = new URLSearchParams(search);
  const id = params.get('scenario') ?? 'chat-tool-call';
  if (!/^[a-z0-9-]+$/.test(id)) throw new ReplayScenarioError('INVALID_SCENARIO_ID', 'Invalid PtahCode scenario id');
  const speed = Number(params.get('speed') ?? '1');
  return { id, autoplay: params.get('autoplay') !== '0', speed: Number.isFinite(speed) ? Math.min(8, Math.max(0.25, speed)) : 1 };
}

export async function loadScenario(query: ReplayQuery, baseURI = document.baseURI): Promise<ReplayScenarioData> {
  const url = new URL(`scenarios/${query.id}.json`, baseURI);
  if (scenarioVersion) url.searchParams.set('v', scenarioVersion);
  let response: Response;
  try { response = await fetch(url.href); }
  catch (error) { throw new ReplayScenarioError('SCENARIO_FETCH', `PtahCode scenario fetch failed: ${String(error)}`); }
  if (!response.ok) throw new ReplayScenarioError('SCENARIO_HTTP', `PtahCode scenario HTTP ${response.status}`);
  let value: unknown;
  try { value = await response.json(); }
  catch (error) { throw new ReplayScenarioError('SCENARIO_JSON', `Invalid PtahCode scenario JSON: ${String(error)}`); }
  if (!objectMap(value) || value['id'] !== query.id || !Number.isFinite(value['timeBase']) || !Array.isArray(value['timeline']))
    throw new ReplayScenarioError('SCENARIO_SHAPE', 'Invalid PtahCode scenario header or timeline');
  if (!objectMap(value['config']) || !objectMap(value['rpc']) ||
    (value['rpcCases'] !== undefined && !objectMap(value['rpcCases'])) ||
    (value['rpcErrors'] !== undefined && !objectMap(value['rpcErrors'])))
    throw new ReplayScenarioError('SCENARIO_RPC_MAP', 'PtahCode scenario config and RPC fields must be object maps');
  if (Object.values(value['rpcCases'] ?? {}).some((cases) => !Array.isArray(cases) || cases.some((entry) =>
    !objectMap(entry) || !objectMap(entry['match']))) ||
    Object.values(value['rpcErrors'] ?? {}).some((entry) => !objectMap(entry) || typeof entry['error'] !== 'string'))
    throw new ReplayScenarioError('SCENARIO_RPC_MAP', 'PtahCode scenario RPC cases or errors are invalid');
  if (value['start'] !== undefined && (!objectMap(value['start']) || !(['auto', 'on-send'].includes(String(value['start']['mode']))) || (value['start']['mode'] === 'on-send' && typeof value['start']['prompt'] !== 'string')))
    throw new ReplayScenarioError('SCENARIO_START', 'Invalid PtahCode start mode');
  if (value['bootMessages'] !== undefined && (!Array.isArray(value['bootMessages']) || !value['bootMessages'].every(message)))
    throw new ReplayScenarioError('SCENARIO_BOOT_MESSAGES', 'PtahCode bootMessages must contain messages');
  let previousAt = -Infinity;
  for (const entry of value['timeline']) {
    if (!objectMap(entry) || typeof entry['at'] !== 'number' || !Number.isFinite(entry['at']) ||
      entry['at'] < 0 || entry['at'] < previousAt || !message(entry['message']))
      throw new ReplayScenarioError('SCENARIO_TIMELINE', 'PtahCode timeline needs finite ascending at values and typed messages');
    previousAt = entry['at'];
  }
  const scenario = value as unknown as ReplayScenarioData;
  // Shift once at load; pausing or changing speed never re-shifts recorded timestamps.
  return { ...value,
    rpc: shiftRecordedTimes(scenario.rpc, scenario.timeBase),
    rpcCases: shiftRecordedTimes(scenario.rpcCases, scenario.timeBase),
    timeline: scenario.timeline.map((entry) => ({ ...entry, message: shiftRecordedTimes(entry.message, scenario.timeBase) })),
    bootMessages: shiftRecordedTimes(scenario.bootMessages, scenario.timeBase),
  } as ReplayScenarioData;
}
