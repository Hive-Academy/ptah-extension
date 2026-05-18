import { inject, injectable } from 'tsyringe';

const FIXTURE_TOKENS = {
  TOKEN_THAT_IS_NEVER_REGISTERED: Symbol.for(
    'FIXTURE_TOKEN_THAT_IS_NEVER_REGISTERED',
  ),
};

@injectable()
export class FixtureClassWithUnregisteredInject {
  constructor(
    @inject(FIXTURE_TOKENS.TOKEN_THAT_IS_NEVER_REGISTERED)
    private readonly missing: unknown,
  ) {}
}
