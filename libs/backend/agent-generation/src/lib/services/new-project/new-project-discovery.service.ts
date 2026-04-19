/**
 * NewProjectDiscoveryService - Static question group retrieval and answer validation
 *
 * Stateless service that returns discovery questions from the QUESTION_REGISTRY
 * for a given project type, validates user answers, and extracts metadata.
 *
 * No LLM involvement - purely deterministic.
 *
 * @module @ptah-extension/agent-generation
 */

import { injectable } from 'tsyringe';
import { QUESTION_REGISTRY } from '@ptah-extension/shared';
import type {
  NewProjectType,
  QuestionGroup,
  DiscoveryAnswers,
} from '@ptah-extension/shared';

// ============================================================================
// Types
// ============================================================================

export interface AnswerValidationResult {
  valid: boolean;
  missingFields: string[];
}

// ============================================================================
// Service
// ============================================================================

@injectable()
export class NewProjectDiscoveryService {
  /**
   * Get the question groups for a given project type.
   *
   * @param projectType - The selected project type
   * @returns Array of question groups with their questions
   * @throws Error if projectType is not in the registry
   */
  getQuestionGroups(projectType: NewProjectType): QuestionGroup[] {
    const config = QUESTION_REGISTRY[projectType];
    if (!config) {
      throw new Error(`Unknown project type: ${projectType}`);
    }
    return config.groups;
  }

  /**
   * Validate user answers against required questions for the given project type.
   *
   * Checks that all required questions have non-empty answers, and that
   * multi-select questions meet their minimum selection requirements.
   *
   * @param projectType - The selected project type
   * @param answers - User-provided answers keyed by question ID
   * @returns Validation result with missing field IDs
   */
  validateAnswers(
    projectType: NewProjectType,
    answers: DiscoveryAnswers,
  ): AnswerValidationResult {
    const groups = this.getQuestionGroups(projectType);
    const missingFields: string[] = [];

    for (const group of groups) {
      for (const question of group.questions) {
        if (!question.required) continue;

        const answer = answers[question.id];

        if (answer === undefined || answer === null) {
          missingFields.push(question.id);
          continue;
        }

        if (Array.isArray(answer)) {
          if (answer.length < (question.minSelections ?? 1)) {
            missingFields.push(question.id);
          }
        } else if (String(answer).trim().length === 0) {
          missingFields.push(question.id);
        }
      }
    }

    return { valid: missingFields.length === 0, missingFields };
  }

  /**
   * Extract the project name from discovery answers.
   *
   * Falls back to 'new-project' if the 'project-name' answer is missing or empty.
   *
   * @param answers - User-provided answers
   * @returns Trimmed project name string
   */
  extractProjectName(answers: DiscoveryAnswers): string {
    const name = answers['project-name'];
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim();
    }
    return 'new-project';
  }
}
