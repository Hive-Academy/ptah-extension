import { codexRequestSchemas } from './codex-protocol-validator';

describe('CodexContext thread frame boundary', () => {
  it('keeps nested lane config on both parsed thread methods', () => {
    const config = {
      agents: { enabled: false },
      features: { plugins: false, apps: false },
      skills: { include_instructions: false },
      web_search: 'disabled',
      approval_policy: 'never',
      mcp_servers: { ptah: { url: 'http://localhost:4823', tool_timeout_sec: 960 } },
    };
    const start = codexRequestSchemas['thread/start'].params.parse({
      cwd: '/work', model: 'model', approvalPolicy: 'never',
      approvalsReviewer: 'user', sandbox: 'workspace-write', config,
    });
    const resume = codexRequestSchemas['thread/resume'].params.parse({
      ...start, threadId: 'thread-1',
    });
    expect(start.config).toEqual(config);
    expect(resume.config).toEqual(config);
    expect(start.config).not.toHaveProperty(['mcp_servers.ptah']);
  });
});
