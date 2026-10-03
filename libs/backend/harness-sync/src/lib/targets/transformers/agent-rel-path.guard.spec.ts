/**
 * Drift guard: the webview's agent-path rule must equal the transformers'
 * (TASK_2026_609, C1 test (e)).
 *
 * `harnessAgentRelPath` in `@ptah-extension/shared` restates where each target
 * writes an agent copy, because the webview cannot import this lib. Agent cards
 * match it against `agentsInSync`, so if a transformer's `relPathFor` changed
 * and the shared rule did not, every chip would silently read "not synced".
 * This spec is what makes that change fail loudly instead.
 */

import {
  HARNESS_AGENT_CHIP_TARGETS,
  HARNESS_TARGET_IDS,
  harnessAgentRelPath,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import { ManagedManifestStore } from '../../manifest-store/managed-manifest';
import type { IHarnessCliDetector } from '../../sources/harness-source.port';
import { createRivalTargets } from '../rival-targets';
import type { IHarnessAgentTransformer } from './agent-transformer.port';
import { CodexAgentTransformer } from './codex-agent-transformer';
import { CopilotAgentTransformer } from './copilot-agent-transformer';
import { CursorAgentTransformer } from './cursor-agent-transformer';
import { OpencodeAgentTransformer } from './opencode-agent-transformer';

const TRANSFORMERS: Partial<Record<HarnessTargetId, IHarnessAgentTransformer>> =
  {
    codex: new CodexAgentTransformer(),
    copilot: new CopilotAgentTransformer(),
    cursor: new CursorAgentTransformer(),
    opencode: new OpencodeAgentTransformer(),
  };

const SLUGS = ['backend-developer', 'a2', 'team.leader', 'x'];

const NEVER_INSTALLED: IHarnessCliDetector = {
  isInstalled: () => Promise.resolve(false),
};

describe('harnessAgentRelPath — agrees with every agent transformer (TASK_2026_609)', () => {
  it.each(Object.entries(TRANSFORMERS))(
    '%s: equals transformer.relPathFor for every slug',
    (target, transformer) => {
      for (const slug of SLUGS) {
        expect(harnessAgentRelPath(target as HarnessTargetId, slug)).toBe(
          transformer?.relPathFor(slug),
        );
      }
    },
  );

  it('answers null exactly for the targets that write no agent copy', () => {
    const withCopies = new Set(Object.keys(TRANSFORMERS));
    for (const target of HARNESS_TARGET_IDS) {
      const path = harnessAgentRelPath(target, 'backend-developer');
      if (withCopies.has(target)) expect(path).not.toBeNull();
      else expect(path).toBeNull();
    }
  });

  it('covers every rival target whose agents facet is supported, and only those', () => {
    const targets = createRivalTargets({
      manifestStore: new ManagedManifestStore(),
      detector: NEVER_INSTALLED,
      homeDir: '/nonexistent-home',
    });
    const supported = targets
      .filter((target) => target.facets.agents === 'supported')
      .map((target) => target.id)
      .sort();

    expect(supported).toEqual(Object.keys(TRANSFORMERS).sort());
    for (const target of targets) {
      const path = harnessAgentRelPath(target.id, 'a2');
      if (path === null) continue;
      // The copy lands inside a directory the target declares it manages.
      const dir = path.slice(0, path.lastIndexOf('/'));
      expect(target.managedDirs?.()).toContain(dir);
    }
  });

  it('chip targets are distinct, exclude vscode, and include every target with an agent copy', () => {
    expect(new Set(HARNESS_AGENT_CHIP_TARGETS).size).toBe(
      HARNESS_AGENT_CHIP_TARGETS.length,
    );
    expect(HARNESS_AGENT_CHIP_TARGETS).not.toContain('vscode');
    for (const target of Object.keys(TRANSFORMERS)) {
      expect(HARNESS_AGENT_CHIP_TARGETS).toContain(target);
    }
  });
});
