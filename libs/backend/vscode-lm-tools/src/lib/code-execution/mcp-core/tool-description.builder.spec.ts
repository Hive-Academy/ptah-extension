import { buildExecuteCodeTool } from './tool-description.builder';

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
