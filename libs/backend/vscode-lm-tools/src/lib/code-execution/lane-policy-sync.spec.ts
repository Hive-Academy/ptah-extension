/**
 * Keeps the child lane policy, the parent system prompt, and agent-lanes
 * §3 / §7 on the same tool names and the same availability rule.
 *
 * `PTAH_LANE_POLICY` is imported from the cli-agent-runtime public entry.
 * vscode-lm-tools already depends on that package. This spec does not add an
 * import the other way.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { PTAH_LANE_POLICY } from '@ptah-extension/cli-agent-runtime';
import { PTAH_SYSTEM_PROMPT } from './ptah-system-prompt.constant';

const CANARY_LINE = 'Lane policy id: ptah-lane-policy-v1';

const SHARED_TOOL_NAMES = [
  'ptah_workspace_analyze',
  'ptah_search_files',
  'ptah_code_search_symbols',
  'ptah_ast_analyze',
  'ptah_context_enrich_file',
  'ptah_lsp_references',
  'ptah_get_dependents',
  'ptah_get_diagnostics',
  'ptah_memory_search',
  'ptah_web_search',
  'ptah_browser_navigate',
  'ptah_browser_screenshot',
] as const;

const MODE_WORD =
  /\b(?:steer|interrupt(?:-resume)?|queue(?:-next-turn)?|messaging)\b/i;
const AVAILABILITY_CLAIM =
  /\b(?:is available|are available|always works|always work)\b/i;
const CAPABILITY_CONDITION =
  /\b(?:capabilit(?:y|ies)|ptah_agent_list|returned mode|probed from)\b/i;

/** Sentences that promise a delivery mode with no capability condition. */
function unconditionalModeSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => {
    return (
      MODE_WORD.test(sentence) &&
      AVAILABILITY_CLAIM.test(sentence) &&
      !CAPABILITY_CONDITION.test(sentence)
    );
  });
}

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line === heading);
  if (start < 0) {
    throw new Error('Missing heading ' + heading);
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('lane policy stays aligned with the parent prompt and agent-lanes', () => {
  const skill = readRepoFile('.claude/skills/agent-lanes/SKILL.md');
  const section3 = markdownSection(skill, '## 3. Task contract');
  const section7 = markdownSection(skill, '## 7. Talk to a live lane');

  it('names the same tools in the policy and the parent prompt', () => {
    for (const toolName of SHARED_TOOL_NAMES) {
      expect(PTAH_LANE_POLICY).toContain(toolName);
      expect(PTAH_SYSTEM_PROMPT).toContain(toolName);
    }
  });

  it('carries the canary line exactly once', () => {
    expect(PTAH_LANE_POLICY.split(CANARY_LINE).length - 1).toBe(1);
  });

  it('teaches the UI render rule in agent-lanes §3 and names the policy', () => {
    expect(section3).toContain('PTAH_LANE_POLICY');
    expect(section3).toMatch(/design skill/i);
    expect(section3).toContain('ptah_browser_navigate');
    expect(section3).toContain('ptah_browser_screenshot');
    expect(section3).toContain('file://');
  });

  it('does not describe a messaging mode as always available', () => {
    expect(section7).toContain('PTAH_LANE_POLICY');
    expect(section7).toContain('TWO_WAY_MESSAGING_GUIDANCE');
    expect(section7).toContain('renderLaneCompletionContract');
    expect(unconditionalModeSentences('Steer always works.')).toEqual([
      'Steer always works.',
    ]);
    expect(
      unconditionalModeSentences('Messaging is available.'),
    ).toEqual(['Messaging is available.']);
    expect(
      unconditionalModeSentences(
        'Interrupt is available only when ptah_agent_list reports the capability.',
      ),
    ).toEqual([]);
    expect(unconditionalModeSentences(PTAH_LANE_POLICY)).toEqual([]);
    expect(unconditionalModeSentences(PTAH_SYSTEM_PROMPT)).toEqual([]);
    expect(unconditionalModeSentences(section7)).toEqual([]);
  });
});
