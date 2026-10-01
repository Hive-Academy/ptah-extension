/**
 * Settings Components - Barrel Export
 *
 * The Advanced and Search & Voice tab children (membership card, system prompt, output style,
 * MCP port, VS Code LM, web search, voice and its panels) are deliberately NOT exported: they
 * load only inside the `@defer` blocks of `settings.component.html`, and a re-export here keeps
 * them in the eager bundle. Nothing outside this folder imports them.
 */

export { SettingsComponent } from './settings.component';
export { AgentOrchestrationConfigComponent } from './ptah-ai/agent-orchestration-config.component';
export { PtahCliConfigComponent } from './ptah-ai/ptah-cli-config.component';
