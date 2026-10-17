/**
 * Ollama cloud model id helpers.
 *
 * ollama.com uses TWO cloud tag conventions:
 *   - `:cloud`            e.g., `kimi-k2.6:cloud`, `glm-5:cloud`
 *   - tag ending `-cloud` e.g., `gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud`
 *
 * Shared by chat (auth-providers) and decision-model routing (lane-routing) so
 * both apply one definition of the convention. Pure functions.
 */

/**
 * Returns true when the given Ollama model id refers to a cloud-hosted model.
 * Accepts both ollama.com tag conventions:
 *   `kimi-k2.6:cloud`        (tag === 'cloud')
 *   `gpt-oss:120b-cloud`     (tag ends with '-cloud')
 */
export function isCloudTag(name: string): boolean {
  if (!name) return false;
  if (name.endsWith(':cloud')) return true;
  const colonIdx = name.indexOf(':');
  if (colonIdx < 0) return false;
  const tag = name.slice(colonIdx + 1);
  return tag.endsWith('-cloud');
}

/**
 * Normalize a model name from the ollama.com cloud `/api/tags` endpoint into a
 * canonical cloud id. Every entry that host returns IS a cloud model, but it
 * reports BASE names without the routing suffix Ollama expects at inference
 * time. Append the suffix matching each tag convention:
 *   `glm-5.2`          -> `glm-5.2:cloud`
 *   `qwen3-coder:480b` -> `qwen3-coder:480b-cloud`
 *   `kimi-k2.6:cloud`  -> unchanged
 */
export function toCloudId(name: string): string {
  if (isCloudTag(name)) return name;
  return name.includes(':') ? `${name}-cloud` : `${name}:cloud`;
}
