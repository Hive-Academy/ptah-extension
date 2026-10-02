import type {
  GitMutationFailureCode,
  GitStatusUnavailableReason,
} from '../types/rpc/rpc-git.types';
import {
  GIT_FETCH_TIMEOUT_MS,
  GIT_HOOK_TIMEOUT_MS,
  GIT_INDEX_LOCK_RETRY_DELAYS_MS,
  GIT_LOCKED_MESSAGE,
  GIT_RPC_TIMEOUT_MARGIN_MS,
  gitRpcTimeoutFor,
} from './git-operation.constants';

/**
 * Exhaustive by construction: a missing key or an extra one is a type error,
 * so these records pin each union to exactly the listed members.
 */
const STATUS_UNAVAILABLE_REASONS: Record<GitStatusUnavailableReason, true> = {
  'output-too-large': true,
  timeout: true,
  error: true,
  locked: true,
};

const MUTATION_FAILURE_CODES: Record<GitMutationFailureCode, true> = {
  LOCKED: true,
  HOOK_FAILED: true,
  TIMEOUT: true,
  CANCELLED: true,
  GIT_ERROR: true,
};

describe('git operation contracts', () => {
  it('declares exactly four status-unavailable reasons', () => {
    expect(Object.keys(STATUS_UNAVAILABLE_REASONS).sort()).toEqual([
      'error',
      'locked',
      'output-too-large',
      'timeout',
    ]);
  });

  it('declares exactly five mutation failure codes', () => {
    expect(Object.keys(MUTATION_FAILURE_CODES).sort()).toEqual([
      'CANCELLED',
      'GIT_ERROR',
      'HOOK_FAILED',
      'LOCKED',
      'TIMEOUT',
    ]);
  });
});

describe('git operation constants', () => {
  it('gives hook-running commands 10 minutes and fetch 5 minutes', () => {
    expect(GIT_HOOK_TIMEOUT_MS).toBe(600_000);
    expect(GIT_FETCH_TIMEOUT_MS).toBe(300_000);
  });

  it('adds the 15 s margin to a backend timeout', () => {
    expect(GIT_RPC_TIMEOUT_MARGIN_MS).toBe(15_000);
    expect(gitRpcTimeoutFor(600_000)).toBe(615_000);
    expect(gitRpcTimeoutFor(GIT_FETCH_TIMEOUT_MS)).toBe(315_000);
  });

  it('retries index.lock five times with doubling backoff totalling 3,100 ms', () => {
    expect(GIT_INDEX_LOCK_RETRY_DELAYS_MS).toEqual([100, 200, 400, 800, 1600]);
    const total = GIT_INDEX_LOCK_RETRY_DELAYS_MS.reduce(
      (sum, delay) => sum + delay,
      0,
    );
    expect(total).toBe(3_100);
  });

  it('words a lock failure without git stderr', () => {
    expect(GIT_LOCKED_MESSAGE).toBe(
      'Another git process is using this repository.',
    );
    expect(GIT_LOCKED_MESSAGE).not.toMatch(/index\.lock|fatal|error:/i);
  });
});
