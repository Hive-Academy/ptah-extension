import { provenanceLabel } from '../lib/types/library-provenance';
import * as barrel from './index';

describe('@ptah-extension/shared/testing barrel', () => {
  it('re-exports every documented utility', () => {
    const expected: readonly string[] = [
      'createMockLogger',
      'createFakeAsyncGenerator',
      'createTestContainer',
      'resetTestContainer',
      'registerMatchers',
      'toBeSessionId',
      'toMatchRpcSuccess',
      'toMatchRpcError',
      'makeCorrelationId',
      'resetCorrelationIdCounter',
      'freezeTime',
      'expectNormalizedPath',
      'toPosixPath',
      'makeLibraryAgreementFixtures',
    ];

    for (const name of expected) {
      expect(barrel).toHaveProperty(name);
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('exports the Library agreement fixtures as fresh, labelled scenarios', () => {
    const first = barrel.makeLibraryAgreementFixtures();
    const second = barrel.makeLibraryAgreementFixtures();

    expect(Object.keys(first).sort()).toEqual([
      'communitySkill',
      'disabledPluginEditedClone',
      'pluginUpdateDiverged',
      'pluginWithSkillsAndAgents',
      'shadowedAgent',
      'shadowedSkill',
      'twoExternalPluginsOneBasename',
      'uninstalledPluginEditedClone',
    ]);
    expect(first).not.toBe(second);
    expect(first.shadowedSkill.plugins[0]).not.toBe(
      second.shadowedSkill.plugins[0],
    );

    for (const fixture of Object.values(first)) {
      expect(fixture.listClones.scopeRoot).toBe(
        barrel.LIBRARY_AGREEMENT_SCOPE_ROOT,
      );
      const keys = fixture.listClones.clones.map(
        (clone) => `${clone.kind}:${clone.slug}`,
      );
      expect(Object.keys(fixture.expectedLabels).sort()).toEqual(keys.sort());
      for (const clone of fixture.listClones.clones) {
        expect(provenanceLabel(clone.provenance)).toBe(
          fixture.expectedLabels[`${clone.kind}:${clone.slug}`],
        );
      }
    }
  });
});
