import { inject, injectable } from 'tsyringe';

const DEFAULT_FIXTURE_TOKEN = Symbol.for('DEFAULT_FIXTURE_TOKEN');

@injectable()
class InjectedDependency {
  constructor(@inject(DEFAULT_FIXTURE_TOKEN) readonly provider?: unknown) {}
}

@injectable()
class SelfContainedDependency {
  constructor(readonly options: { enabled?: boolean } = {}) {}
}

class ProcessStartTimeProbe {
  constructor(readonly options: { clock?: () => number } = {}) {}
}

@injectable()
export class FixtureClassWithDefaultEquivalenceCases {
  private readonly unsafeBody: InjectedDependency;
  private readonly probe: ProcessStartTimeProbe;

  constructor(
    private readonly unsafeInitializer: InjectedDependency = new InjectedDependency(),
    private readonly safeInitializer: SelfContainedDependency = new SelfContainedDependency(),
    unsafeBody?: InjectedDependency,
    probe?: ProcessStartTimeProbe,
  ) {
    this.unsafeBody = unsafeBody ?? new InjectedDependency();
    this.probe = probe ?? new ProcessStartTimeProbe();
  }
}
