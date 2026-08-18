import {
  createScratchRepo,
  type ScratchRepo,
} from '../../support/git-scratch-repo';

/**
 * The sample project the git screenshots are taken against.
 *
 * The first capture pass pointed the app at this repository, and the app did
 * what it does with any workspace it opens: it rewrote `.codex/agents/*.toml`
 * through its CLI agent sync, and a click in the Source Control panel staged 81
 * real files. Documentation screenshots must not be able to touch a developer's
 * work, so the git surfaces are captured against a throwaway repo instead —
 * which also makes the frames reproducible on any machine, rather than showing
 * whatever happened to be dirty that afternoon.
 *
 * The content is a small, plausible TypeScript service: real-looking code, no
 * secrets, no customer names.
 */

const PRICING_BASELINE = `import type { Plan, Quote } from './types';

const TAX_RATE = 0.2;

export function quoteFor(plan: Plan, seats: number): Quote {
  const subtotal = plan.monthlyPrice * seats;
  const tax = subtotal * TAX_RATE;

  return {
    plan: plan.name,
    seats,
    subtotal,
    tax,
    total: subtotal + tax,
  };
}

export function annualDiscount(quote: Quote): Quote {
  return {
    ...quote,
    total: quote.total * 12,
  };
}
`;

const PRICING_MODIFIED = `import type { Plan, Quote } from './types';

const TAX_RATE = 0.2;
const ANNUAL_DISCOUNT = 0.15;

export function quoteFor(plan: Plan, seats: number): Quote {
  const subtotal = plan.monthlyPrice * seats;
  const tax = subtotal * TAX_RATE;

  return {
    plan: plan.name,
    seats,
    subtotal,
    tax,
    total: subtotal + tax,
  };
}

export function annualDiscount(quote: Quote): Quote {
  const yearly = quote.total * 12;

  return {
    ...quote,
    total: yearly * (1 - ANNUAL_DISCOUNT),
  };
}
`;

const ROUTES_BASELINE = `import { Router } from './router';
import { quoteFor } from './pricing';
import { plans } from './plans';

export const routes = new Router();

routes.get('/plans', () => plans);

routes.post('/quote', (req) => {
  const plan = plans.find((p) => p.id === req.body.planId);
  if (!plan) return { status: 404 };

  return quoteFor(plan, req.body.seats);
});
`;

const ROUTES_MODIFIED = `import { Router } from './router';
import { quoteFor, annualDiscount } from './pricing';
import { plans } from './plans';

export const routes = new Router();

routes.get('/plans', () => plans);

routes.post('/quote', (req) => {
  const plan = plans.find((p) => p.id === req.body.planId);
  if (!plan) return { status: 404 };

  const quote = quoteFor(plan, req.body.seats);
  return req.body.billing === 'annual' ? annualDiscount(quote) : quote;
});
`;

const README_BASELINE = `# Billing service

A small pricing and quoting service.

## Endpoints

- \`GET /plans\` — list the available plans
- \`POST /quote\` — price a plan for a number of seats
`;

const README_MODIFIED = `# Billing service

A small pricing and quoting service.

## Endpoints

- \`GET /plans\` — list the available plans
- \`POST /quote\` — price a plan for a number of seats, monthly or annual

## Annual billing

Annual quotes apply a 15% discount to the yearly total.
`;

/**
 * A repo with a committed baseline and three modified files plus one new file —
 * enough for the Source Control panel to look like real work in progress, and
 * small enough that the diff reads at documentation resolution.
 */
export function createDocsSampleRepo(): ScratchRepo {
  const repo = createScratchRepo();

  repo.write('src/pricing.ts', PRICING_BASELINE);
  repo.write('src/api/routes.ts', ROUTES_BASELINE);
  repo.write(
    'src/plans.ts',
    `export const plans = [
  { id: 'starter', name: 'Starter', monthlyPrice: 12 },
  { id: 'team', name: 'Team', monthlyPrice: 29 },
  { id: 'scale', name: 'Scale', monthlyPrice: 79 },
];
`,
  );
  repo.write('README.md', README_BASELINE);
  // The app writes its own agent/skill scaffolding into every workspace it
  // opens. Ignore it, or the Source Control panel in the shot is mostly
  // untracked dot-folders instead of the three edits the frame is about.
  repo.write(
    '.gitignore',
    [
      '.agents/',
      '.claude/',
      '.codex/',
      '.gemini/',
      '.github/',
      '.opencode/',
      '.ptah/',
      '.mcp.json',
      'AGENTS.md',
    ].join('\n') + '\n',
  );
  repo.git('add', '.');
  repo.git('commit', '-m', 'Add pricing service');

  repo.write('src/pricing.ts', PRICING_MODIFIED);
  repo.write('src/api/routes.ts', ROUTES_MODIFIED);
  repo.write('README.md', README_MODIFIED);
  repo.write(
    'src/pricing.spec.ts',
    `import { quoteFor, annualDiscount } from './pricing';

describe('annualDiscount', () => {
  it('applies the yearly discount', () => {
    const quote = quoteFor({ id: 'team', name: 'Team', monthlyPrice: 29 }, 5);
    expect(annualDiscount(quote).total).toBeLessThan(quote.total * 12);
  });
});
`,
  );

  return repo;
}
