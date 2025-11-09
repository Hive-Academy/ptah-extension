/**
 * Intelligent Provider Selection Strategy - Cline-style AI provider scoring
 * Implements context-aware provider selection with confidence scoring and fallback options
 */

import { injectable } from 'tsyringe';
import type { ProviderId } from '@ptah-extension/shared';
import type {
  ProviderContext,
  EnhancedAIProvider,
  ProviderSelectionResult,
} from '../interfaces';

/**
 * Intelligent Provider Strategy - Scores and selects providers based on task context
 * Implements Cline-style specialization (e.g., DeepSeek R1 for reasoning, Claude Sonnet for coding)
 *
 * @injectable Registered with DI container for dependency injection
 */
@injectable()
export class IntelligentProviderStrategy {
  /**
   * Selects the best provider for a given context
   * Scores all available providers and returns the best match with fallback options
   *
   * @param context - Task context information
   * @param availableProviders - Map of currently available providers
   * @returns Selection result with provider ID, confidence, reasoning, and fallbacks
   * @throws Error if no providers can handle the given context
   */
  async selectProvider(
    context: ProviderContext,
    availableProviders: Map<ProviderId, EnhancedAIProvider>
  ): Promise<ProviderSelectionResult> {
    // Filter providers that can handle the context and calculate scores
    const candidates = Array.from(availableProviders.entries())
      .filter(([, provider]) => provider.canHandle(context))
      .map(([id, provider]) => ({
        id,
        provider,
        score: this.calculateScore(context, provider),
      }))
      .sort((a, b) => b.score - a.score); // Sort by score descending

    if (candidates.length === 0) {
      throw new Error(
        `No providers available for context: ${JSON.stringify(context)}`
      );
    }

    const best = candidates[0];
    const fallbacks = candidates.slice(1, 3).map((c) => c.id);

    return {
      providerId: best.id,
      confidence: best.score,
      reasoning: this.generateReasoning(context, best.provider),
      fallbacks,
    };
  }

  /**
   * Calculates a confidence score (0-100) for a provider given a context
   * Implements Cline-style task type specialization and health-aware scoring
   *
   * @param context - Task context information
   * @param provider - Provider to score
   * @returns Confidence score between 0 and 100
   */
  private calculateScore(
    context: ProviderContext,
    provider: EnhancedAIProvider
  ): number {
    let score = 0;

    // Task type matching (50 points) - Cline-style specialization
    // Claude CLI excels at coding tasks
    if (context.taskType === 'coding' && provider.providerId === 'claude-cli') {
      score += 50;
    }
    // Claude CLI also good for reasoning and refactoring
    if (
      (context.taskType === 'reasoning' ||
        context.taskType === 'refactoring') &&
      provider.providerId === 'claude-cli'
    ) {
      score += 45;
    }
    // VS Code LM for simpler tasks or analysis
    if (
      (context.taskType === 'analysis' || context.taskType === 'debugging') &&
      provider.providerId === 'vscode-lm'
    ) {
      score += 40;
    }
    // Default score for providers that can handle the task but aren't specialized
    if (score === 0) {
      score += 25; // Base score for capable providers
    }

    // Complexity matching (20 points)
    if (
      context.complexity === 'high' &&
      provider.info.capabilities.functionCalling
    ) {
      score += 20;
    }
    if (context.complexity === 'low') {
      const health = provider.getHealth();
      if (health.responseTime && health.responseTime < 1000) {
        score += 15;
      }
    }
    if (context.complexity === 'medium') {
      score += 10; // Neutral score for medium complexity
    }

    // File type specialization (10 points)
    // Claude CLI handles all common programming languages well
    if (
      (context.fileTypes.includes('.ts') ||
        context.fileTypes.includes('.tsx') ||
        context.fileTypes.includes('.js') ||
        context.fileTypes.includes('.jsx')) &&
      provider.providerId === 'claude-cli'
    ) {
      score += 10;
    }
    // VS Code LM can handle common languages too
    if (context.fileTypes.length > 0 && provider.providerId === 'vscode-lm') {
      score += 5;
    }

    // Health and availability (30 points)
    const health = provider.getHealth();
    if (health.status === 'available') {
      score += 30;
    } else if (health.status === 'initializing') {
      score += 20;
    } else if (health.status === 'error' || health.status === 'unavailable') {
      score += 0; // Zero points for unhealthy providers
    }

    // Cost consideration (5 points bonus for low-cost on simple tasks)
    const estimatedCost = provider.estimateCost(context);
    if (context.complexity === 'low' && estimatedCost < 0.01) {
      score += 5;
    }

    // Ensure score is within 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generates human-readable reasoning for the provider selection
   *
   * @param context - Task context information
   * @param provider - Selected provider
   * @returns Reasoning string explaining the selection decision
   */
  private generateReasoning(
    context: ProviderContext,
    provider: EnhancedAIProvider
  ): string {
    const health = provider.getHealth();
    const estimatedLatency = provider.estimateLatency(context);

    return (
      `Selected ${provider.providerId} for ${context.taskType} task with ${context.complexity} complexity. ` +
      `Provider health: ${health.status}, estimated latency: ${estimatedLatency}ms`
    );
  }
}
