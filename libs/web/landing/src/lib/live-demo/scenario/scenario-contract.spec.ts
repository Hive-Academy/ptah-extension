import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MESSAGE_TYPES, RPC_METHOD_NAMES, TabId } from '@ptah-extension/shared';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { ReplayMessage, ReplayScenario } from './replay-scenario.types';

const dir = join(__dirname, '../scenarios');
const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
const rpcNames = new Set<string>(RPC_METHOD_NAMES);
const messageNames = new Set<string>(Object.values(MESSAGE_TYPES));

describe('replay scenario contract', () => {
  it('has at least one scenario and fresh generated type fixtures', () => {
    expect(files.length).toBeGreaterThan(0);
    const root = join(__dirname, '../../../../../../..');
    expect(() => execFileSync(process.execPath, ['scripts/landing/generate-live-demo-types.mjs', '--check'], { cwd: root })).not.toThrow();
  });

  for (const file of files) {
    it(`${file} follows the protocol`, () => {
      const scenario = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ReplayScenario;
      expect(scenario.id).toBe(file.slice(0, -5));
      expect(scenario.id).toMatch(/^[a-z0-9-]+$/);
      expect(Number.isFinite(scenario.timeBase)).toBe(true);
      expect(scenario.config).toEqual(expect.objectContaining({ initialView: expect.any(String), workspaceRoot: '/workspace/acme-app' }));
      for (const section of [scenario.rpc, scenario.rpcCases, scenario.rpcErrors]) {
        for (const method of Object.keys(section ?? {})) expect(rpcNames.has(method)).toBe(true);
      }
      const messages: ReplayMessage[] = [];
      const inspect = (message: ReplayMessage, collected: ReplayMessage[]) => {
        expect(message.type).not.toBe('rpc:response');
        expect(messageNames.has(message.type)).toBe(true);
        if (message.type === 'batch') message.payload.events.forEach((event) => inspect(event, collected));
        else collected.push(message);
      };
      const bootMessages: ReplayMessage[] = [];
      const onSend = scenario.start?.mode === 'on-send';
      if (scenario.start) expect(['auto', 'on-send']).toContain(scenario.start.mode);
      if (onSend) expect(scenario.start?.prompt).toEqual(expect.any(String));
      else expect(Array.isArray(scenario.bootMessages)).toBe(true);
      for (const message of scenario.bootMessages ?? []) inspect(message, bootMessages);
      const switchViews = bootMessages.filter((message): message is Extract<ReplayMessage, { type: 'switchView' }> => message.type === 'switchView');
      expect(switchViews).toHaveLength(onSend ? 0 : 1);
      const listedSessionIds = new Set(scenario.rpc['session:list']?.sessions.map((session) => session.id) ?? []);
      for (const switchView of switchViews) {
        expect(switchView.payload.view).toBe(scenario.config.initialView);
        expect(switchView.payload.sessionId).toBeTruthy();
        expect(listedSessionIds.has(switchView.payload.sessionId ?? '')).toBe(true);
      }
      const bootSessionId = onSend ? scenario.rpc['chat:start']?.sessionId : switchViews[0]?.payload.sessionId;
      let previous = -1;
      for (const entry of scenario.timeline) {
        expect(Number.isFinite(entry.at)).toBe(true);
        expect(entry.at).toBeGreaterThanOrEqual(0);
        expect(entry.at).toBeGreaterThanOrEqual(previous);
        previous = entry.at;
        expect(entry.message.type).not.toBe('rpc:response');
        expect(messageNames.has(entry.message.type)).toBe(true);
        inspect(entry.message, messages);
      }
      for (const message of messages) {
        if (message.type === 'chat:chunk' || message.type === 'chat:complete' || message.type === 'session:turnEnded') {
          expect(message.payload.sessionId).toBe(bootSessionId);
          expect(message.payload).not.toHaveProperty('tabId');
        }
      }
      const visitIds = (value: unknown, path: string[] = []) => {
        if (Array.isArray(value)) { value.forEach((child, index) => visitIds(child, [...path, String(index)])); return; }
        if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
          if (/(?:^|[A-Z])(?:tabId|sessionId)$/i.test(key) && typeof child === 'string') {
            expect(TabId.validate(child)).toBe(true);
          }
          visitIds(child, [...path, key]);
        }
      };
      visitIds(scenario);
      const events: FlatStreamEventUnion[] = [];
      for (const message of messages) if (message.type === 'chat:chunk') events.push(message.payload.event as FlatStreamEventUnion);
      const turns = new Map<string, { generating: boolean; completed: boolean }>();
      for (const event of events) {
        const sessionId = event.sessionId as string;
        const turn = turns.get(sessionId) ?? { generating: false, completed: false };
        if (event.eventType === 'turn_state' && event.phase === 'generating') {
          turn.generating = true;
          turn.completed = false;
        }
        if (event.eventType === 'message_start' && event.role === 'assistant') {
          expect(turn.generating).toBe(true);
        }
        if (event.eventType === 'message_complete') turn.completed = true;
        if (event.eventType === 'turn_state' && event.phase === 'idle') {
          expect(turn.generating).toBe(true);
          expect(turn.completed).toBe(true);
          turn.generating = false;
          turn.completed = false;
        }
        turns.set(sessionId, turn);
      }
    });
  }
});
