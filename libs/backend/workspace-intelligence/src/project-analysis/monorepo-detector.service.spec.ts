import 'reflect-metadata';
import { MonorepoDetectorService } from './monorepo-detector.service';
import { FileSystemService } from '../services/file-system.service';
import { MonorepoType } from '../types/workspace.types';
import * as vscode from 'vscode';

// Mock vscode module
jest.mock('vscode', () => ({
  Uri: {
    file: jest.fn((path: string) => ({ fsPath: path, scheme: 'file', path })),
    joinPath: jest.fn(
      (uri: { fsPath: string }, ...paths: string[]) =>
        ({
          fsPath: `${uri.fsPath}/${paths.join('/')}`,
          scheme: 'file',
          path: `${uri.fsPath}/${paths.join('/')}`,
        } as vscode.Uri)
    ),
  },
  workspace: {
    workspaceFolders: undefined,
  },
}));

describe('MonorepoDetectorService', () => {
  let service: MonorepoDetectorService;
  let mockFileSystem: jest.Mocked<FileSystemService>;

  beforeEach(() => {
    mockFileSystem = {
      exists: jest.fn(),
      readFile: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    service = new MonorepoDetectorService(mockFileSystem);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectMonorepo', () => {
    const workspaceUri = vscode.Uri.file('/test/workspace');

    describe('Nx workspace detection', () => {
      it('should detect Nx monorepo with nx.json', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(true) // nx.json
          .mockResolvedValueOnce(false); // workspace.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            projects: {
              app1: {},
              app2: {},
              lib1: {},
            },
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Nx);
        expect(result.workspaceFiles).toEqual(['nx.json']);
        expect(result.packageCount).toBe(3);
      });

      it('should detect Nx monorepo with workspace.json', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(true); // workspace.json

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Nx);
        expect(result.workspaceFiles).toEqual(['workspace.json']);
        expect(result.packageCount).toBeUndefined();
      });

      it('should detect Nx monorepo with both nx.json and workspace.json', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(true) // nx.json
          .mockResolvedValueOnce(true); // workspace.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ projects: {} })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Nx);
        expect(result.workspaceFiles).toEqual(['nx.json', 'workspace.json']);
        expect(result.packageCount).toBe(0);
      });

      it('should handle invalid nx.json gracefully', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(true) // nx.json
          .mockResolvedValueOnce(false); // workspace.json

        mockFileSystem.readFile.mockResolvedValueOnce('{ invalid json }');

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Nx);
        expect(result.packageCount).toBeUndefined();
      });

      it('should handle nx.json without projects field', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(true) // nx.json
          .mockResolvedValueOnce(false); // workspace.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ npmScope: 'test' })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Nx);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('Rush workspace detection', () => {
      it('should detect Rush monorepo', async () => {
        // Nx files
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          // Rush file
          .mockResolvedValueOnce(true); // rush.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            projects: [
              { packageName: 'app1' },
              { packageName: 'lib1' },
              { packageName: 'lib2' },
            ],
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Rush);
        expect(result.workspaceFiles).toEqual(['rush.json']);
        expect(result.packageCount).toBe(3);
      });

      it('should handle invalid rush.json gracefully', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(true); // rush.json

        mockFileSystem.readFile.mockResolvedValueOnce('{ invalid json }');

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Rush);
        expect(result.packageCount).toBeUndefined();
      });

      it('should handle rush.json without projects field', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(true); // rush.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ rushVersion: '5.0.0' })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Rush);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('Lerna workspace detection', () => {
      it('should detect Lerna monorepo with packages config', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(true); // lerna.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            packages: ['packages/*', 'apps/*'],
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Lerna);
        expect(result.workspaceFiles).toEqual(['lerna.json']);
        expect(result.packageCount).toBe(2);
      });

      it('should detect Lerna monorepo with useWorkspaces', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(true) // lerna.json
          .mockResolvedValueOnce(true); // package.json

        mockFileSystem.readFile
          .mockResolvedValueOnce(
            JSON.stringify({
              useWorkspaces: true,
            })
          )
          .mockResolvedValueOnce(
            JSON.stringify({
              workspaces: ['packages/*', 'apps/*', 'libs/*'],
            })
          );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Lerna);
        expect(result.workspaceFiles).toEqual(['lerna.json']);
        expect(result.packageCount).toBe(3);
      });

      it('should handle Lerna with useWorkspaces but no package.json', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(true) // lerna.json
          .mockResolvedValueOnce(false); // package.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            useWorkspaces: true,
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Lerna);
        expect(result.packageCount).toBeUndefined();
      });

      it('should handle invalid lerna.json gracefully', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(true); // lerna.json

        mockFileSystem.readFile.mockResolvedValueOnce('{ invalid json }');

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Lerna);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('Turborepo detection', () => {
      it('should detect Turborepo monorepo', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(true); // turbo.json

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.Turborepo);
        expect(result.workspaceFiles).toEqual(['turbo.json']);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('pnpm workspace detection', () => {
      it('should detect pnpm workspace', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(true); // pnpm-workspace.yaml

        const yamlContent = [
          'packages:',
          '  - packages/*',
          '  - apps/*',
          '  - libs/*',
        ].join('\n');

        mockFileSystem.readFile.mockResolvedValueOnce(yamlContent);

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.PnpmWorkspaces);
        expect(result.workspaceFiles).toEqual(['pnpm-workspace.yaml']);
        expect(result.packageCount).toBe(3);
      });

      it('should detect pnpm workspace with complex YAML', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(true); // pnpm-workspace.yaml

        const yamlContent = [
          'packages:',
          '  - "packages/**"',
          '  - "!packages/excluded"',
        ].join('\n');

        mockFileSystem.readFile.mockResolvedValueOnce(yamlContent);

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.PnpmWorkspaces);
        expect(result.packageCount).toBe(2);
      });

      it('should handle invalid pnpm-workspace.yaml gracefully', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(true); // pnpm-workspace.yaml

        mockFileSystem.readFile.mockResolvedValueOnce(
          'invalid: yaml: content:'
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.PnpmWorkspaces);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('Yarn workspace detection', () => {
      it('should detect Yarn workspace with array format', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(false) // pnpm-workspace.yaml
          .mockResolvedValueOnce(true); // package.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            workspaces: ['packages/*', 'apps/*'],
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.YarnWorkspaces);
        expect(result.workspaceFiles).toEqual(['package.json']);
        expect(result.packageCount).toBe(2);
      });

      it('should detect Yarn workspace with object format', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(false) // pnpm-workspace.yaml
          .mockResolvedValueOnce(true); // package.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            workspaces: {
              packages: ['packages/*', 'apps/*', 'libs/*'],
            },
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(true);
        expect(result.type).toBe(MonorepoType.YarnWorkspaces);
        expect(result.workspaceFiles).toEqual(['package.json']);
        expect(result.packageCount).toBe(3);
      });

      it('should not detect Yarn workspace when workspaces field missing', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(false) // pnpm-workspace.yaml
          .mockResolvedValueOnce(true); // package.json

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({
            name: 'regular-project',
            version: '1.0.0',
          })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(false);
        expect(result.type).toBe('' as MonorepoType);
        expect(result.workspaceFiles).toEqual([]);
      });

      it('should handle invalid package.json gracefully', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(false) // pnpm-workspace.yaml
          .mockResolvedValueOnce(true); // package.json

        mockFileSystem.readFile.mockResolvedValueOnce('{ invalid json }');

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(false);
        expect(result.type).toBe('' as MonorepoType);
      });
    });

    describe('Non-monorepo detection', () => {
      it('should return isMonorepo false when no monorepo config found', async () => {
        mockFileSystem.exists.mockResolvedValue(false);

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.isMonorepo).toBe(false);
        expect(result.type).toBe('' as MonorepoType);
        expect(result.workspaceFiles).toEqual([]);
        expect(result.packageCount).toBeUndefined();
      });
    });

    describe('Priority order', () => {
      it('should prioritize Nx over other monorepo types', async () => {
        // Nx exists along with Lerna, Yarn
        mockFileSystem.exists
          .mockResolvedValueOnce(true) // nx.json
          .mockResolvedValueOnce(false); // workspace.json (short-circuit after Nx detected)

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ projects: {} })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.type).toBe(MonorepoType.Nx);
        expect(mockFileSystem.exists).toHaveBeenCalledTimes(2); // Should stop after Nx detection
      });

      it('should prioritize Rush over Lerna when both exist', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(true); // rush.json (short-circuit)

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ projects: [] })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.type).toBe(MonorepoType.Rush);
      });

      it('should prioritize Lerna over Turborepo when both exist', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(true); // lerna.json (short-circuit)

        mockFileSystem.readFile.mockResolvedValueOnce(
          JSON.stringify({ packages: [] })
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.type).toBe(MonorepoType.Lerna);
      });

      it('should prioritize Turborepo over pnpm when both exist', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(true); // turbo.json (short-circuit)

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.type).toBe(MonorepoType.Turborepo);
      });

      it('should prioritize pnpm over Yarn when both exist', async () => {
        mockFileSystem.exists
          .mockResolvedValueOnce(false) // nx.json
          .mockResolvedValueOnce(false) // workspace.json
          .mockResolvedValueOnce(false) // rush.json
          .mockResolvedValueOnce(false) // lerna.json
          .mockResolvedValueOnce(false) // turbo.json
          .mockResolvedValueOnce(true); // pnpm-workspace.yaml (short-circuit)

        mockFileSystem.readFile.mockResolvedValueOnce(
          'packages:\n  - packages/*\n'
        );

        const result = await service.detectMonorepo(workspaceUri);

        expect(result.type).toBe(MonorepoType.PnpmWorkspaces);
      });
    });
  });

  describe('detectMonoreposForWorkspaces', () => {
    it('should detect monorepos for all workspace folders', async () => {
      // Mock multi-root workspace
      const folder1 = vscode.Uri.file('/workspace1');
      const folder2 = vscode.Uri.file('/workspace2');

      // Directly assign to workspaceFolders property
      (
        vscode.workspace as {
          workspaceFolders: vscode.WorkspaceFolder[] | undefined;
        }
      ).workspaceFolders = [
        { uri: folder1, name: 'workspace1', index: 0 },
        { uri: folder2, name: 'workspace2', index: 1 },
      ];

      // Workspace 1: Nx monorepo
      mockFileSystem.exists
        .mockResolvedValueOnce(true) // folder1 nx.json
        .mockResolvedValueOnce(false) // folder1 workspace.json
        // Workspace 2: Lerna monorepo
        .mockResolvedValueOnce(false) // folder2 nx.json
        .mockResolvedValueOnce(false) // folder2 workspace.json
        .mockResolvedValueOnce(false) // folder2 rush.json
        .mockResolvedValueOnce(true); // folder2 lerna.json

      mockFileSystem.readFile
        .mockResolvedValueOnce(JSON.stringify({ projects: { app1: {} } }))
        .mockResolvedValueOnce(JSON.stringify({ packages: ['packages/*'] }));

      const results = await service.detectMonoreposForWorkspaces();

      expect(results.size).toBe(2);

      const workspace1Result = results.get(folder1);
      expect(workspace1Result).toBeDefined();
      expect(workspace1Result?.type).toBe(MonorepoType.Nx);
      expect(workspace1Result?.packageCount).toBe(1);

      const workspace2Result = results.get(folder2);
      expect(workspace2Result).toBeDefined();
      expect(workspace2Result?.type).toBe(MonorepoType.Lerna);
      expect(workspace2Result?.packageCount).toBe(1);

      // Cleanup
      (
        vscode.workspace as {
          workspaceFolders: vscode.WorkspaceFolder[] | undefined;
        }
      ).workspaceFolders = undefined;
    });

    it('should return empty map when no workspace folders', async () => {
      (
        vscode.workspace as {
          workspaceFolders: vscode.WorkspaceFolder[] | undefined;
        }
      ).workspaceFolders = undefined;

      const results = await service.detectMonoreposForWorkspaces();

      expect(results.size).toBe(0);
      expect(mockFileSystem.exists).not.toHaveBeenCalled();
    });

    it('should handle mix of monorepo and non-monorepo workspaces', async () => {
      const folder1 = vscode.Uri.file('/monorepo');
      const folder2 = vscode.Uri.file('/regular-project');

      (
        vscode.workspace as {
          workspaceFolders: vscode.WorkspaceFolder[] | undefined;
        }
      ).workspaceFolders = [
        { uri: folder1, name: 'monorepo', index: 0 },
        { uri: folder2, name: 'regular-project', index: 1 },
      ];

      // Workspace 1: Nx monorepo
      mockFileSystem.exists
        .mockResolvedValueOnce(true) // folder1 nx.json
        .mockResolvedValueOnce(false) // folder1 workspace.json
        // Workspace 2: No monorepo
        .mockResolvedValue(false); // All subsequent checks return false

      mockFileSystem.readFile.mockResolvedValueOnce(
        JSON.stringify({ projects: {} })
      );

      const results = await service.detectMonoreposForWorkspaces();

      expect(results.size).toBe(2);

      const monorepoResult = results.get(folder1);
      expect(monorepoResult?.isMonorepo).toBe(true);
      expect(monorepoResult?.type).toBe(MonorepoType.Nx);

      const regularResult = results.get(folder2);
      expect(regularResult?.isMonorepo).toBe(false);
      expect(regularResult?.type).toBe('' as MonorepoType);

      // Cleanup
      (
        vscode.workspace as {
          workspaceFolders: vscode.WorkspaceFolder[] | undefined;
        }
      ).workspaceFolders = undefined;
    });
  });
});
