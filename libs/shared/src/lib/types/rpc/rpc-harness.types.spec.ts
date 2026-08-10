/**
 * Spec for the harness skill-selection backward-compat contract.
 *
 * `selectedSkills` stays a `string[]` (every preset on disk carries that shape)
 * and origin metadata lives in the parallel optional `selectedSkillRefs`.
 * `normalizeHarnessSkillSelection` is the single reconciliation point, used by
 * both `HarnessConfigUpdatesSchema` and `HarnessConfigStore.normalizeHarnessConfig`.
 */

import {
  HarnessConfigUpdatesSchema,
  normalizeHarnessSkillSelection,
} from './rpc-harness.schemas';

describe('normalizeHarnessSkillSelection', () => {
  it('passes a legacy string[] through unchanged with no refs', () => {
    expect(normalizeHarnessSkillSelection(['a', 'b'], undefined)).toEqual({
      selectedSkills: ['a', 'b'],
      selectedSkillRefs: [],
    });
  });

  it('handles a fully absent selection', () => {
    expect(normalizeHarnessSkillSelection(undefined, undefined)).toEqual({
      selectedSkills: [],
      selectedSkillRefs: [],
    });
  });

  it('splits refs inlined into selectedSkills into ids plus refs', () => {
    expect(
      normalizeHarnessSkillSelection(
        [
          'local-one',
          {
            skillId: 'frontend-design',
            source: 'skills.sh',
            installSource: 'anthropics/skills',
          },
        ],
        undefined,
      ),
    ).toEqual({
      selectedSkills: ['local-one', 'frontend-design'],
      selectedSkillRefs: [
        {
          skillId: 'frontend-design',
          source: 'skills.sh',
          installSource: 'anthropics/skills',
        },
      ],
    });
  });

  it('treats a ref-only entry as a selection', () => {
    expect(
      normalizeHarnessSkillSelection(undefined, [
        { skillId: 'x', source: 'skills.sh', installSource: 'o/r' },
      ]),
    ).toEqual({
      selectedSkills: ['x'],
      selectedSkillRefs: [
        { skillId: 'x', source: 'skills.sh', installSource: 'o/r' },
      ],
    });
  });

  it('infers source from the presence of installSource', () => {
    const { selectedSkillRefs } = normalizeHarnessSkillSelection(undefined, [
      { skillId: 'remote', installSource: 'o/r' },
      { skillId: 'plain' },
    ]);
    expect(selectedSkillRefs).toEqual([
      { skillId: 'remote', source: 'skills.sh', installSource: 'o/r' },
      { skillId: 'plain', source: 'local' },
    ]);
  });

  it('dedupes ids and lets an explicit ref win over an inlined one', () => {
    const { selectedSkills, selectedSkillRefs } =
      normalizeHarnessSkillSelection(
        ['dup', { skillId: 'dup', source: 'local' }],
        [{ skillId: 'dup', source: 'skills.sh', installSource: 'o/r' }],
      );
    expect(selectedSkills).toEqual(['dup']);
    expect(selectedSkillRefs).toEqual([
      { skillId: 'dup', source: 'skills.sh', installSource: 'o/r' },
    ]);
  });
});

describe('HarnessConfigUpdatesSchema — skills', () => {
  it('accepts the legacy string[] shape', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: { selectedSkills: ['tribunal'] },
    });
    expect(parsed.skills).toMatchObject({
      selectedSkills: ['tribunal'],
      selectedSkillRefs: [],
    });
  });

  it('normalizes refs the agent inlined into selectedSkills', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: {
        selectedSkills: [
          { skillId: 'frontend-design', installSource: 'anthropics/skills' },
        ],
      },
    });
    expect(parsed.skills).toMatchObject({
      selectedSkills: ['frontend-design'],
      selectedSkillRefs: [
        {
          skillId: 'frontend-design',
          source: 'skills.sh',
          installSource: 'anthropics/skills',
        },
      ],
    });
  });

  it('leaves the selection untouched when only createdSkills is updated', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: { createdSkills: [{ name: 'a' }] },
    });
    expect(parsed.skills?.selectedSkills).toBeUndefined();
    expect(parsed.skills?.selectedSkillRefs).toBeUndefined();
  });

  it('rejects a non-object entry in selectedSkills', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        skills: { selectedSkills: [42] },
      }).success,
    ).toBe(false);
  });
});
