import 'reflect-metadata';
import { container } from 'tsyringe';
import * as vscode from 'vscode';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { FileSystemService } from '../services/file-system.service';
import { FILE_SYSTEM_SERVICE } from '../di/tokens';
import { ProjectType } from '../types/workspace.types';

// Mock vscode module
jest.mock('vscode', () => ({
  Uri: {
    file: jest.fn((path: string) => ({
      fsPath: path,
      path,
      scheme: 'file',
    })),
    joinPath: jest.fn((base: Record<string, unknown>, ...paths: string[]) => ({
      fsPath: `${(base as { fsPath: string }).fsPath}/${paths.join('/')}`,
      path: `${(base as { path: string }).path}/${paths.join('/')}`,
      scheme: 'file',
    })),
  },
  FileType: {
    File: 1,
    Directory: 2,
  },
  workspace: {
    workspaceFolders: [],
  },
}));

describe('DependencyAnalyzerService', () => {
  let service: DependencyAnalyzerService;
  let mockFileSystemService: jest.Mocked<FileSystemService>;

  beforeEach(() => {
    // Create mock FileSystemService
    mockFileSystemService = {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      exists: jest.fn(),
      isVirtualWorkspace: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    // Clear and setup container
    container.clearInstances();
    container.registerInstance(FILE_SYSTEM_SERVICE, mockFileSystemService);

    // Create service instance
    service = container.resolve(DependencyAnalyzerService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('Node.js ecosystem', () => {
    it('should parse package.json dependencies', async () => {
      const packageJson = {
        dependencies: {
          express: '^4.18.0',
          lodash: '~4.17.21',
        },
        devDependencies: {
          typescript: '^5.0.0',
          jest: '29.0.0',
        },
      };

      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue(
        JSON.stringify(packageJson)
      );

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(2);
      expect(result.devDependencies).toHaveLength(2);
      expect(result.totalCount).toBe(4);
      expect(result.dependencies).toContainEqual({
        name: 'express',
        version: '^4.18.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'lodash',
        version: '~4.17.21',
      });
      expect(result.devDependencies).toContainEqual({
        name: 'typescript',
        version: '^5.0.0',
      });
      expect(result.devDependencies).toContainEqual({
        name: 'jest',
        version: '29.0.0',
      });
    });

    it('should handle package.json without devDependencies', async () => {
      const packageJson = {
        dependencies: {
          react: '^18.2.0',
        },
      };

      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue(
        JSON.stringify(packageJson)
      );

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0]).toEqual({
        name: 'react',
        version: '^18.2.0',
      });
    });

    it('should handle malformed package.json gracefully', async () => {
      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue('{ invalid json }');

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe('Python ecosystem', () => {
    it('should parse requirements.txt', async () => {
      const requirements = [
        'django==4.2.0',
        'requests>=2.28.0',
        'pytest~=7.3.0',
        'flask<3.0.0',
        '# Comment line',
        'numpy',
        'scipy==1.10.0  # inline comment',
      ].join('\n');

      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue(requirements);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Python);

      expect(result.dependencies).toHaveLength(6);
      expect(result.totalCount).toBe(6);
      expect(result.dependencies).toContainEqual({
        name: 'django',
        version: '==4.2.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'requests',
        version: '>=2.28.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'pytest',
        version: '~=7.3.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'flask',
        version: '<3.0.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'numpy',
        version: 'latest',
      });
    });

    it('should parse Pipfile', async () => {
      const pipfile = `
[packages]
flask = "==2.3.0"
sqlalchemy = "*"

[dev-packages]
pytest = ">=7.0"
`.trim();

      mockFileSystemService.exists
        .mockResolvedValueOnce(false) // requirements.txt doesn't exist
        .mockResolvedValueOnce(true); // Pipfile exists
      mockFileSystemService.readFile.mockResolvedValue(pipfile);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Python);

      expect(result.dependencies).toHaveLength(2); // [packages] section
      expect(result.devDependencies).toHaveLength(1); // [dev-packages] section
      expect(result.totalCount).toBe(3);

      expect(result.dependencies).toContainEqual({
        name: 'flask',
        version: '==2.3.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'sqlalchemy',
        version: '*',
      });
      expect(result.devDependencies).toContainEqual({
        name: 'pytest',
        version: '>=7.0',
      });
    });
  });

  describe('Go ecosystem', () => {
    it('should parse go.mod', async () => {
      const goMod = `
module github.com/example/project

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	gorm.io/gorm v1.25.0
)

require (
	github.com/stretchr/testify v1.8.4 // indirect
)
`.trim();

      mockFileSystemService.exists.mockResolvedValue(true); // go.mod exists
      mockFileSystemService.readFile.mockResolvedValue(goMod);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Go);

      expect(result.dependencies).toHaveLength(3);
      expect(result.dependencies).toContainEqual({
        name: 'github.com/gin-gonic/gin',
        version: 'v1.9.1',
      });
      expect(result.dependencies).toContainEqual({
        name: 'gorm.io/gorm',
        version: 'v1.25.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'github.com/stretchr/testify',
        version: 'v1.8.4',
      });
    });
  });

  describe('Rust ecosystem', () => {
    it('should parse Cargo.toml', async () => {
      const cargoToml = `
[package]
name = "my-project"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.28"

[dev-dependencies]
mockall = "0.11"
`.trim();

      mockFileSystemService.exists.mockResolvedValue(true); // Cargo.toml exists
      mockFileSystemService.readFile.mockResolvedValue(cargoToml);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Rust);

      expect(result.dependencies).toHaveLength(3);
      expect(result.dependencies).toContainEqual({
        name: 'serde',
        version: '1.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'tokio',
        version: '1.28',
      });
      expect(result.dependencies).toContainEqual({
        name: 'mockall',
        version: '0.11',
      });
    });
  });

  describe('PHP ecosystem', () => {
    it('should parse composer.json', async () => {
      const composerJson = {
        require: {
          php: '^8.1',
          'laravel/framework': '^10.0',
          'guzzlehttp/guzzle': '~7.5',
        },
        'require-dev': {
          'phpunit/phpunit': '^10.0',
        },
      };

      mockFileSystemService.exists.mockResolvedValue(true); // composer.json exists
      mockFileSystemService.readFile.mockResolvedValue(
        JSON.stringify(composerJson)
      );

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.PHP);

      expect(result.dependencies).toHaveLength(4);
      expect(result.dependencies).toContainEqual({
        name: 'php',
        version: '^8.1',
      });
      expect(result.dependencies).toContainEqual({
        name: 'laravel/framework',
        version: '^10.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'guzzlehttp/guzzle',
        version: '~7.5',
      });
      expect(result.dependencies).toContainEqual({
        name: 'phpunit/phpunit',
        version: '^10.0',
      });
    });
  });

  describe('Ruby ecosystem', () => {
    it('should parse Gemfile with versions', async () => {
      const gemfile = `
source 'https://rubygems.org'

gem 'rails', '7.0.4'
gem 'pg', '~> 1.4'
gem 'puma'

group :development, :test do
  gem 'rspec-rails', '6.0.0'
end
`.trim();

      mockFileSystemService.exists.mockResolvedValue(true); // Gemfile exists
      mockFileSystemService.readFile.mockResolvedValue(gemfile);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Ruby);

      expect(result.dependencies).toContainEqual({
        name: 'rails',
        version: '7.0.4',
      });
      expect(result.dependencies).toContainEqual({
        name: 'pg',
        version: '~> 1.4',
      });
      expect(result.dependencies).toContainEqual({
        name: 'puma',
        version: 'latest',
      });
      expect(result.dependencies).toContainEqual({
        name: 'rspec-rails',
        version: '6.0.0',
      });
    });
  });

  describe('.NET ecosystem', () => {
    it('should parse .csproj files', async () => {
      const csproj = `
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net7.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="7.0.5" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="2.12.0" />
  </ItemGroup>
</Project>
`.trim();

      mockFileSystemService.readDirectory.mockResolvedValue([
        ['project.csproj', vscode.FileType.File],
      ]);
      mockFileSystemService.readFile.mockResolvedValue(csproj);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.DotNet);

      expect(result.dependencies).toHaveLength(3);
      expect(result.dependencies).toContainEqual({
        name: 'Microsoft.EntityFrameworkCore',
        version: '7.0.5',
      });
      expect(result.dependencies).toContainEqual({
        name: 'Newtonsoft.Json',
        version: '13.0.3',
      });
      expect(result.dependencies).toContainEqual({
        name: 'Serilog',
        version: '2.12.0',
      });
    });
  });

  describe('Java ecosystem', () => {
    it('should parse pom.xml (Maven)', async () => {
      const pomXml = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.1.0</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`.trim();

      mockFileSystemService.exists.mockResolvedValue(true); // pom.xml exists
      mockFileSystemService.readFile.mockResolvedValue(pomXml);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Java);

      expect(result.dependencies).toHaveLength(2);
      expect(result.dependencies).toContainEqual({
        name: 'org.springframework.boot:spring-boot-starter-web',
        version: '3.1.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'junit:junit',
        version: '4.13.2',
      });
    });

    it('should parse build.gradle (Gradle)', async () => {
      const buildGradle = `
dependencies {
    implementation 'com.google.guava:guava:31.1-jre'
    implementation "org.springframework.boot:spring-boot-starter:3.0.0"
    testImplementation 'org.junit.jupiter:junit-jupiter:5.9.2'
}
`.trim();

      mockFileSystemService.exists
        .mockResolvedValueOnce(false) // pom.xml doesn't exist
        .mockResolvedValueOnce(true); // build.gradle exists
      mockFileSystemService.readFile.mockResolvedValue(buildGradle);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Java);

      expect(result.dependencies).toHaveLength(3);
      expect(result.dependencies).toContainEqual({
        name: 'com.google.guava:guava',
        version: '31.1-jre',
      });
      expect(result.dependencies).toContainEqual({
        name: 'org.springframework.boot:spring-boot-starter',
        version: '3.0.0',
      });
      expect(result.dependencies).toContainEqual({
        name: 'org.junit.jupiter:junit-jupiter',
        version: '5.9.2',
      });
    });
  });

  describe('Multi-root workspace support', () => {
    it('should analyze dependencies for multiple workspace folders', async () => {
      const packageJson1 = {
        dependencies: { react: '^18.0.0' },
      };
      const packageJson2 = {
        dependencies: { vue: '^3.0.0' },
      };

      const uri1 = vscode.Uri.file('/workspace1');
      const uri2 = vscode.Uri.file('/workspace2');

      const projectTypes = new Map<vscode.Uri, ProjectType>();
      projectTypes.set(uri1, ProjectType.React);
      projectTypes.set(uri2, ProjectType.Vue);

      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile
        .mockResolvedValueOnce(JSON.stringify(packageJson1))
        .mockResolvedValueOnce(JSON.stringify(packageJson2));

      const results = await service.analyzeDependenciesForWorkspaces(
        projectTypes
      );

      expect(results.size).toBe(2);
      const result1 = results.get(uri1);
      const result2 = results.get(uri2);

      expect(result1?.dependencies).toContainEqual({
        name: 'react',
        version: '^18.0.0',
      });
      expect(result2?.dependencies).toContainEqual({
        name: 'vue',
        version: '^3.0.0',
      });
    });

    it('should return empty map for empty project types', async () => {
      const projectTypes = new Map<vscode.Uri, ProjectType>();

      const results = await service.analyzeDependenciesForWorkspaces(
        projectTypes
      );

      expect(results.size).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should return unknown ecosystem when no dependency files found', async () => {
      mockFileSystemService.exists.mockResolvedValue(false);
      mockFileSystemService.readDirectory.mockResolvedValue([]);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(0);
    });

    it('should handle file read errors gracefully', async () => {
      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockRejectedValue(
        new Error('Permission denied')
      );

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(0);
    });

    it('should handle empty dependency files', async () => {
      mockFileSystemService.exists.mockResolvedValue(true);
      mockFileSystemService.readFile.mockResolvedValue('');

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      expect(result.dependencies).toHaveLength(0);
    });

    it('should deduplicate dependencies in Gemfile', async () => {
      const gemfile = `
gem 'rails', '7.0.0'
gem 'rails'
`.trim();

      mockFileSystemService.exists
        .mockResolvedValueOnce(false) // package.json
        .mockResolvedValueOnce(false) // requirements.txt
        .mockResolvedValueOnce(false) // Pipfile
        .mockResolvedValueOnce(false) // go.mod
        .mockResolvedValueOnce(false) // Cargo.toml
        .mockResolvedValueOnce(false) // composer.json
        .mockResolvedValueOnce(true); // Gemfile
      mockFileSystemService.readFile.mockResolvedValue(gemfile);

      const uri = vscode.Uri.file('/workspace');
      const result = await service.analyzeDependencies(uri, ProjectType.Node);

      // Should only have one 'rails' dependency (version takes precedence)
      const railsDeps = result.dependencies.filter((d) => d.name === 'rails');
      expect(railsDeps).toHaveLength(1);
      expect(railsDeps[0].version).toBe('7.0.0');
    });
  });
});
