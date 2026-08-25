import 'reflect-metadata';

import type { HookInput } from './claude-sdk.types';
import {
  isSubagentStartHook,
  isSubagentStopHook,
  isPreToolUseHook,
  isPostToolUseHook,
  isPostToolUseFailureHook,
  isStopHook,
  isStopFailureHook,
  isUserPromptSubmitHook,
  isUserPromptExpansionHook,
  isSessionStartHook,
  isSessionEndHook,
  isSetupHook,
  isWorktreeCreateHook,
  isWorktreeRemoveHook,
  isTaskCreatedHook,
  isTaskCompletedHook,
  isTeammateIdleHook,
} from './claude-sdk.types';

/**
 * Truth-table coverage for every `is<Event>Hook` type guard exported from
 * claude-sdk.types.ts, verified against the SDK's own `HOOK_EVENTS` list.
 *
 * `HOOK_EVENTS` below is transcribed verbatim from
 * node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:780 (the vendored
 * SDK's own declaration — not guessed). It is NOT `require()`-imported live
 * from the package here because `@anthropic-ai/claude-agent-sdk` ships
 * ESM-only ("type": "module") and this workspace's ts-jest pipeline
 * transforms specs to CommonJS; a live `require('@anthropic-ai/claude-
 * agent-sdk')` fails Jest with "Jest encountered an unexpected token" on
 * sdk.mjs's trailing `export {...}` statement (confirmed while writing this
 * spec — Node's own `require()` can load the ESM package directly via its
 * newer sync-ESM interop, but Jest's CJS-transform runtime cannot). Cross-
 * checked at authoring time: `node -e "console.log(require('@anthropic-
 * ai/claude-agent-sdk').HOOK_EVENTS)"` printed the identical 29-entry array
 * in the identical order as the .d.ts declaration below.
 *
 * Each guard must:
 *   1. Return true for exactly the one HookInput.hook_event_name it targets.
 *   2. Return false for every other real SDK hook event name.
 *
 * `TaskCreatedHookInput`, `TaskCompletedHookInput`, and `TeammateIdleHookInput`
 * (the "teammates phase 1" additions, commit 6c4733a02) are re-exported
 * type-only from the SDK package itself (see the `export type { ... } from
 * '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' }`
 * block at the top of claude-sdk.types.ts) rather than hand-copied — so
 * there is no possibility of the TS *type* drifting from the SDK. The guards
 * below are pure runtime discriminant checks (`hook_event_name === X`); this
 * spec is what proves that discriminant check is wired to the same string
 * literal the SDK actually emits.
 */
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const;

function makeInput(hookEventName: string): HookInput {
  return {
    session_id: 'sess-1',
    transcript_path: '/t.jsonl',
    cwd: '/workspace',
    hook_event_name: hookEventName,
  } as unknown as HookInput;
}

// Every guard exported from claude-sdk.types.ts, keyed by the exact SDK
// hook_event_name it should — and only should — match.
const GUARD_TABLE: ReadonlyArray<{
  name: string;
  event: string;
  guard: (input: HookInput) => boolean;
}> = [
  {
    name: 'isSubagentStartHook',
    event: 'SubagentStart',
    guard: isSubagentStartHook,
  },
  {
    name: 'isSubagentStopHook',
    event: 'SubagentStop',
    guard: isSubagentStopHook,
  },
  { name: 'isPreToolUseHook', event: 'PreToolUse', guard: isPreToolUseHook },
  { name: 'isPostToolUseHook', event: 'PostToolUse', guard: isPostToolUseHook },
  {
    name: 'isPostToolUseFailureHook',
    event: 'PostToolUseFailure',
    guard: isPostToolUseFailureHook,
  },
  { name: 'isStopHook', event: 'Stop', guard: isStopHook },
  { name: 'isStopFailureHook', event: 'StopFailure', guard: isStopFailureHook },
  {
    name: 'isUserPromptSubmitHook',
    event: 'UserPromptSubmit',
    guard: isUserPromptSubmitHook,
  },
  {
    name: 'isUserPromptExpansionHook',
    event: 'UserPromptExpansion',
    guard: isUserPromptExpansionHook,
  },
  {
    name: 'isSessionStartHook',
    event: 'SessionStart',
    guard: isSessionStartHook,
  },
  { name: 'isSessionEndHook', event: 'SessionEnd', guard: isSessionEndHook },
  { name: 'isSetupHook', event: 'Setup', guard: isSetupHook },
  {
    name: 'isWorktreeCreateHook',
    event: 'WorktreeCreate',
    guard: isWorktreeCreateHook,
  },
  {
    name: 'isWorktreeRemoveHook',
    event: 'WorktreeRemove',
    guard: isWorktreeRemoveHook,
  },
  // --- teammates phase 1 (6c4733a02) ---
  { name: 'isTaskCreatedHook', event: 'TaskCreated', guard: isTaskCreatedHook },
  {
    name: 'isTaskCompletedHook',
    event: 'TaskCompleted',
    guard: isTaskCompletedHook,
  },
  {
    name: 'isTeammateIdleHook',
    event: 'TeammateIdle',
    guard: isTeammateIdleHook,
  },
];

