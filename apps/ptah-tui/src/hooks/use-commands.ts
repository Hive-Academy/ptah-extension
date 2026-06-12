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
  onSendMessage: (text: string) => void;
}

interface RemoteCommandInfo {
  name: string;
  description: string;
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  argumentHint?: string;
}

interface AutocompleteCommandsResult {
  commands?: RemoteCommandInfo[];
}

export function useCommands(callbacks: CommandCallbacks): UseCommandsResult {
  const { transport } = useTuiContext();
  const themeContext = useThemeContext();
  const modeContext = useModeContext();
  const sessionContext = useSessionContext();

  const [remoteCommands, setRemoteCommands] = useState<CommandEntry[]>([]);
  const [loading, setLoading] = useState(false);

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
        description: 'Clear the chat message history (TUI view + SDK state)',
        scope: 'tui-local',
        handler: () => {
          callbacks.onClear();
          callbacks.onSendMessage('/clear');
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
        name: 'sessions',
        description: 'Toggle the session sidebar',
        scope: 'tui-local',
        handler: () => {
          callbacks.onSessions();
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
        name: 'status',
        description: 'Show current TUI session status information',
        scope: 'tui-local',
      },
      {
        name: 'help',
        description: 'List all available commands',
        scope: 'tui-local',
      },
      {
        name: 'quit',
        description: 'Exit the TUI application',
        scope: 'tui-local',
        handler: () => {
          callbacks.onQuit();
        },
      },
    ];

    const helpCmd = cmds.find((c) => c.name === 'help');
    if (helpCmd) {
      helpCmd.handler = () => {
        callbacks.onSystemMessage(formatHelpText(cmds));
      };
    }

    return cmds;
  }, [transport, themeContext, modeContext, callbacks]);

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
          }));
          setRemoteCommands(mapped);
        }
      } catch {
        /* leave remote commands empty on failure */
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

  const commands = useMemo((): CommandEntry[] => {
    const localNames = new Set(localCommands.map((c) => c.name));
    const deduped = remoteCommands.filter((c) => !localNames.has(c.name));
    return [...localCommands, ...deduped];
  }, [localCommands, remoteCommands]);

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

  const executeCommand = useCallback(
    async (name: string, args: string): Promise<string | null> => {
      const cmd = commands.find((c) => c.name === name);
      if (!cmd) {
        return `Unknown command: /${name}. Type /help to list available commands.`;
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

      if (cmd.handler) {
        await cmd.handler(args);
        return null;
      }

      if (cmd.scope !== 'tui-local') {
        const trimmedArgs = args.trim();
        const text = trimmedArgs
          ? `/${cmd.name} ${trimmedArgs}`
          : `/${cmd.name}`;
        callbacks.onSendMessage(text);
      }

      return null;
    },
    [commands, sessionContext, callbacks],
  );

  return { commands, searchCommands, executeCommand, loading };
}
