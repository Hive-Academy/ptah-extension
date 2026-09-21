import { inject, injectable } from 'tsyringe';

const FIXTURE_TOKENS = {
  REGISTERED_TOKEN: Symbol.for('FIXTURE_REGISTERED_TOKEN'),
};

export class FixtureCollaborator {
  readState(): string {
    return 'state';
  }
}

/**
 * Planted violation for the missing-@inject detector.
 *
 * `collaborator` is a REQUIRED constructor parameter with no injection
 * decorator. Production bundles carry no `design:paramtypes`, so tsyringe
 * cannot infer it from the type and passes `undefined` instead — silently.
 *
 * `optionalOne` and `withDefault` must NOT be reported: an omitted value is
 * the declared intent there, so `undefined` is not a surprise.
 */
@injectable()
export class FixtureClassWithMissingInject {
  constructor(
    @inject(FIXTURE_TOKENS.REGISTERED_TOKEN)
    private readonly decorated: unknown,
    private readonly collaborator: FixtureCollaborator,
    private readonly optionalOne?: FixtureCollaborator,
    private readonly withDefault: number = 5,
  ) {}
}
