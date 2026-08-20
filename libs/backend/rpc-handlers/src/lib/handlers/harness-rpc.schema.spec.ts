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
import { NewProjectIntakeSchema } from './harness-rpc.schema';

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
