/**
 * Adapts `CliDetectionService` to the harness reconciler's `IHarnessCliDetector`
 * port.
 *
 * The dependency direction is the whole reason this file exists here rather
 * than in `harness-sync`. `cli-agent-runtime` already depends on `harness-sync`
 * (its MCP install surface reconciles), so `harness-sync` must never depend
 * back on it. A three-line port and this adapter keep the reconciler a leaf.
 *
 * Detection results are cached inside `CliDetectionService` after the first
 * call, so a reconcile that consults six targets costs one probe, not six. A
 * detector that throws answers "not installed": a reconcile must degrade to
 * skipping a target, never fail the pass.
 */

import type {
  CliDetectionResult,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type { IHarnessCliDetector } from '@ptah-extension/harness-sync';

/** The slice of `CliDetectionService` the detector needs. */
export interface HarnessCliDetectionReader {
  detectAll(): Promise<CliDetectionResult[]>;
}

/**
 * Build an `IHarnessCliDetector` over a lazily resolved detection service.
 *
 * Lazy because host DI registers `harness-sync` before `cli-agent-runtime`;
 * a `null` reader (or one that throws) yields "nothing installed", which the
 * reconciler reports as `target-absent` rather than treating as an error.
 */
export function createHarnessCliDetector(
  readerFactory: () => HarnessCliDetectionReader | null,
): IHarnessCliDetector {
  return {
    async isInstalled(target: HarnessTargetId): Promise<boolean> {
      // `claude` and `vscode` are not probed CLIs — their targets answer
      // `detect()` themselves and never reach this adapter. Guarding here too
      // keeps a future caller from getting a surprising `false`.
      if (target === 'claude' || target === 'vscode') return true;

      try {
        const reader = readerFactory();
        if (reader === null) return false;
        const results = await reader.detectAll();
        return results.some(
          (result) => result.cli === target && result.installed,
        );
      } catch {
        return false;
      }
    },
  };
}
