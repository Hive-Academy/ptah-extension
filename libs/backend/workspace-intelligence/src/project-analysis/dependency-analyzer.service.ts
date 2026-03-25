import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

/**
 * Represents a dependency with its name and version.
 */
export interface Dependency {
  name: string;
  version: string;
}

/**
 * Result of dependency analysis for a workspace.
 */
export interface DependencyAnalysisResult {
  dependencies: Dependency[];
  devDependencies: Dependency[];
  totalCount: number;
}

/**
 * Service for analyzing project dependencies across multiple ecosystems.
 *
 * Supports:
 * - Node.js (package.json)
 * - Python (requirements.txt, Pipfile)
 * - Go (go.mod)
 * - Rust (Cargo.toml)
 * - PHP (composer.json)
 * - Ruby (Gemfile)
 * - .NET (*.csproj)
 * - Java (pom.xml, build.gradle)
 */
@injectable()
export class DependencyAnalyzerService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService
  ) {}

  /**
   * Analyze dependencies for a workspace folder.
   * Returns dependency lists based on project type.
   *
   * @param workspacePath - Path of the workspace folder to analyze
   * @param projectType - Already detected project type
   * @returns Dependency analysis result
   */
  async analyzeDependencies(
    workspacePath: string,
    projectType: ProjectType
  ): Promise<DependencyAnalysisResult> {
    try {
      switch (projectType) {
        case ProjectType.Node:
        case ProjectType.React:
        case ProjectType.Vue:
        case ProjectType.Angular:
        case ProjectType.NextJS:
          return await this.analyzeNodeDependencies(workspacePath);

        case ProjectType.Python:
          return await this.analyzePythonDependencies(workspacePath);

        case ProjectType.Go:
          return await this.analyzeGoDependencies(workspacePath);

        case ProjectType.Rust:
          return await this.analyzeRustDependencies(workspacePath);

        case ProjectType.PHP:
          return await this.analyzePHPDependencies(workspacePath);

        case ProjectType.Ruby:
          return await this.analyzeRubyDependencies(workspacePath);

        case ProjectType.DotNet:
          return await this.analyzeDotNetDependencies(workspacePath);

        case ProjectType.Java:
          return await this.analyzeJavaDependencies(workspacePath);

        default:
          return this.emptyResult();
      }
    } catch {
      // Graceful error handling - return empty result instead of crashing
      return this.emptyResult();
    }
  }

  /**
   * Analyze Node.js dependencies from package.json.
   */
  private async analyzeNodeDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonPath);

    if (!exists) {
      return this.emptyResult();
    }

    try {
      const content = await this.fileSystem.readFile(packageJsonPath);
      const packageJson = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const dependencies = this.parseDependencyObject(
        packageJson.dependencies || {}
      );
      const devDependencies = this.parseDependencyObject(
        packageJson.devDependencies || {}
      );

      return {
        dependencies,
        devDependencies,
        totalCount: dependencies.length + devDependencies.length,
      };
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze Python dependencies from requirements.txt or Pipfile.
   */
  private async analyzePythonDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    // Try requirements.txt first
    const requirementsPath = path.join(workspacePath, 'requirements.txt');
    const requirementsExist = await this.fileSystem.exists(requirementsPath);

    if (requirementsExist) {
      try {
        const content = await this.fileSystem.readFile(requirementsPath);
        const dependencies = this.parseRequirementsTxt(content);

        return {
          dependencies,
          devDependencies: [],
          totalCount: dependencies.length,
        };
      } catch {
        // Fall through to try Pipfile
      }
    }

    // Try Pipfile as fallback
    const pipfilePath = path.join(workspacePath, 'Pipfile');
    const pipfileExists = await this.fileSystem.exists(pipfilePath);

    if (pipfileExists) {
      try {
        const content = await this.fileSystem.readFile(pipfilePath);
        return this.parsePipfile(content);
      } catch {
        // Ignore parse errors
      }
    }

    return this.emptyResult();
  }

  /**
   * Analyze Go dependencies from go.mod.
   */
  private async analyzeGoDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    const goModPath = path.join(workspacePath, 'go.mod');
    const exists = await this.fileSystem.exists(goModPath);

    if (!exists) {
      return this.emptyResult();
    }

    try {
      const content = await this.fileSystem.readFile(goModPath);
      const dependencies = this.parseGoMod(content);

      return {
        dependencies,
        devDependencies: [],
        totalCount: dependencies.length,
      };
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze Rust dependencies from Cargo.toml.
   */
  private async analyzeRustDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    const cargoTomlPath = path.join(workspacePath, 'Cargo.toml');
    const exists = await this.fileSystem.exists(cargoTomlPath);

    if (!exists) {
      return this.emptyResult();
    }

    try {
      const content = await this.fileSystem.readFile(cargoTomlPath);
      return this.parseCargoToml(content);
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze PHP dependencies from composer.json.
   */
  private async analyzePHPDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    const composerJsonPath = path.join(workspacePath, 'composer.json');
    const exists = await this.fileSystem.exists(composerJsonPath);

    if (!exists) {
      return this.emptyResult();
    }

    try {
      const content = await this.fileSystem.readFile(composerJsonPath);
      const composerJson = JSON.parse(content) as {
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
      };

      const dependencies = this.parseDependencyObject(
        composerJson.require || {}
      );
      const devDependencies = this.parseDependencyObject(
        composerJson['require-dev'] || {}
      );

      return {
        dependencies,
        devDependencies,
        totalCount: dependencies.length + devDependencies.length,
      };
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze Ruby dependencies from Gemfile.
   */
  private async analyzeRubyDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    const gemfilePath = path.join(workspacePath, 'Gemfile');
    const exists = await this.fileSystem.exists(gemfilePath);

    if (!exists) {
      return this.emptyResult();
    }

    try {
      const content = await this.fileSystem.readFile(gemfilePath);
      const dependencies = this.parseGemfile(content);

      return {
        dependencies,
        devDependencies: [],
        totalCount: dependencies.length,
      };
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze .NET dependencies from .csproj files.
   */
  private async analyzeDotNetDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    try {
      // Find all .csproj files
      const entries = await this.fileSystem.readDirectory(workspacePath);
      const csprojFile = entries.find((entry) =>
        entry.name.endsWith('.csproj')
      );

      if (!csprojFile) {
        return this.emptyResult();
      }

      const csprojPath = path.join(workspacePath, csprojFile.name);
      const content = await this.fileSystem.readFile(csprojPath);
      const dependencies = this.parseCsproj(content);

      return {
        dependencies,
        devDependencies: [],
        totalCount: dependencies.length,
      };
    } catch {
      return this.emptyResult();
    }
  }

  /**
   * Analyze Java dependencies from pom.xml or build.gradle.
   */
  private async analyzeJavaDependencies(
    workspacePath: string
  ): Promise<DependencyAnalysisResult> {
    // Try pom.xml first (Maven)
    const pomXmlPath = path.join(workspacePath, 'pom.xml');
    const pomExists = await this.fileSystem.exists(pomXmlPath);

    if (pomExists) {
      try {
        const content = await this.fileSystem.readFile(pomXmlPath);
        const dependencies = this.parsePomXml(content);

        return {
          dependencies,
          devDependencies: [],
          totalCount: dependencies.length,
        };
      } catch {
        // Fall through to try build.gradle
      }
    }

    // Try build.gradle as fallback (Gradle)
    const buildGradlePath = path.join(workspacePath, 'build.gradle');
    const gradleExists = await this.fileSystem.exists(buildGradlePath);

    if (gradleExists) {
      try {
        const content = await this.fileSystem.readFile(buildGradlePath);
        const dependencies = this.parseBuildGradle(content);

        return {
          dependencies,
          devDependencies: [],
          totalCount: dependencies.length,
        };
      } catch {
        // Ignore parse errors
      }
    }

    return this.emptyResult();
  }

  /**
   * Parse dependency object (package.json, composer.json format).
   */
  private parseDependencyObject(deps: Record<string, string>): Dependency[] {
    return Object.entries(deps).map(([name, version]) => ({
      name,
      version,
    }));
  }

  /**
   * Parse requirements.txt format (Python).
   * Supports formats: package==1.0.0, package>=1.0.0, package
   */
  private parseRequirementsTxt(content: string): Dependency[] {
    const lines = content.split('\n');
    const dependencies: Dependency[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse package name and version
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)([>=<~!]+)?(.+)?$/);
      if (match) {
        const name = match[1];
        const operator = match[2] || '';
        const versionPart = match[3] ? match[3].trim() : '';
        const version = versionPart ? `${operator}${versionPart}` : 'latest';
        dependencies.push({ name, version });
      }
    }

    return dependencies;
  }

  /**
   * Parse Pipfile format (Python - TOML-like).
   */
  private parsePipfile(content: string): DependencyAnalysisResult {
    const dependencies: Dependency[] = [];
    const devDependencies: Dependency[] = [];

    let currentSection: 'packages' | 'dev-packages' | null = null;

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[packages]') {
        currentSection = 'packages';
        continue;
      }

      if (trimmed === '[dev-packages]') {
        currentSection = 'dev-packages';
        continue;
      }

      if (trimmed.startsWith('[')) {
        currentSection = null;
        continue;
      }

      if (currentSection && trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
        if (match) {
          const dep = { name: match[1], version: match[2] };
          if (currentSection === 'packages') {
            dependencies.push(dep);
          } else {
            devDependencies.push(dep);
          }
        }
      }
    }

    return {
      dependencies,
      devDependencies,
      totalCount: dependencies.length + devDependencies.length,
    };
  }

  /**
   * Parse go.mod format.
   * Extracts dependencies from require blocks.
   */
  private parseGoMod(content: string): Dependency[] {
    const dependencies: Dependency[] = [];
    const requireRegex = /require\s+([^\s]+)\s+([^\s]+)/g;

    let match;
    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.push({
        name: match[1],
        version: match[2],
      });
    }

    return dependencies;
  }

  /**
   * Parse Cargo.toml format (Rust - TOML).
   * Extracts dependencies from [dependencies] and [dev-dependencies] sections.
   */
  private parseCargoToml(content: string): DependencyAnalysisResult {
    const dependencies: Dependency[] = [];
    const devDependencies: Dependency[] = [];

    let currentSection: 'dependencies' | 'dev-dependencies' | null = null;

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[dependencies]') {
        currentSection = 'dependencies';
        continue;
      }

      if (trimmed === '[dev-dependencies]') {
        currentSection = 'dev-dependencies';
        continue;
      }

      if (trimmed.startsWith('[')) {
        currentSection = null;
        continue;
      }

      if (currentSection && trimmed && !trimmed.startsWith('#')) {
        // Handle both simple and complex version specifications
        const match = trimmed.match(
          /^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"|^([a-zA-Z0-9_-]+)\s*=\s*{/
        );
        if (match) {
          const name = match[1] || match[3];
          const version = match[2] || 'latest';
          const dep = { name, version };

          if (currentSection === 'dependencies') {
            dependencies.push(dep);
          } else {
            devDependencies.push(dep);
          }
        }
      }
    }

    return {
      dependencies,
      devDependencies,
      totalCount: dependencies.length + devDependencies.length,
    };
  }

  /**
   * Parse Gemfile format (Ruby).
   * Extracts gem dependencies.
   */
  private parseGemfile(content: string): Dependency[] {
    const dependencies: Dependency[] = [];
    const gemRegex = /gem\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null;
    while ((match = gemRegex.exec(content)) !== null) {
      dependencies.push({
        name: match[1],
        version: match[2],
      });
    }

    // Also handle gems without version (use "latest")
    const gemNoVersionRegex = /gem\s+['"]([^'"]+)['"]\s*$/gm;
    let matchNoVersion: RegExpExecArray | null;
    while ((matchNoVersion = gemNoVersionRegex.exec(content)) !== null) {
      const gemName = matchNoVersion[1];
      // Check if we haven't already added this gem
      if (gemName && !dependencies.some((d) => d.name === gemName)) {
        dependencies.push({
          name: gemName,
          version: 'latest',
        });
      }
    }

    return dependencies;
  }

  /**
   * Parse .csproj format (.NET - XML).
   * Extracts PackageReference elements.
   */
  private parseCsproj(content: string): Dependency[] {
    const dependencies: Dependency[] = [];
    const packageRegex =
      /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g;

    let match;
    while ((match = packageRegex.exec(content)) !== null) {
      dependencies.push({
        name: match[1],
        version: match[2],
      });
    }

    return dependencies;
  }

  /**
   * Parse pom.xml format (Maven - XML).
   * Extracts dependency elements.
   */
  private parsePomXml(content: string): Dependency[] {
    const dependencies: Dependency[] = [];

    // Simple regex-based parsing (good enough for most cases)
    const dependencyRegex =
      /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>/g;

    let match;
    while ((match = dependencyRegex.exec(content)) !== null) {
      dependencies.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3],
      });
    }

    return dependencies;
  }

  /**
   * Parse build.gradle format (Gradle).
   * Extracts implementation/compile dependencies.
   */
  private parseBuildGradle(content: string): Dependency[] {
    const dependencies: Dependency[] = [];

    // Match implementation, compile, api, etc. dependencies
    const dependencyRegex =
      /(?:implementation|compile|api)\s+['"]([^:'"]+):([^:'"]+):([^'"]+)['"]/g;

    let match;
    while ((match = dependencyRegex.exec(content)) !== null) {
      dependencies.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3],
      });
    }

    return dependencies;
  }

  /**
   * Return empty dependency result.
   */
  private emptyResult(): DependencyAnalysisResult {
    return {
      dependencies: [],
      devDependencies: [],
      totalCount: 0,
    };
  }

  /**
   * Analyze dependencies for all workspace folders in a multi-root workspace.
   * Returns a map of workspace path to dependency analysis results.
   *
   * @param projectTypes - Map of workspace paths to project types
   * @returns Map of workspace paths to dependency analysis results
   */
  async analyzeDependenciesForWorkspaces(
    projectTypes: Map<string, ProjectType>
  ): Promise<Map<string, DependencyAnalysisResult>> {
    const results = new Map<string, DependencyAnalysisResult>();

    for (const [workspacePath, projectType] of projectTypes) {
      const analysis = await this.analyzeDependencies(
        workspacePath,
        projectType
      );
      results.set(workspacePath, analysis);
    }

    return results;
  }
}
