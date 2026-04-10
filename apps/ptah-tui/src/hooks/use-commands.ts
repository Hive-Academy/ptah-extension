/**
 * useCommands -- Command registry and execution hook.
 *
 * TASK_2025_266 Batch 4
 *
 * Manages 12 local TUI commands and merges with remote commands fetched
 * from the backend via the autocomplete:commands RPC method.
 *
 * Local commands take priority by name when merging with remote commands.
 *
 * Usage:
 *   const { commands, searchCommands, executeCommand, loading } = useCommands(callbacks);
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

import { useTuiContext } from '../context/TuiContext.js';
import { useThemeContext } from '../context/ThemeContext.js';
import { useModeContext } from '../context/ModeContext.js';
import { useSessionContext } from '../context/SessionContext.js';
import type { ThemeName } from '../lib/themes.js';
import type { AppMode } from './use-mode.js';

export interface CommandEntry {
  name: string;
  description: string;
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin' | 'tui-local';
  argumentHint?: string;
  handler?: (args: string) => void | Promise<void>;
}

export interface UseCommandsResult {
  commands: CommandEntry[];
  searchCommands: (query: string) => CommandEntry[];
  executeCommand: (name: string, args: string) => Promise<string | null>;
  loading: boolean;
}

export interface CommandCallbacks {
  onClear: () => void;
  onSettings: () => void;
  onSessions: () => void;
  onQuit: () => void;
  onSystemMessage: (text: string) => void;
}

/** Shape of a remote command returned from autocomplete:commands RPC. */
interface RemoteCommandInfo {
  name: string;
  description: string;
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  argumentHint?: string;
}

/** Shape of the autocomplete:commands RPC response. */
interface AutocompleteCommandsResult {
  commands?: RemoteCommandInfo[];
}

/**
 * Hook providing command registration, search, and execution.
 * Fetches remote commands on mount and merges with local TUI commands.
 */
