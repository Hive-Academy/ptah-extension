import 'reflect-metadata';
import { createMockTokenCounter } from '../mocks/token-counter.mock';
import { runTokenCounterContract } from './run-token-counter-contract';

runTokenCounterContract('createMockTokenCounter', () =>
  createMockTokenCounter(),
);
