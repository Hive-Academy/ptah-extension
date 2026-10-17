/**
 * Routing questions for the live decision-model eval (`system-one.live.spec.ts`).
 *
 * Each fixture is one `choice` question with exactly one defensible answer, so
 * a correct model never has a reason to pick another option. Option labels are
 * the anonymous `o1..oN` labels the product sends. The correct label is spread
 * over positions on purpose, so a model that always answers `o1` fails.
 *
 * Every request body is validated against `SystemOneRequestBodySchema` when
 * this module loads, so a malformed fixture fails loudly before any network
 * call is made.
 */
import {
  SystemOneRequestBodySchema,
  type SystemOneRequestBody,
} from './system-one.schema';

export interface LiveRoutingFixture {
  /** Stable name used in assertion messages. */
  readonly id: string;
  /** The user request the question is about. */
  readonly request: string;
  readonly instructions: string;
  /** Option label (`o1..oN`) -> option text. */
  readonly criteria: Readonly<Record<string, string>>;
  /** The one label a correct model answers with. */
  readonly expected: string;
}

const QUESTION_KEY = 'route';

const INSTRUCTIONS =
  'Pick the single option that is best suited to carry out the request.';

export const LIVE_ROUTING_FIXTURES: readonly LiveRoutingFixture[] = [
  {
    id: 'sql-migration',
    request:
      'Write a SQL migration that adds a nullable created_at column to the orders table.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a designer who draws logos and brand artwork',
      o2: 'a database engineer who writes schema migrations',
      o3: 'a translator who converts text between languages',
    },
    expected: 'o2',
  },
  {
    id: 'logo-design',
    request: 'Draw a new logo for our bakery with a wheat motif.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a designer who draws logos and brand artwork',
      o2: 'a database engineer who writes schema migrations',
      o3: 'a tax accountant who prepares returns',
    },
    expected: 'o1',
  },
  {
    id: 'translate-french',
    request: 'Translate this paragraph from English into French.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a database engineer who writes schema migrations',
      o2: 'a tax accountant who prepares returns',
      o3: 'a translator who converts text between languages',
    },
    expected: 'o3',
  },
  {
    id: 'tax-return',
    request: 'Prepare my annual income tax return from these receipts.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a tax accountant who prepares returns',
      o2: 'a translator who converts text between languages',
      o3: 'a designer who draws logos and brand artwork',
      o4: 'a database engineer who writes schema migrations',
    },
    expected: 'o1',
  },
  {
    id: 'task-kind-bugfix',
    request:
      'The login button throws a null pointer error when the form is empty. Make it stop crashing.',
    instructions: 'Pick the kind of task this request is.',
    criteria: {
      o1: 'write brand new documentation',
      o2: 'fix a defect in existing code',
      o3: 'plan a long term roadmap',
    },
    expected: 'o2',
  },
  {
    id: 'task-kind-docs',
    request: 'Write a README that explains how to install and run this tool.',
    instructions: 'Pick the kind of task this request is.',
    criteria: {
      o1: 'fix a defect in existing code',
      o2: 'plan a long term roadmap',
      o3: 'write brand new documentation',
    },
    expected: 'o3',
  },
  {
    id: 'depth-trivial',
    request: 'Rename the variable x to count on line 12 of utils.ts.',
    instructions: 'Pick the depth of effort this request needs.',
    criteria: {
      o1: 'trivial: a single small mechanical edit',
      o2: 'deep: a multi-week redesign across many systems',
      o3: 'moderate: a feature spanning several files',
    },
    expected: 'o1',
  },
  {
    id: 'depth-large',
    request:
      'Redesign our whole billing platform: new data model, new payment providers, migrate every customer, and keep it running with no downtime.',
    instructions: 'Pick the depth of effort this request needs.',
    criteria: {
      o1: 'trivial: a single small mechanical edit',
      o2: 'moderate: a feature spanning several files',
      o3: 'deep: a multi-week redesign across many systems',
    },
    expected: 'o3',
  },
  {
    id: 'unit-tests',
    request:
      'Write unit tests for the parseDate function covering leap years and invalid input.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a translator who converts text between languages',
      o2: 'a tester who writes and runs automated unit tests',
      o3: 'a designer who draws logos and brand artwork',
    },
    expected: 'o2',
  },
  {
    id: 'security-review',
    request:
      'Review this login endpoint for SQL injection and other security vulnerabilities.',
    instructions: INSTRUCTIONS,
    criteria: {
      o1: 'a tax accountant who prepares returns',
      o2: 'a translator who converts text between languages',
      o3: 'a database engineer who writes schema migrations',
      o4: 'a security reviewer who audits code for vulnerabilities',
    },
    expected: 'o4',
  },
];

/** The request body the client would send for `fixture` on `model`. */
export function buildFixtureBody(
  model: string,
  fixture: LiveRoutingFixture,
): SystemOneRequestBody {
  return SystemOneRequestBodySchema.parse({
    model,
    state: {
      request: fixture.request,
      availableExecutors: {},
      pastOutcomes: {},
    },
    questions: {
      [QUESTION_KEY]: {
        type: 'choice',
        instructions: fixture.instructions,
        criteria: { ...fixture.criteria },
      },
    },
  });
}

/** The answer key of the one question in a fixture body. */
export const LIVE_QUESTION_KEY = QUESTION_KEY;

// Fail loudly at load: every fixture must build a valid body, and its expected
// label must be one of its own options.
for (const fixture of LIVE_ROUTING_FIXTURES) {
  buildFixtureBody('fixture-validation', fixture);
  if (!Object.prototype.hasOwnProperty.call(fixture.criteria, fixture.expected)) {
    throw new Error(
      `live fixture "${fixture.id}" expects "${fixture.expected}", which is not one of its options`,
    );
  }
}
