import {
  buildExecuteCodeTool,
  buildAgentMessageTool,
  buildAgentReportTool,
} from './tool-description.builder';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';

describe('buildExecuteCodeTool', () => {
  it('guides agents to direct tools and native file editing', () => {
    const description = buildExecuteCodeTool().description;

    expect(description).toContain('Prefer direct `ptah_*` tools');
    expect(description).toContain('ptah.help(topic)');
    expect(description).toContain('`ptah.files` is read-only');
    expect(description).toContain(
      'Never use execute_code to create or edit files',
    );
    expect(description).toContain('native CLI write/edit tools');
  });

  it('stays concise while retaining minimal executable examples', () => {
    const description = buildExecuteCodeTool().description;

    expect(description.length).toBeLessThan(1_000);
    expect(description).toContain('ptah.workspace.getInfo()');
    expect(description).toContain("ptah.search.findFiles('**/*.ts', 20)");
  });
});


/**
 * `ptah_agent_message` / `ptah_agent_report` — TASK_2026_402 Batch 5.
 *
 * Capability is a runtime fact answered by `ptah_agent_list`, so neither
 * description may name a vendor or promise a mechanism (`vendor-roster-drift`
 * covers the brand spellings; this covers the enum the spawner uses).
 */
describe('buildAgentMessageTool', () => {
  it('names the tool ptah_agent_message and requires agentId + message', () => {
    const tool = buildAgentMessageTool();
    expect(tool.name).toBe('ptah_agent_message');
    expect(tool.inputSchema.required).toEqual(['agentId', 'message']);
  });

  it('enumerates every mode, including the one that discards work', () => {
    const description = buildAgentMessageTool().description;
    for (const mode of [
      'steer',
      'interrupt-resume',
      'queue-next-turn',
      'unsupported',
    ]) {
      expect(description).toContain(mode);
    }
    expect(description).toContain('DISCARDED');
  });

  it('directs the reader to ptah_agent_list instead of naming a CLI', () => {
    const description = buildAgentMessageTool().description;
    expect(description).toContain('ptah_agent_list');
    // Word-boundary, not substring: `pi` is two letters and would match inside
    // ordinary English, which would make this assertion noise rather than a
    // guard.
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).not.toMatch(new RegExp(`\\b${cli}\\b`, 'i'));
    }
  });
});

describe('buildAgentReportTool', () => {
  it('takes NO agentId — identity comes from the connection', () => {
    const tool = buildAgentReportTool();
    expect(tool.name).toBe('ptah_agent_report');
    expect(tool.inputSchema.required).toEqual(['message']);
    expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain(
      'agentId',
    );
  });

  it('states that a refusal is reported rather than a false success', () => {
    const description = buildAgentReportTool().description;
    expect(description).toContain('"delivered": false');
    expect(description).toContain('reason');
  });

  it('names no CLI vendor', () => {
    const description = buildAgentReportTool().description;
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).not.toMatch(new RegExp(`\\b${cli}\\b`, 'i'));
    }
  });
});