export function useCommands(callbacks: CommandCallbacks): UseCommandsResult {
  const { transport } = useTuiContext();
  const themeContext = useThemeContext();
  const modeContext = useModeContext();
  const sessionContext = useSessionContext();

  const [remoteCommands, setRemoteCommands] = useState<CommandEntry[]>([]);
  const [loading, setLoading] = useState(false);

  /**
   * Build the 12 local TUI commands.
   * These are memoized but depend on context values for their handlers.
   */
  const localCommands = useMemo((): CommandEntry[] => {
    const formatHelpText = (cmds: CommandEntry[]): string => {
      const lines = cmds.map((cmd) => {
        const argPart = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';
        return `  /${cmd.name}${argPart} -- ${cmd.description}`;
      });
      return `Available commands:\n${lines.join('\n')}`;
    };

    const cmds: CommandEntry[] = [
      {
        name: 'clear',
        description: 'Clear the chat message history',
        scope: 'tui-local',
        handler: () => {
          callbacks.onClear();
        },
      },
      {
        name: 'new',
        description: 'Create a new chat session',
        scope: 'tui-local',
        handler: async () => {
          await transport.call('session:create', {});
        },
      },
      {
        name: 'settings',
        description: 'Open the settings panel',
        scope: 'tui-local',
        handler: () => {
          callbacks.onSettings();
        },
      },
      {
        name: 'help',
        description: 'List all available commands',
        scope: 'tui-local',
        // handler returns text via executeCommand's string result path
      },
      {
        name: 'quit',
        description: 'Exit the TUI application',
        scope: 'tui-local',
        handler: () => {
          callbacks.onQuit();
        },
      },
      {
        name: 'model',
        description: 'Switch the active LLM model',
        scope: 'tui-local',
        argumentHint: '<model-name>',
        handler: async (args: string) => {
          if (!args.trim()) return;
          await transport.call('config:model-switch', { model: args.trim() });
        },
      },
      {
        name: 'mode',
        description: 'Switch between plan and build modes',
        scope: 'tui-local',
        argumentHint: '<plan|build>',
        handler: async (args: string) => {
          const trimmed = args.trim().toLowerCase();
          if (trimmed === 'plan' || trimmed === 'build') {
            await modeContext.setMode(trimmed as AppMode);
          }
        },
      },
      {
        name: 'theme',
        description: 'Switch the terminal color theme',
        scope: 'tui-local',
        argumentHint: '<theme-name>',
        handler: (args: string) => {
          const trimmed = args.trim().toLowerCase();
          if (themeContext.availableThemes.includes(trimmed as ThemeName)) {
            themeContext.setTheme(trimmed as ThemeName);
          }
        },
      },
      {
        name: 'compact',
        description: 'Compact the current chat context',
        scope: 'tui-local',
        handler: async () => {
          await transport.call('chat:compact', {});
        },
      },
      {
        name: 'cost',
        description: 'Show current session cost and token usage',
        scope: 'tui-local',
        // handler returns text via executeCommand's string result path
      },
      {
        name: 'status',
        description: 'Show current session status information',
        scope: 'tui-local',
        // handler returns text via executeCommand's string result path
      },
      {
        name: 'sessions',
        description: 'Toggle the session sidebar',
        scope: 'tui-local',
        handler: () => {
          callbacks.onSessions();
        },
      },
    ];

    // The /help command needs access to the full command list.
    // We set its handler after building the list.
    const helpCmd = cmds.find((c) => c.name === 'help');
    if (helpCmd) {
      helpCmd.handler = () => {
        callbacks.onSystemMessage(formatHelpText(cmds));
      };
    }

    return cmds;
  }, [transport, themeContext, modeContext, callbacks]);

  // Fetch remote commands on mount
  useEffect(() => {
    let cancelled = false;

    const fetchRemoteCommands = async (): Promise<void> => {
      setLoading(true);
      try {
        const response = await transport.call<
          { query: string },
          AutocompleteCommandsResult
        >('autocomplete:commands', { query: '' });

        if (cancelled) return;

        if (response.success && response.data?.commands) {
          const mapped: CommandEntry[] = response.data.commands.map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            scope: cmd.scope,
            argumentHint: cmd.argumentHint,
            // Remote commands have no local handler -- they are informational
            // or executed via other mechanisms (e.g., chat:start with / prefix)
          }));
          setRemoteCommands(mapped);
        }
      } catch {
        // Gracefully handle -- remote commands will just be empty
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchRemoteCommands();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  /**
   * Merged command list: local commands take priority by name.
   */
  const commands = useMemo((): CommandEntry[] => {
    const localNames = new Set(localCommands.map((c) => c.name));
    const deduped = remoteCommands.filter((c) => !localNames.has(c.name));
    return [...localCommands, ...deduped];
  }, [localCommands, remoteCommands]);

  /**
   * Filter commands by substring match on name and description.
   */
  const searchCommands = useCallback(
    (query: string): CommandEntry[] => {
      if (!query) return commands;
      const lower = query.toLowerCase();
      return commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lower) ||
          cmd.description.toLowerCase().includes(lower),
      );
    },
    [commands],
  );

  /**
   * Execute a command by name. Returns a string result (system message) or null.
   */
  const executeCommand = useCallback(
    async (name: string, args: string): Promise<string | null> => {
      const cmd = commands.find((c) => c.name === name);
      if (!cmd) return null;

      // Special cases that return text output
      if (cmd.name === 'cost') {
        const stats = sessionContext.stats;
        if (!stats) return 'No session stats available.';
        return (
          `Cost: $${stats.costUSD.toFixed(4)}\n` +
          `Input tokens: ${stats.inputTokens.toLocaleString()}\n` +
          `Output tokens: ${stats.outputTokens.toLocaleString()}\n` +
          `Model: ${stats.model ?? 'unknown'}`
        );
      }

      if (cmd.name === 'status') {
        const stats = sessionContext.stats;
        const sessionId = sessionContext.activeSessionId;
        if (!stats) return 'No active session.';
        return (
          `Session: ${sessionId ?? 'unknown'}\n` +
          `Model: ${stats.model ?? 'unknown'}\n` +
          `Context: ${stats.contextUsagePercent}% used (${stats.contextUsed.toLocaleString()}/${stats.contextWindow.toLocaleString()} tokens)\n` +
          `Cost: $${stats.costUSD.toFixed(4)}`
        );
      }

      // Commands with handlers
      if (cmd.handler) {
        await cmd.handler(args);
      }

      return null;
    },
    [commands, sessionContext],
  );

  return { commands, searchCommands, executeCommand, loading };
}
