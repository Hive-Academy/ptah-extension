import { resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import {
  CodexSelectionSnapshot,
  createNodeCodexExecutableProbes,
  type CodexExecutableSelection,
  type CodexSelection,
  type CodexSelectionSnapshotPort,
} from '@ptah-extension/codex-runtime';

export type CodexLaneBinary = CodexExecutableSelection & {
  /** Selection captured for this lane open, including its one-shot bundled fallback. */
  readonly selection?: CodexSelection;
};

export interface CodexLaneBinaryProbe {
  resolve(explicitPath?: string): Promise<CodexLaneBinary | undefined>;
}

/** Select a supported native executable afresh for each detection or lane open. */
export class NativeCodexLaneBinaryProbe implements CodexLaneBinaryProbe {
  constructor(private readonly snapshot: CodexSelectionSnapshotPort = new CodexSelectionSnapshot(
    createNodeCodexExecutableProbes(async () => resolveCodexNativeBinaryPath()),
  )) {}

  async resolve(explicitPath?: string): Promise<CodexLaneBinary> {
    const selection = await this.snapshot.selectForOpen();
    const selected = selection.selected;
    if (explicitPath && explicitPath !== selected.path)
      throw new Error('Codex executable does not match the selected executable');
    return { ...selected, selection };
  }
}
