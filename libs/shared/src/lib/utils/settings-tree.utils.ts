/**
 * Flatten a nested settings DTO into the dotted `[key, value]` pairs
 * `IWorkspaceProvider.setConfiguration` writes one at a time.
 *
 * Both trigger-settings surfaces round-trip a small nested DTO
 * (`SkillTriggersDto`, `MemoryTriggersDto`) whose leaves are the actual
 * settings keys, and both carried a byte-identical private `flatten` to do
 * this. It is pure, has no dependency on either subsystem, and its shape is
 * fixed by the settings file format rather than by what a trigger does — so it
 * belongs beside the other pure helpers here rather than in either backend lib.
 *
 * Rules, both load-bearing:
 *
 * - An **array is a leaf.** `memory.triggers.userPromptSubmit.cueList` is a
 *   `string[]` that must reach the settings file as one array value; recursing
 *   into it would write `…cueList.0`, `…cueList.1`, which nothing reads back.
 * - `null` is a leaf too. Only a plain object is descended into, so a caller
 *   clearing a value gets one pair rather than zero.
 *
 * `undefined` entries are the CALLER's business — this function emits a pair
 * for whatever it is handed. Callers that treat `undefined` as "not supplied"
 * skip the key before calling.
 */
export function flattenSettingsTree(
  prefix: string,
  value: unknown,
): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]];
  }
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...flattenSettingsTree(`${prefix}.${k}`, v));
  }
  return out;
}
