import { join, resolve } from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { computeWorkspaceFingerprint } from './analysis-fingerprint';

const ROOT = resolve('/workspace/project');

describe('computeWorkspaceFingerprint', () => {
  it.each([
    '.claude',
    '.codex',
    '.github',
    '.cursor',
    '.opencode',
    '.agents',
    '.vscode',
  ])(
    'ignores generated %s output while detecting source changes',
    async (name) => {
      const fs = createMockFileSystemProvider();
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"project"}');
      const original = await computeWorkspaceFingerprint(ROOT, fs);

      await fs.createDirectory(join(ROOT, name, 'agents'));
      await fs.writeFile(join(ROOT, name, 'agents', 'generated.md'), 'agent');
      const afterOutput = await computeWorkspaceFingerprint(ROOT, fs);
      expect(afterOutput.digest).toBe(original.digest);

      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"changed"}');
      const afterSource = await computeWorkspaceFingerprint(ROOT, fs);
      expect(afterSource.digest).not.toBe(original.digest);
    },
  );

  it.each(['.gitignore', '.mcp.json', 'opencode.json'])(
    'ignores generated root file %s',
    async (name) => {
      const fs = createMockFileSystemProvider();
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"project"}');
      const original = await computeWorkspaceFingerprint(ROOT, fs);

      await fs.writeFile(join(ROOT, name), 'generated');
      expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(
        original.digest,
      );
      await fs.writeFile(join(ROOT, 'package.json'), '{"name":"changed"}');
      expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).not.toBe(
        original.digest,
      );
    },
  );
});
