import { z } from 'zod';
import type { RepoIdentity } from '@ptah-extension/review-contracts';

export const ReviewShaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
export const ReviewRelativePathSchema = z.string().min(1).max(1024).refine(
  (value) => !value.includes('\\') && !value.startsWith('/') &&
    value.split('/').every((part) => part !== '..' && part !== '.' && part !== ''),
  'Expected a relative repository path',
);

export interface ReviewCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  unavailable?: string;
}

/** Implementations must spawn argv directly, set cwd, and enforce timeoutMs. */
export interface IReviewCommandRunner {
  run(repo: RepoIdentity, command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<ReviewCommandResult>;
}

export interface IReviewContextFiles {
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const REVIEW_CONTEXT_TOKENS = {
  COMMAND_RUNNER: Symbol.for('ReviewContextCommandRunner'),
  FILES: Symbol.for('ReviewContextFiles'),
} as const;
