/**
 * Orchestration Namespace Builder
 *
 * Provides state management tools for orchestration workflows.
 * Enables workflow state persistence and continuation across sessions.
 *
 * TASK_2025_111: MCP-Powered Setup Wizard & Orchestration Skill Enhancements
 */

import * as vscode from 'vscode';
import {
  OrchestrationNamespace,
  OrchestrationState,
  OrchestrationNextAction,
  OrchestrationPhase,
  OrchestrationCheckpoint,
} from '../types';

/**
 * Dependencies required for orchestration namespace
 */
export interface OrchestrationNamespaceDependencies {
  /** Workspace root URI for file operations */
  workspaceRoot: vscode.Uri;
}

/**
 * Default checkpoint state when no checkpoint has been presented
 */
const DEFAULT_CHECKPOINT: OrchestrationCheckpoint = {
  type: null,
  status: 'pending',
  timestamp: '',
};

/**
 * Strategy to phase mapping for determining next actions
 * Maps workflow strategies to their expected phase sequences
 */
const STRATEGY_PHASE_SEQUENCE: Record<string, OrchestrationPhase[]> = {
  FEATURE: ['planning', 'design', 'implementation', 'qa', 'complete'],
  BUGFIX: ['planning', 'implementation', 'qa', 'complete'],
  REFACTORING: ['planning', 'design', 'implementation', 'qa', 'complete'],
  DOCUMENTATION: ['planning', 'implementation', 'complete'],
  RESEARCH: ['planning', 'implementation', 'complete'],
  DEVOPS: ['planning', 'design', 'implementation', 'qa', 'complete'],
  CREATIVE: ['planning', 'design', 'implementation', 'complete'],
};

/**
 * Agent recommendations by phase
 * Maps phases to the agents that should be invoked
 */
const PHASE_AGENTS: Record<OrchestrationPhase, string[]> = {
  planning: ['project-manager'],
  design: ['software-architect'],
  implementation: ['team-leader'],
  qa: ['senior-tester', 'code-style-reviewer', 'code-logic-reviewer'],
  complete: [],
};

/**
 * Checkpoints required before proceeding to next phase
 */
const PHASE_CHECKPOINTS: Record<OrchestrationPhase, string | null> = {
  planning: 'requirements',
  design: 'architecture',
  implementation: 'batch-complete',
  qa: null,
  complete: null,
};

/**
 * Build orchestration namespace for state management
 * Persists workflow state to task-tracking/TASK_XXX/.orchestration-state.json
 *
 * @param deps - Dependencies including workspace root
 * @returns OrchestrationNamespace with getState, setState, and getNextAction methods
 */
