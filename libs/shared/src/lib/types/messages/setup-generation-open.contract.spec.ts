import { MESSAGE_TYPES } from './message-constants';
import type { StrictMessageType } from './message-type';
import type { MessagePayloadMap, SetupGenerationOpenPayload } from './payload-map';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _RegisteredPayload = Assert<
  Equal<
    MessagePayloadMap[typeof MESSAGE_TYPES.SETUP_GENERATION_OPEN],
    SetupGenerationOpenPayload
  >
>;

const push: SetupGenerationOpenPayload = {
  workspacePath: '/workspace',
  workflow: 'setup-agent-generation',
  origin: 'analysis-result-continue',
};

describe('SETUP_GENERATION_OPEN contract', () => {
  it('has a registered, typed host-to-main payload', () => {
    const type: StrictMessageType = MESSAGE_TYPES.SETUP_GENERATION_OPEN;
    expect(type).toBe('setup-generation:open');
    expect(push).toEqual({
      workspacePath: '/workspace',
      workflow: 'setup-agent-generation',
      origin: 'analysis-result-continue',
    });
  });
});
