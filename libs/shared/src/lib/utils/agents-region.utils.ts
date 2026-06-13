export const PTAH_AGENTS_REGION_BEGIN = '<!-- PTAH:AGENTS:BEGIN -->';
export const PTAH_AGENTS_REGION_END = '<!-- PTAH:AGENTS:END -->';

const PTAH_AGENTS_REGION_PATTERN =
  /<!-- PTAH:AGENTS:BEGIN -->[\s\S]*?<!-- PTAH:AGENTS:END -->/;

export interface AgentBody {
  name: string;
  content: string;
}

function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function buildAgentsRegion(agents: AgentBody[]): string {
  const sections = agents
    .map((a) => `## ${a.name}\n\n${normalizeCrlf(a.content).trim()}`)
    .join('\n\n');
  return `${PTAH_AGENTS_REGION_BEGIN}\n${sections}\n${PTAH_AGENTS_REGION_END}`;
}

export function mergeAgentsRegion(
  existingFile: string,
  agents: AgentBody[],
): string {
  const region = buildAgentsRegion(agents);
  if (!existingFile) {
    return `${region}\n`;
  }

  const normalized = normalizeCrlf(existingFile);
  const match = normalized.match(PTAH_AGENTS_REGION_PATTERN);
  if (match) {
    const before = normalized.slice(0, match.index);
    const after = normalized.slice((match.index ?? 0) + match[0].length);
    return `${before}${region}${after}`;
  }

  const trimmed = normalized.replace(/\n+$/, '');
  return `${trimmed}\n\n${region}\n`;
}
