import 'reflect-metadata';
import { createMockOutputChannel } from '../mocks/output-channel.mock';
import { runOutputChannelContract } from './run-output-channel-contract';

runOutputChannelContract('createMockOutputChannel', () =>
  createMockOutputChannel({ name: 'self-test' }),
);
