/**
 * Permission gate for the plugin skills a generated agent may be told about
 * (prompt-authoring rubric rule 8: an agent only receives capabilities it may
 * use).
 *
 * A skill reaches the generation prompt only when the agent type is known, the
 * type may invoke the `Skill` tool, and the skill is not switched off. When the
 * permitted capability set cannot be determined, the answer is no skill at all:
 * unknown never authorizes a capability reference.
 */

import type { PluginSkillInfo } from '@ptah-extension/agent-sdk';
import {
  getSubagentDisallowedTools,
  hasSubagentToolPolicy,
} from './subagent-tool-allowlist';

/** The runtime tool an agent invokes a skill through. */
export const SKILL_TOOL_NAME = 'Skill';

/**
 * The plugin skills `agentType` may invoke.
 *
 * @param agentType The template `name`, the key of the subagent tool policy.
 * @param skills Skills discovered in the enabled plugin directories.
 * @param disabledSkillIds Directory ids of the skills the user switched off
 *   (matched against `PluginSkillInfo.skillId`), or `null` when that
 *   policy could not be read.
 * @returns `[]` for an unknown type, a type that may not invoke `Skill`, or an
 *   unreadable disabled-skill policy; otherwise `skills` minus disabled ones.
 */
export function selectInvocablePluginSkills(
  agentType: string,
  skills: readonly PluginSkillInfo[],
  disabledSkillIds: readonly string[] | null,
): PluginSkillInfo[] {
  if (!hasSubagentToolPolicy(agentType)) return [];
  if (getSubagentDisallowedTools(agentType).includes(SKILL_TOOL_NAME)) {
    return [];
  }
  if (disabledSkillIds === null) return [];
  const disabled = new Set(disabledSkillIds);
  // Disabled ids are skill directory names, not frontmatter names.
  return skills.filter((skill) => !disabled.has(skill.skillId));
}
