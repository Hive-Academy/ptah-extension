/**
 * NewProjectStorageService - Master plan persistence to workspace disk
 *
 * Saves and loads the MasterPlan as JSON in .ptah/new-project/ within the
 * workspace directory. Also generates a human-readable markdown summary
 * alongside the JSON for developer reference.
 *
 * @module @ptah-extension/agent-generation
 */

import { inject, injectable } from 'tsyringe';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { MasterPlan } from '@ptah-extension/shared';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = '[NewProjectStorage]';
const STORAGE_DIR = '.ptah/new-project';
const PLAN_FILENAME = 'master-plan.json';
const SUMMARY_FILENAME = 'master-plan.md';

// ============================================================================
// Service
// ============================================================================

@injectable()
export class NewProjectStorageService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Save the master plan to disk as both JSON and markdown.
   *
   * Creates the .ptah/new-project/ directory if it does not exist.
   * Overwrites any existing plan files.
   *
   * @param workspacePath - Absolute path to the workspace root
   * @param plan - The MasterPlan to persist
   * @returns Absolute path to the saved JSON file
   */
  async savePlan(workspacePath: string, plan: MasterPlan): Promise<string> {
    const dir = join(workspacePath, STORAGE_DIR);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, PLAN_FILENAME);
    await writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');

    const summaryPath = join(dir, SUMMARY_FILENAME);
    await writeFile(summaryPath, this.generateMarkdownSummary(plan), 'utf-8');

    this.logger.info(`${SERVICE_TAG} Plan saved`, {
      filePath,
      summaryPath,
      projectName: plan.projectName,
      phaseCount: plan.phases.length,
    });

    return filePath;
  }

  /**
   * Load a previously saved master plan from disk.
   *
   * @param workspacePath - Absolute path to the workspace root
   * @returns The loaded MasterPlan, or null if no plan file exists
   */
  async loadPlan(workspacePath: string): Promise<MasterPlan | null> {
    const filePath = join(workspacePath, STORAGE_DIR, PLAN_FILENAME);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Runtime validation: ensure required fields exist before casting
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.projectName !== 'string' ||
        typeof parsed.projectType !== 'string' ||
        !Array.isArray(parsed.phases) ||
        !Array.isArray(parsed.techStack) ||
        typeof parsed.summary !== 'string' ||
        typeof parsed.directoryStructure !== 'string' ||
        !Array.isArray(parsed.architectureDecisions)
      ) {
        this.logger.warn(
          `${SERVICE_TAG} Invalid master plan structure in saved file`,
          { filePath },
        );
        return null;
      }

      const plan = parsed as MasterPlan;

      this.logger.info(`${SERVICE_TAG} Plan loaded`, {
        filePath,
        projectName: plan.projectName,
      });

      return plan;
    } catch (error: unknown) {
      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as NodeJS.ErrnoException).code === 'string'
          ? (error as NodeJS.ErrnoException).code
          : undefined;

      if (errorCode === 'ENOENT') {
        this.logger.debug(
          `${SERVICE_TAG} No existing plan found at ${filePath}`,
        );
        return null;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`${SERVICE_TAG} Failed to load existing plan`, {
        filePath,
        errorCode,
        errorMessage,
      });
      return null;
    }
  }

  /**
   * Delete a previously saved master plan from disk.
   */
  async deletePlan(workspacePath: string): Promise<void> {
    const dir = join(workspacePath, STORAGE_DIR);
    const planPath = join(dir, PLAN_FILENAME);
    const summaryPath = join(dir, SUMMARY_FILENAME);

    for (const filePath of [planPath, summaryPath]) {
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof (error as NodeJS.ErrnoException).code === 'string'
            ? (error as NodeJS.ErrnoException).code
            : undefined;
        if (code !== 'ENOENT') {
          this.logger.warn(`${SERVICE_TAG} Failed to delete ${filePath}`);
        }
      }
    }

    this.logger.info(`${SERVICE_TAG} Plan deleted from ${dir}`);
  }

  // ==========================================================================
  // Private - Markdown Generation
  // ==========================================================================

  /**
   * Generate a human-readable markdown summary from the master plan.
   *
   * The markdown includes project metadata, architecture decisions,
   * directory structure, and all phases with their tasks.
   */
  private generateMarkdownSummary(plan: MasterPlan): string {
    const sections: string[] = [];

    // Header
    sections.push(`# ${plan.projectName}`);
    sections.push('');
    sections.push(`**Type:** ${plan.projectType}`);
    sections.push(`**Tech Stack:** ${plan.techStack.join(', ')}`);
    sections.push('');

    // Architecture Decisions
    sections.push('## Architecture Decisions');
    sections.push('');
    for (const decision of plan.architectureDecisions) {
      sections.push(`### ${decision.area}`);
      sections.push(`**Decision:** ${decision.decision}`);
      sections.push(`**Rationale:** ${decision.rationale}`);
      sections.push('');
    }

    // Directory Structure
    sections.push('## Directory Structure');
    sections.push('');
    sections.push('```');
    sections.push(plan.directoryStructure);
    sections.push('```');
    sections.push('');

    // Implementation Phases
    sections.push('## Implementation Phases');
    sections.push('');
    for (const phase of plan.phases) {
      sections.push(`### ${phase.name}`);
      sections.push(phase.description);
      sections.push('');

      if (phase.dependsOn.length > 0) {
        sections.push(`**Depends on:** ${phase.dependsOn.join(', ')}`);
        sections.push('');
      }

      for (const task of phase.tasks) {
        const fileList =
          task.filePaths.length > 0 ? ` [${task.filePaths.join(', ')}]` : '';
        sections.push(
          `- **${task.title}** (${task.agentType}): ${task.description}${fileList}`,
        );
      }
      sections.push('');
    }

    // Summary
    sections.push('## Summary');
    sections.push('');
    sections.push(plan.summary);
    sections.push('');

    return sections.join('\n');
  }
}
