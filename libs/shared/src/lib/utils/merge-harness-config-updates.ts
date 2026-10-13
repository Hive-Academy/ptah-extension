import type { HarnessConfig } from '../types/rpc/rpc-harness.types';

function withoutUndefined<T extends object>(value: T): T {
  const copy = { ...value };
  for (const [key, entry] of Object.entries(copy)) {
    if (entry === undefined) Reflect.deleteProperty(copy, key);
  }
  return copy;
}

/** Merge a partial proposal while keeping decisions omitted by the update. */
export function mergeHarnessConfigUpdates(
  base: Partial<HarnessConfig>,
  update: Partial<HarnessConfig>,
): Partial<HarnessConfig> {
  const merged = { ...base };

  if (update.name) {
    merged.name = update.name;
  }
  if (update.persona) {
    merged.persona = {
      ...base.persona,
      ...withoutUndefined(update.persona),
    } as HarnessConfig['persona'];
  }
  if (update.agents) {
    merged.agents = {
      enabledAgents: {
        ...(base.agents?.enabledAgents ?? {}),
        ...withoutUndefined(update.agents.enabledAgents ?? {}),
      },
      harnessSubagents:
        update.agents.harnessSubagents ?? base.agents?.harnessSubagents ?? [],
    };
  }
  if (update.skills) {
    const selectedSkills =
      update.skills.selectedSkills ?? base.skills?.selectedSkills ?? [];
    const retainedRefs = (base.skills?.selectedSkillRefs ?? []).filter(
      (ref) =>
        update.skills?.selectedSkills === undefined ||
        selectedSkills.includes(ref.skillId),
    );
    const refsById = new Map(retainedRefs.map((ref) => [ref.skillId, ref]));
    // The boundary normalizer supplies [] for a selection-only update.
    // Keep retained origins unless a ref for that skill is actually supplied.
    for (const ref of update.skills.selectedSkillRefs ?? []) {
      refsById.set(ref.skillId, ref);
    }
    merged.skills = {
      selectedSkills,
      selectedSkillRefs: [...refsById.values()],
      createdSkills:
        update.skills.createdSkills ?? base.skills?.createdSkills ?? [],
    };
  }
  if (update.prompt) {
    merged.prompt = {
      ...base.prompt,
      ...withoutUndefined(update.prompt),
    } as HarnessConfig['prompt'];
  }
  if (update.mcp) {
    merged.mcp = {
      servers: update.mcp.servers ?? base.mcp?.servers ?? [],
      enabledTools: {
        ...(base.mcp?.enabledTools ?? {}),
        ...withoutUndefined(update.mcp.enabledTools ?? {}),
      },
    };
  }
  if (update.claudeMd) {
    merged.claudeMd = {
      ...base.claudeMd,
      ...withoutUndefined(update.claudeMd),
    } as HarnessConfig['claudeMd'];
  }

  return merged;
}
