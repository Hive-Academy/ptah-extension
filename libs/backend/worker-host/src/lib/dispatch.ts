import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';

export interface CommandIo {
  stdout(line: string): void;
  stderr(line: string): void;
  isTty: boolean;
  confirm(question: string): Promise<boolean>;
}

const defaultIo: CommandIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  isTty: Boolean(process.stdin.isTTY),
  confirm: async (question) => {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return (
        (await prompt.question(`${question} [y/N] `)).trim().toLowerCase() ===
        'y'
      );
    } finally {
      prompt.close();
    }
  },
};

const WORKER_USAGE =
  'Usage: ptah-worker serve|status|pair|workspace|grants|locks';

function numberOption(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return parsed;
}

export async function runWorkerCommand(
  args: string[],
  io: CommandIo = defaultIo,
  paths?: WorkerPaths,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        yes: { type: 'boolean' },
        'self-test': { type: 'boolean' },
        workspace: { type: 'string', multiple: true },
        ttl: { type: 'string' },
        port: { type: 'string' },
        'max-active-turns': { type: 'string' },
        'auto-approve': { type: 'boolean' },
      },
    });
    const [command, action, ...rest] = positionals;
    // A bare run (no command) fails before any engine import; the ptah-electron
    // ESM bundle gate relies on this fast entry guard.
    if (!command) throw new Error(WORKER_USAGE);
    const json = values.json === true;
    await import('@ptah-extension/platform-core');
    const resolvePaths = async (): Promise<WorkerPaths> =>
      paths ?? (await import('@ptah-extension/worker-runtime')).workerPaths();
    let result: unknown;
    switch (command) {
      case 'status':
        if (action) throw new Error('status takes no arguments');
        result = await (
          await import('./commands/admin-client')
        ).adminCall(await resolvePaths(), 'admin.status', {});
        break;
      case 'pair':
        if (action) throw new Error('pair takes no positional arguments');
        result = await (
          await import('./commands/pair')
        ).pairCommand(
          await resolvePaths(),
          numberOption(values.ttl, 'ttl', 60, 900) ?? 300,
          values.workspace,
        );
        break;
      case 'workspace':
        if (
          !action ||
          !['add', 'remove', 'list'].includes(action) ||
          rest.length > (action === 'list' ? 0 : 1)
        )
          throw new Error(
            'Usage: workspace add|remove <path> or workspace list',
          );
        result = await (
          await import('./commands/workspace')
        ).workspaceCommand(await resolvePaths(), action, rest[0]);
        break;
      case 'grants':
        if (!action || action === 'list') {
          if (rest.length) throw new Error('grants list takes no arguments');
          result = await (
            await import('./commands/grants')
          ).grantsCommand(await resolvePaths(), 'list');
        } else if (action === 'add') {
          result = await (
            await import('./commands/grants')
          ).grantsCommand(await resolvePaths(), 'add', rest[0], rest.slice(1));
        } else if (action === 'revoke') {
          if (rest.length !== 1)
            throw new Error('Usage: grants revoke <tokenId> [--json]');
          result = await (
            await import('./commands/grants')
          ).grantsCommand(await resolvePaths(), 'revoke', rest[0]);
        } else throw new Error('Unknown grants action');
        break;
      case 'locks':
        if (values['self-test'])
          result = await (
            await import('./commands/locks')
          ).locksCommand('self-test');
        else if (!action)
          result = await (
            await import('./commands/locks')
          ).locksCommand('list');
        else if (action === 'release' && rest.length === 1) {
          if (
            !values.yes &&
            (!io.isTty ||
              !(await io.confirm(`Release driver lock for ${rest[0]}?`)))
          )
            throw new Error(
              'Lock release requires confirmation; use --yes in non-TTY mode',
            );
          result = await (
            await import('./commands/locks')
          ).locksCommand('release', rest[0], true);
        } else
          throw new Error(
            'Usage: locks [--json|--self-test] or locks release <sessionId> [--yes]',
          );
        break;
      case 'serve':
        if (action) throw new Error('serve takes no positional arguments');
        await (
          await import('./commands/serve')
        ).serveCommand({
          paths: await resolvePaths(),
          port: numberOption(values.port, 'port', 0, 65535) ?? 41873,
          maxActiveTurns:
            numberOption(
              values['max-active-turns'],
              'max-active-turns',
              1,
              1024,
            ) ?? 4,
          argv: args,
          autoApprove: process.env['PTAH_AUTO_APPROVE'],
        });
        return 0;
      default:
        throw new Error(WORKER_USAGE);
    }
    io.stdout(
      json
        ? JSON.stringify(result)
        : typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2),
    );
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : 'Worker command failed');
    return 1;
  }
}
