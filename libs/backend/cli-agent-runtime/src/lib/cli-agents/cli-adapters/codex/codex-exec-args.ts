/**
 * The argv one `codex exec` turn runs with (TASK_2026_597, D2).
 *
 * Same grammar and order as `@openai/codex-sdk` `CodexExec.run`
 * (`dist/index.js`, 0.155.1) for the flags Ptah sets, so the command-line
 * guard measures what the SDK will spawn. The direct runner (S1b) passes it to
 * the child unchanged.
 */

export interface CodexExecArgsInput {
  /** `key=value` entries, each passed as one `--config` argument. */
  readonly configOverrides: readonly string[];
  readonly model?: string;
  readonly sandboxMode?: string;
  readonly workingDirectory?: string;
  readonly skipGitRepoCheck?: boolean;
  /** Thread to resume; adds `resume <id>`. */
  readonly resumeThreadId?: string;
}

export function codexExecArgs(input: CodexExecArgsInput): string[] {
  const args = ['exec', '--experimental-json'];
  for (const entry of input.configOverrides) {
    args.push('--config', entry);
  }
  if (input.model) args.push('--model', input.model);
  if (input.sandboxMode) args.push('--sandbox', input.sandboxMode);
  if (input.workingDirectory) args.push('--cd', input.workingDirectory);
  if (input.skipGitRepoCheck) args.push('--skip-git-repo-check');
  if (input.resumeThreadId) args.push('resume', input.resumeThreadId);
  return args;
}
