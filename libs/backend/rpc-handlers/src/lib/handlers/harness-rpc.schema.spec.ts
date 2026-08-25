/**
 * `NewProjectIntakeSchema` — the TS/Zod parity gate for the New Project intake.
 *
 * The interesting property is not "does zod reject rubbish" but "does the Zod
 * enum still admit exactly what the TypeScript union admits". Those were two
 * hand-written lists before TASK_2026_270 Batch 4; they are now one `as const`
 * tuple each, and these cases prove the schema is actually built from them
 * rather than from a copy that happens to agree today.
 *
 * The assertions are behavioural (parse every member) rather than structural
 * (read `schema.shape`), because the exported schema is a transform pipe and
 * poking at its internals would test zod, not us.
 */

import {
  NEW_PROJECT_PLATFORM_VALUES,
  NEW_PROJECT_STACK_VALUES,
  STACK_PROFILES,
} from '@ptah-extension/shared';
import type { NewProjectIntake } from '@ptah-extension/shared';
import {
  HarnessRepairBlockedParamsSchema,
  NewProjectIntakeSchema,
} from './harness-rpc.schema';

const BASE = {
  what: 'A booking tool for physiotherapy clinics',
  audience: 'b2b',
  stack: 'recommend',
} as const;

describe('NewProjectIntakeSchema — platform', () => {
  it.each(NEW_PROJECT_PLATFORM_VALUES)('accepts platform %s', (platform) => {
    expect(NewProjectIntakeSchema.parse({ ...BASE, platform }).platform).toBe(
      platform,
    );
  });

  it('accepts an intake with no platform, and does not invent one', () => {
    // Absence is the wire encoding of "node-ts", and `renderIntakeBlock` reads
    // the key's presence to decide whether the prompt mentions a platform at
    // all — a default written in here would put a line in every prompt.
    const parsed = NewProjectIntakeSchema.parse(BASE);
    expect(parsed.platform).toBeUndefined();
    expect('platform' in parsed).toBe(false);
  });

  it('rejects a platform that is not in the registry', () => {
    expect(() =>
      NewProjectIntakeSchema.parse({ ...BASE, platform: 'rust' }),
    ).toThrow();
  });
});

describe('NewProjectIntakeSchema — stack', () => {
  it.each(NEW_PROJECT_STACK_VALUES)('accepts stack %s', (stack) => {
    expect(NewProjectIntakeSchema.parse({ ...BASE, stack }).stack).toBe(stack);
  });

  it('accepts every chip the registry actually renders', () => {
    // The end-to-end statement of parity: a chip a user can click is a value
    // the boundary admits. A profile gaining an option it forgot to add to
    // NEW_PROJECT_STACK_VALUES fails here, not in production.
    for (const profile of STACK_PROFILES) {
      for (const option of profile.stackOptions) {
        expect(() =>
          NewProjectIntakeSchema.parse({
            ...BASE,
            platform: profile.id,
            stack: option.value,
          }),
        ).not.toThrow();
      }
    }
  });

  it('rejects a stack value no profile offers', () => {
    expect(() =>
      NewProjectIntakeSchema.parse({ ...BASE, stack: 'svelte-kit' }),
    ).toThrow();
  });

  it('keeps the free text only when the stack is `other`', () => {
    expect(
      NewProjectIntakeSchema.parse({
        ...BASE,
        stack: 'other',
        stackOther: 'Elixir + Phoenix',
      }).stackOther,
    ).toBe('Elixir + Phoenix');

    expect(
      NewProjectIntakeSchema.parse({
        ...BASE,
        stack: 'aspnetcore-api',
        stackOther: 'stale value',
      }).stackOther,
    ).toBeUndefined();
  });
});

describe('NewProjectIntakeSchema — assignability', () => {
  it('parses into something the prompt builder accepts as a NewProjectIntake', () => {
    // The compile-time half of parity: if the Zod output ever widened past the
    // TS union, this annotation would stop compiling.
    const parsed: NewProjectIntake = NewProjectIntakeSchema.parse({
      ...BASE,
      platform: 'dotnet',
      stack: 'aspnetcore-blazor',
      constraints: 'On-premise only',
    });

    expect(parsed).toMatchObject({
      platform: 'dotnet',
      stack: 'aspnetcore-blazor',
      constraints: 'On-premise only',
    });
  });

  it('still requires a non-empty brief', () => {
    expect(() =>
      NewProjectIntakeSchema.parse({ ...BASE, what: '   ' }),
    ).toThrow();
  });
});

/**
 * `HarnessRepairBlockedParamsSchema` — the boundary of the one RPC in this lib
 * that MOVES a directory the user may have written by hand (TASK_2026_306
 * Batch 8 / Task 8.3).
 *
 * The schema is not the authorization gate — `HarnessBlockedRepairService`
 * re-derives the blocked set and refuses anything outside it. What these cases
 * pin is the SHAPE: no bulk selection, an empty list that is legal rather than
 * an error, and nothing that could not be a workspace-relative POSIX path.
 */
describe('HarnessRepairBlockedParamsSchema', () => {
  const path = (relPath: string) => ({
    paths: [{ target: 'claude', relPath }],
  });

  it('accepts a per-path selection', () => {
    expect(
      HarnessRepairBlockedParamsSchema.parse(path('.claude/skills/alpha'))
        .paths,
    ).toEqual([{ target: 'claude', relPath: '.claude/skills/alpha' }]);
  });

  it('accepts an EMPTY selection — a declined dialog is a no-op, not an error', () => {
    // `.min(1)` here would force the UI to special-case "the user ticked
    // nothing", and the service treats an empty list as "run no pass at all".
    expect(HarnessRepairBlockedParamsSchema.parse({ paths: [] }).paths).toEqual(
      [],
    );
  });

  it('has no bulk shape at all: an "all" flag is REJECTED, not quietly stripped', () => {
    // The selection IS the ownership claim (U3). Stripping would let a caller
    // who believes they asked for "repair everything" get a silent no-op and
    // never learn the method has no such mode; `.strict()` makes the
    // misconception an error.
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse({ paths: [], all: true }),
    ).toThrow();
  });

  it('rejects an unknown key on an individual path entry too', () => {
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse({
        paths: [
          { target: 'claude', relPath: '.claude/skills/alpha', force: true },
        ],
      }),
    ).toThrow();
  });

  it('rejects a traversal segment', () => {
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse(path('.claude/skills/../../etc')),
    ).toThrow();
  });

  it('rejects an absolute path, POSIX or Windows', () => {
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse(path('/etc/passwd')),
    ).toThrow();
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse(path('C:/Windows/System32')),
    ).toThrow();
  });

  it('rejects a backslash separator, which no `relPath` in a health report uses', () => {
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse(path('.claude\\skills\\alpha')),
    ).toThrow();
  });

  it('rejects an unknown target id', () => {
    expect(() =>
      HarnessRepairBlockedParamsSchema.parse({
        paths: [{ target: 'gemini', relPath: '.claude/skills/alpha' }],
      }),
    ).toThrow();
  });

  it('rejects a missing `paths` — a caller that sends nothing is a bug, not a decline', () => {
    expect(() => HarnessRepairBlockedParamsSchema.parse({})).toThrow();
  });
});