describe("claude-sdk.types hook guards — truth table against the SDK's HOOK_EVENTS", () => {
  it('HOOK_EVENTS (transcribed from sdk.d.ts) contains every event this spec targets', () => {
    expect(HOOK_EVENTS.length).toBe(29);
    for (const { event } of GUARD_TABLE) {
      expect(HOOK_EVENTS).toContain(event);
    }
  });

  for (const { name, event, guard } of GUARD_TABLE) {
    describe(name, () => {
      it(`returns true for its own event ('${event}')`, () => {
        expect(guard(makeInput(event))).toBe(true);
      });

      it('returns false for every other real SDK hook event', () => {
        const others = HOOK_EVENTS.filter((e) => e !== event);
        expect(others.length).toBeGreaterThan(0);
        for (const other of others) {
          expect(guard(makeInput(other))).toBe(false);
        }
      });
    });
  }

  describe('teammate lifecycle guards — mutual exclusivity', () => {
    it('exactly one of isTaskCreatedHook / isTaskCompletedHook / isTeammateIdleHook is true per input', () => {
      const cases: Array<{ event: string; expected: string }> = [
        { event: 'TaskCreated', expected: 'isTaskCreatedHook' },
        { event: 'TaskCompleted', expected: 'isTaskCompletedHook' },
        { event: 'TeammateIdle', expected: 'isTeammateIdleHook' },
      ];

      for (const { event, expected } of cases) {
        const input = makeInput(event);
        const results = {
          isTaskCreatedHook: isTaskCreatedHook(input),
          isTaskCompletedHook: isTaskCompletedHook(input),
          isTeammateIdleHook: isTeammateIdleHook(input),
        };
        const trueGuards = Object.entries(results)
          .filter(([, v]) => v)
          .map(([k]) => k);
        expect(trueGuards).toEqual([expected]);
      }
    });
  });

  describe('narrowed field access after guard passes', () => {
    it('isTaskCreatedHook narrows task_id/task_subject/teammate_name/team_name', () => {
      const input = {
        session_id: 'sess-1',
        transcript_path: '/t.jsonl',
        cwd: '/workspace',
        hook_event_name: 'TaskCreated',
        task_id: 'task-1',
        task_subject: 'subject',
        teammate_name: 'reviewer',
        team_name: 'default',
      } as unknown as HookInput;

      expect(isTaskCreatedHook(input)).toBe(true);
      if (isTaskCreatedHook(input)) {
        expect(input.task_id).toBe('task-1');
        expect(input.task_subject).toBe('subject');
        expect(input.teammate_name).toBe('reviewer');
        expect(input.team_name).toBe('default');
      }
    });

    it('isTeammateIdleHook narrows teammate_name/team_name', () => {
      const input = {
        session_id: 'sess-1',
        transcript_path: '/t.jsonl',
        cwd: '/workspace',
        hook_event_name: 'TeammateIdle',
        teammate_name: 'reviewer',
        team_name: 'default',
      } as unknown as HookInput;

      expect(isTeammateIdleHook(input)).toBe(true);
      if (isTeammateIdleHook(input)) {
        expect(input.teammate_name).toBe('reviewer');
        expect(input.team_name).toBe('default');
      }
    });
  });
});
