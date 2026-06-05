import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';

export interface ICuratorAuthResolver {
  resolve(curatorProviderId: string): Promise<OneShotAuthOverride | null>;
}
