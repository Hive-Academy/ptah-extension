/**
 * No shipped agent type denies `Skill` today, so the policy map gains one
 * fixture type that does. Every real type keeps its real policy.
 */
jest.mock('./subagent-tool-allowlist', () => {
  const actual = jest.requireActual<typeof import('./subagent-tool-allowlist')>(
    './subagent-tool-allowlist',
  );
  const policy: Readonly<Record<string, readonly string[]>> = {
    ...actual.SUBAGENT_DISALLOWED_TOOLS,
    'skill-less-fixture': ['Skill'],
  };
  const has = (type: string): boolean =>
    Object.prototype.hasOwnProperty.call(policy, type);
  return {
    ...actual,
    hasSubagentToolPolicy: has,
    getSubagentDisallowedTools: (type: string): readonly string[] =>
      has(type) ? policy[type] : [],
  };
});

import type { PluginSkillInfo } from '@ptah-extension/agent-sdk';
import { selectInvocablePluginSkills } from './invocable-plugin-skills';

const skills: PluginSkillInfo[] = [
  {
    pluginId: 'ptah-core',
    skillId: 'orchestration',
    skillName: 'orchestration',
    description: 'o',
  },
  {
    pluginId: 'ptah-core',
    skillId: 'review-code',
    skillName: 'review-code',
    description: 'r',
  },
];

/** Third-party skills whose frontmatter name differs from their directory. */
const acmeReview: PluginSkillInfo = {
  pluginId: 'acme',
  skillId: 'code-review',
  skillName: 'Acme Code Review',
  description: 'a',
};
const nameCollision: PluginSkillInfo = {
  pluginId: 'acme',
  skillId: 'lint-helper',
  skillName: 'code-review',
  description: 'l',
};

describe('selectInvocablePluginSkills', () => {
  it('lists no skill for an unknown agent type', () => {
    expect(selectInvocablePluginSkills('my-custom-agent', skills, [])).toEqual(
      [],
    );
  });

  it('lists no skill for a type that may not invoke Skill', () => {
    expect(
      selectInvocablePluginSkills('skill-less-fixture', skills, []),
    ).toEqual([]);
  });

  it('lists no skill when the disabled-skill policy is unknown', () => {
    expect(
      selectInvocablePluginSkills('backend-developer', skills, null),
    ).toEqual([]);
  });

  it('excludes a disabled skill for a known type that may invoke Skill', () => {
    expect(
      selectInvocablePluginSkills('backend-developer', skills, ['review-code']),
    ).toEqual([skills[0]]);
  });

  it('excludes a skill by its directory id when its name differs', () => {
    expect(
      selectInvocablePluginSkills('backend-developer', [acmeReview], [
        'code-review',
      ]),
    ).toEqual([]);
  });

  it('keeps a skill whose name equals another skill disabled directory id', () => {
    expect(
      selectInvocablePluginSkills(
        'backend-developer',
        [acmeReview, nameCollision],
        ['code-review'],
      ),
    ).toEqual([nameCollision]);
  });

  it('does not exclude a skill by its frontmatter name', () => {
    expect(
      selectInvocablePluginSkills('backend-developer', [acmeReview], [
        'Acme Code Review',
      ]),
    ).toEqual([acmeReview]);
  });

  it('keeps every skill when nothing is disabled', () => {
    expect(
      selectInvocablePluginSkills('code-logic-reviewer', skills, []),
    ).toEqual(skills);
  });
});
