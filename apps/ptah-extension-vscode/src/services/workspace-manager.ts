import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../core/logger';
import { WorkspaceInfo } from '@ptah-extension/shared';

export class WorkspaceManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private currentWorkspaceInfo?: WorkspaceInfo;

  constructor() {
    this.updateWorkspaceInfo();
    this.setupEventHandlers();
  }

  getCurrentWorkspaceInfo(): WorkspaceInfo | undefined {
    return this.currentWorkspaceInfo;
  }

  detectProjectType(workspacePath: string): string {
    try {
      // Check for various project indicators
      const files = fs.readdirSync(workspacePath);

      // Node.js/JavaScript projects
      if (files.includes('package.json')) {
        const packageJson = this.readPackageJson(workspacePath);
        if (packageJson) {
          if (
            packageJson.dependencies?.react ||
            packageJson.devDependencies?.react
          ) {
            return 'react';
          }
          if (
            packageJson.dependencies?.vue ||
            packageJson.devDependencies?.vue
          ) {
            return 'vue';
          }
          if (
            packageJson.dependencies?.angular ||
            packageJson.devDependencies?.angular
          ) {
            return 'angular';
          }
          if (
            packageJson.dependencies?.next ||
            packageJson.devDependencies?.next
          ) {
            return 'nextjs';
          }
          if (
            packageJson.dependencies?.express ||
            packageJson.devDependencies?.express
          ) {
            return 'express';
          }
          return 'node';
        }
      }

      // Python projects
      if (
        files.includes('requirements.txt') ||
        files.includes('pyproject.toml') ||
        files.includes('setup.py')
      ) {
        return 'python';
      }

      // Java projects
      if (files.includes('pom.xml')) {
        return 'maven';
      }
      if (
        files.includes('build.gradle') ||
        files.includes('build.gradle.kts')
      ) {
        return 'gradle';
      }

      // .NET projects
      if (
        files.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))
      ) {
        return 'dotnet';
      }

      // Rust projects
      if (files.includes('Cargo.toml')) {
        return 'rust';
      }

      // Go projects
      if (files.includes('go.mod')) {
        return 'go';
      }

      // PHP projects
      if (files.includes('composer.json')) {
        return 'php';
      }

      // Ruby projects
      if (files.includes('Gemfile')) {
        return 'ruby';
      }

      // Check for specific framework files
      if (files.includes('angular.json')) {
        return 'angular';
      }
      if (
        files.includes('nuxt.config.js') ||
        files.includes('nuxt.config.ts')
      ) {
        return 'nuxt';
      }
      if (files.includes('gatsby-config.js')) {
        return 'gatsby';
      }
      if (
        files.includes('vite.config.js') ||
        files.includes('vite.config.ts')
      ) {
        return 'vite';
      }
      if (files.includes('webpack.config.js')) {
        return 'webpack';
      }

      return 'general';
    } catch (error) {
      Logger.warn(`Failed to detect project type for ${workspacePath}`, error);
      return 'general';
    }
  }

  getProjectInfo(): any {
    if (!this.currentWorkspaceInfo) {
      return null;
    }

    const projectInfo: any = {
      name: this.currentWorkspaceInfo.name,
      type: this.currentWorkspaceInfo.type,
      path: this.currentWorkspaceInfo.path,
    };

    try {
      const workspacePath = this.currentWorkspaceInfo.path;

      // Add type-specific information
      switch (this.currentWorkspaceInfo.type) {
        case 'node':
        case 'react':
        case 'vue':
        case 'angular':
        case 'nextjs': {
          const packageJson = this.readPackageJson(workspacePath);
          if (packageJson) {
            projectInfo.version = packageJson.version;
            projectInfo.description = packageJson.description;
            projectInfo.dependencies = Object.keys(
              packageJson.dependencies || {}
            );
            projectInfo.devDependencies = Object.keys(
              packageJson.devDependencies || {}
            );
          }
          break;
        }

        case 'python':
          projectInfo.pythonFiles = this.countFilesByExtension(workspacePath, [
            '.py',
          ]);
          break;

        case 'java':
        case 'maven':
        case 'gradle':
          projectInfo.javaFiles = this.countFilesByExtension(workspacePath, [
            '.java',
          ]);
          break;

        case 'rust':
          projectInfo.rustFiles = this.countFilesByExtension(workspacePath, [
            '.rs',
          ]);
          break;

        case 'go':
          projectInfo.goFiles = this.countFilesByExtension(workspacePath, [
            '.go',
          ]);
          break;
      }

      // Add general statistics
      projectInfo.totalFiles = this.countAllFiles(workspacePath);
      projectInfo.gitRepository = fs.existsSync(
        path.join(workspacePath, '.git')
      );
    } catch (error) {
      Logger.warn('Failed to gather additional project info', error);
    }

    return projectInfo;
  }

  getRecommendedContextTemplate(): string {
    if (!this.currentWorkspaceInfo) {
      return 'general';
    }

    // Map project types to context templates
    const templateMap: Record<string, string> = {
      react: 'react',
      vue: 'vue',
      angular: 'angular',
      nextjs: 'react', // NextJS uses React
      node: 'node',
      express: 'node',
      python: 'python',
      java: 'java',
      maven: 'java',
      gradle: 'java',
      rust: 'rust',
      go: 'go',
      dotnet: 'dotnet',
      php: 'php',
      ruby: 'ruby',
    };

    return templateMap[this.currentWorkspaceInfo.type] || 'general';
  }

  async analyzeWorkspaceStructure(): Promise<any> {
    if (!this.currentWorkspaceInfo) {
      return null;
    }

    try {
      const analysis = {
        projectType: this.currentWorkspaceInfo.type,
        structure: await this.getDirectoryStructure(
          this.currentWorkspaceInfo.path
        ),
        recommendations: this.getContextRecommendations(),
      };

      return analysis;
    } catch (error) {
      Logger.error('Failed to analyze workspace structure', error);
      return null;
    }
  }

  private updateWorkspaceInfo(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (workspaceFolder) {
      const workspacePath = workspaceFolder.uri.fsPath;
      const projectType = this.detectProjectType(workspacePath);

      this.currentWorkspaceInfo = {
        name: workspaceFolder.name,
        path: workspacePath,
        type: projectType,
      };

      Logger.info(
        `Workspace detected: ${workspaceFolder.name} (${projectType})`
      );
    } else {
      this.currentWorkspaceInfo = undefined;
      Logger.info('No workspace folder detected');
    }
  }

  private setupEventHandlers(): void {
    // Listen for workspace changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.updateWorkspaceInfo();
      })
    );
  }

  private readPackageJson(workspacePath: string): any {
    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const content = fs.readFileSync(packageJsonPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  private countFilesByExtension(dirPath: string, extensions: string[]): number {
    let count = 0;

    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const file of files) {
        const fullPath = path.join(dirPath, file.name);

        if (file.isDirectory() && !this.shouldSkipDirectory(file.name)) {
          count += this.countFilesByExtension(fullPath, extensions);
        } else if (file.isFile()) {
          const ext = path.extname(file.name).toLowerCase();
          if (extensions.includes(ext)) {
            count++;
          }
        }
      }
    } catch (error) {
      // Ignore errors for directories we can't read
    }

    return count;
  }

  private countAllFiles(dirPath: string): number {
    let count = 0;

    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const file of files) {
        if (file.isDirectory() && !this.shouldSkipDirectory(file.name)) {
          const fullPath = path.join(dirPath, file.name);
          count += this.countAllFiles(fullPath);
        } else if (file.isFile()) {
          count++;
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return count;
  }

  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.vscode',
      '.idea',
      'dist',
      'build',
      'out',
      'target',
      '__pycache__',
      '.venv',
      'venv',
      '.next',
      '.nuxt',
    ];

    return skipDirs.includes(name) || name.startsWith('.');
  }

  private async getDirectoryStructure(
    dirPath: string,
    maxDepth = 3,
    currentDepth = 0
  ): Promise<any> {
    if (currentDepth >= maxDepth) {
      return null;
    }

    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      const structure: any = { directories: [], files: [] };

      for (const file of files) {
        if (file.isDirectory() && !this.shouldSkipDirectory(file.name)) {
          const subStructure = await this.getDirectoryStructure(
            path.join(dirPath, file.name),
            maxDepth,
            currentDepth + 1
          );
          structure.directories.push({
            name: file.name,
            structure: subStructure,
          });
        } else if (file.isFile()) {
          structure.files.push({
            name: file.name,
            extension: path.extname(file.name),
          });
        }
      }

      return structure;
    } catch (error) {
      return null;
    }
  }

  private getContextRecommendations(): string[] {
    if (!this.currentWorkspaceInfo) {
      return [];
    }

    const recommendations: string[] = [];

    switch (this.currentWorkspaceInfo.type) {
      case 'react':
        recommendations.push(
          'Include src/ directory for main application code',
          'Include package.json for dependencies',
          'Exclude node_modules and build directories',
          'Consider excluding test files if focusing on implementation'
        );
        break;

      case 'python':
        recommendations.push(
          'Include all .py files for source code',
          'Include requirements.txt or pyproject.toml for dependencies',
          'Exclude __pycache__ and virtual environment directories',
          'Consider excluding test files if not needed'
        );
        break;

      case 'java':
        recommendations.push(
          'Include src/main/java for source code',
          'Include pom.xml or build.gradle for configuration',
          'Exclude target/ or build/ directories',
          'Consider including only specific packages if project is large'
        );
        break;

      default:
        recommendations.push(
          'Include main source files relevant to your task',
          'Include configuration files (package.json, etc.)',
          'Exclude build artifacts and dependencies',
          'Use token optimization for large projects'
        );
    }

    return recommendations;
  }

  dispose(): void {
    Logger.info('Disposing Workspace Manager...');
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