export function buildOrchestrationNamespace(
  deps: OrchestrationNamespaceDependencies
): OrchestrationNamespace {
  const { workspaceRoot } = deps;

  /**
   * Get the file path for orchestration state
   */
  const getStatePath = (taskId: string): vscode.Uri => {
    return vscode.Uri.joinPath(
      workspaceRoot,
      'task-tracking',
      taskId,
      '.orchestration-state.json'
    );
  };

  /**
   * Read orchestration state from file
   */
  const readStateFile = async (
    taskId: string
  ): Promise<OrchestrationState | null> => {
    const statePath = getStatePath(taskId);

    try {
      const content = await vscode.workspace.fs.readFile(statePath);
      const jsonString = Buffer.from(content).toString('utf8');
      return JSON.parse(jsonString) as OrchestrationState;
    } catch {
      // File doesn't exist or is invalid JSON
      return null;
    }
  };

  /**
   * Write orchestration state to file
   */
  const writeStateFile = async (state: OrchestrationState): Promise<void> => {
    const statePath = getStatePath(state.taskId);

    // Ensure the task folder exists
    const taskFolder = vscode.Uri.joinPath(
      workspaceRoot,
      'task-tracking',
      state.taskId
    );

    try {
      await vscode.workspace.fs.stat(taskFolder);
    } catch {
      // Folder doesn't exist, create it
      await vscode.workspace.fs.createDirectory(taskFolder);
    }

    const content = JSON.stringify(state, null, 2);
    await vscode.workspace.fs.writeFile(
      statePath,
      Buffer.from(content, 'utf8')
    );
  };

  /**
   * Create a default orchestration state for a new task
   */
  const createDefaultState = (taskId: string): OrchestrationState => ({
    taskId,
    phase: 'planning',
    currentAgent: null,
    lastCheckpoint: { ...DEFAULT_CHECKPOINT },
    pendingActions: [],
    strategy: '',
    metadata: {},
  });

  /**
   * Determine the next phase in the workflow sequence
   */
  const getNextPhase = (
    currentPhase: OrchestrationPhase,
    strategy: string
  ): OrchestrationPhase | null => {
    const sequence =
      STRATEGY_PHASE_SEQUENCE[strategy] || STRATEGY_PHASE_SEQUENCE['FEATURE'];
    const currentIndex = sequence.indexOf(currentPhase);

    if (currentIndex === -1 || currentIndex === sequence.length - 1) {
      return null;
    }

    return sequence[currentIndex + 1];
  };

  /**
   * Analyze documents to determine if phase requirements are met
   * Checks for existence of required documents in task folder
   */
  const checkPhaseRequirementsMet = async (
    taskId: string,
    phase: OrchestrationPhase
  ): Promise<boolean> => {
    const taskFolder = vscode.Uri.joinPath(
      workspaceRoot,
      'task-tracking',
      taskId
    );

    const requiredDocuments: Record<OrchestrationPhase, string[]> = {
      planning: ['task-description.md'],
      design: ['implementation-plan.md'],
      implementation: ['tasks.md'],
      qa: [],
      complete: [],
    };

    const required = requiredDocuments[phase];

    for (const doc of required) {
      const docPath = vscode.Uri.joinPath(taskFolder, doc);
      try {
        await vscode.workspace.fs.stat(docPath);
      } catch {
        return false;
      }
    }

    return true;
  };

  return {
    /**
     * Get the current orchestration state for a task
     */
    getState: async (taskId: string): Promise<OrchestrationState | null> => {
      return readStateFile(taskId);
    },

    /**
     * Update the orchestration state for a task
     * Merges partial state with existing state
     */
    setState: async (
      taskId: string,
      partialState: Partial<OrchestrationState>
    ): Promise<void> => {
      // Read existing state or create default
      const existing =
        (await readStateFile(taskId)) || createDefaultState(taskId);

      // Merge state with proper handling of nested objects
      const newState: OrchestrationState = {
        taskId,
        phase: partialState.phase ?? existing.phase,
        currentAgent: partialState.currentAgent ?? existing.currentAgent,
        lastCheckpoint: partialState.lastCheckpoint ?? existing.lastCheckpoint,
        pendingActions: partialState.pendingActions ?? existing.pendingActions,
        strategy: partialState.strategy ?? existing.strategy,
        metadata: {
          ...existing.metadata,
          ...partialState.metadata,
        },
      };

      await writeStateFile(newState);
    },

    /**
     * Analyze current state and recommend the next action
     */
    getNextAction: async (taskId: string): Promise<OrchestrationNextAction> => {
      const state = await readStateFile(taskId);

      // No state exists - recommend starting with planning
      if (!state) {
        return {
          action: 'invoke-agent',
          agent: 'project-manager',
          context: { taskId, isNewTask: true },
          requiredInputs: ['user-request'],
        };
      }

      // Workflow is complete
      if (state.phase === 'complete') {
        return {
          action: 'complete',
          context: { taskId, completedAt: new Date().toISOString() },
        };
      }

      // Check if current phase requires a checkpoint that hasn't been approved
      const requiredCheckpoint = PHASE_CHECKPOINTS[state.phase];
      if (
        requiredCheckpoint &&
        state.lastCheckpoint.type !== requiredCheckpoint
      ) {
        return {
          action: 'present-checkpoint',
          checkpointType: requiredCheckpoint,
          context: { taskId, phase: state.phase },
        };
      }

      // Check if checkpoint was rejected
      if (state.lastCheckpoint.status === 'rejected') {
        // Re-invoke the current phase agent to address feedback
        const agents = PHASE_AGENTS[state.phase];
        return {
          action: 'invoke-agent',
          agent: agents[0] || 'project-manager',
          context: {
            taskId,
            phase: state.phase,
            feedback: 'Checkpoint rejected, please revise',
          },
        };
      }

      // Check if phase requirements are met to proceed
      const requirementsMet = await checkPhaseRequirementsMet(
        taskId,
        state.phase
      );

      if (!requirementsMet) {
        // Phase requirements not met - invoke appropriate agent
        const agents = PHASE_AGENTS[state.phase];
        return {
          action: 'invoke-agent',
          agent: agents[0] || 'project-manager',
          context: { taskId, phase: state.phase },
          requiredInputs: ['task-context'],
        };
      }

      // Phase complete and checkpoint approved - determine next phase
      const nextPhase = getNextPhase(state.phase, state.strategy);

      if (!nextPhase) {
        // No more phases - workflow complete
        return {
          action: 'complete',
          context: { taskId, completedAt: new Date().toISOString() },
        };
      }

      // Proceed to next phase
      const nextAgents = PHASE_AGENTS[nextPhase];
      return {
        action: 'invoke-agent',
        agent: nextAgents[0] || 'team-leader',
        context: {
          taskId,
          previousPhase: state.phase,
          nextPhase: nextPhase,
        },
      };
    },
  };
}
