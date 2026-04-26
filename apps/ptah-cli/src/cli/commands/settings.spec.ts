/**
 * Unit tests for `ptah settings` command — TASK_2026_104 Sub-batch B5d.
 *
 * Coverage:
 *   - export with --out: writes JSON; emits settings.exported with byte count
 *   - export without --out: writes to stdout; emits settings.exported (path: null)
 *   - import with --in: reads file, dispatches importSettings, emits settings.imported
 *   - import without --in: reads stdin, parses JSON
 *   - empty / invalid JSON on import: UsageError
 *   - import errors: returns GeneralError on result.errors.length > 0
 *
 * Note: settings.ts dynamically imports SDK_TOKENS at runtime; the tests stub
 * the engine container so SDK_TOKENS lookups receive a service stub directly.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { Readable } from 'node:stream';

import { execute } from './settings.js';
import type { SettingsExecuteHooks, SettingsOptions } from './settings.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

// Stub the agent-sdk static import so ts-jest does not have to compile the
// entire SDK transitive graph (pre-existing Zod schema TS errors in
// libs/shared otherwise prevent the import from resolving in jest).
// jest.mock factories run before module-scope vars, so the tokens are inlined.
jest.mock(
  '@ptah-extension/agent-sdk',
  () => ({
    SDK_TOKENS: {
      SDK_SETTINGS_EXPORT: Symbol.for('SdkSettingsExport'),
      SDK_SETTINGS_IMPORT: Symbol.for('SdkSettingsImport'),
    },
    // `auth-rpc.schema.ts` (loaded transitively via the static
    // `CliDIContainer` import) reads `ANTHROPIC_PROVIDERS.map(p => p.id)`
    // at module load to build a Zod enum. Provide a stable stub so module
    // evaluation succeeds.
    ANTHROPIC_PROVIDERS: [
      { id: 'anthropic' },
      { id: 'openrouter' },
      { id: 'copilot' },
      { id: 'codex' },
    ],
  }),
  { virtual: true },
);

const SDK_SETTINGS_EXPORT_TOKEN = Symbol.for('SdkSettingsExport');
const SDK_SETTINGS_IMPORT_TOKEN = Symbol.for('SdkSettingsImport');

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

function makeStdout(): { stdout: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stdout: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface ServiceStubs {
  exportService: {
    collectSettings: jest.Mock;
  };
  importService: {
    importSettings: jest.Mock;
  };
}

function makeEngine(services: ServiceStubs): {
  withEngine: SettingsExecuteHooks['withEngine'];
} {
  const transport = {
    call: jest.fn(),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn((token: symbol) => {
      if (token === SDK_SETTINGS_EXPORT_TOKEN) return services.exportService;
      if (token === SDK_SETTINGS_IMPORT_TOKEN) return services.importService;
      throw new Error(
        `unexpected token resolution: ${String(token.description ?? token.toString())}`,
      );
    }),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as SettingsExecuteHooks['withEngine'];

  return { withEngine };
}

describe('ptah settings export', () => {
  it('writes JSON to --out and emits settings.exported', async () => {
    const formatterTrace = makeFormatter();
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: {
        collectSettings: jest.fn(async (source: string) => ({
          version: '1.0.0',
          source,
          providers: [],
        })),
      },
      importService: { importSettings: jest.fn() },
    };
    const { withEngine } = makeEngine(services);

    const tmpFile = pathJoin(tmpdir(), `b5d-export-${Date.now()}.json`);
    try {
      const exit = await execute(
        { subcommand: 'export', out: tmpFile } satisfies SettingsOptions,
        baseGlobals,
        {
          formatter: formatterTrace.formatter,
          stderr: stderrTrace.stderr,
          withEngine,
        },
      );

      expect(exit).toBe(ExitCode.Success);
      expect(services.exportService.collectSettings).toHaveBeenCalledWith(
        'cli',
      );
      const written = await fs.readFile(tmpFile, 'utf8');
      const parsed = JSON.parse(written);
      expect(parsed.version).toBe('1.0.0');
      expect(formatterTrace.notifications[0]?.method).toBe('settings.exported');
      expect(formatterTrace.notifications[0]?.params).toMatchObject({
        path: tmpFile,
        version: '1.0.0',
      });
    } finally {
      await fs.unlink(tmpFile).catch(() => undefined);
    }
  });

  it('writes JSON to stdout when --out is omitted (with chmod warning to stderr)', async () => {
    const formatterTrace = makeFormatter();
    const stderrTrace = makeStderr();
    const stdoutTrace = makeStdout();
    const services: ServiceStubs = {
      exportService: {
        collectSettings: jest.fn(async () => ({ version: '1.0.0' })),
      },
      importService: { importSettings: jest.fn() },
    };
    const { withEngine } = makeEngine(services);

    const exit = await execute(
      { subcommand: 'export' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: stderrTrace.stderr,
        stdout: stdoutTrace.stdout,
        withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(stdoutTrace.buffer).toContain('"version"');
    expect(stderrTrace.buffer).toMatch(/chmod 600/);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      path: null,
    });
  });
});

describe('ptah settings import', () => {
  it('reads --in file and dispatches importSettings', async () => {
    const formatterTrace = makeFormatter();
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: {
        importSettings: jest.fn(async () => ({
          imported: ['providers'],
          skipped: [],
          errors: [],
        })),
      },
    };
    const { withEngine } = makeEngine(services);

    const tmpFile = pathJoin(tmpdir(), `b5d-import-${Date.now()}.json`);
    await fs.writeFile(tmpFile, JSON.stringify({ version: '1.0.0' }));
    try {
      const exit = await execute(
        {
          subcommand: 'import',
          in: tmpFile,
          overwrite: true,
        } satisfies SettingsOptions,
        baseGlobals,
        {
          formatter: formatterTrace.formatter,
          stderr: stderrTrace.stderr,
          withEngine,
        },
      );

      expect(exit).toBe(ExitCode.Success);
      expect(services.importService.importSettings).toHaveBeenCalledWith(
        { version: '1.0.0' },
        { overwrite: true },
      );
      expect(formatterTrace.notifications[0]?.method).toBe('settings.imported');
    } finally {
      await fs.unlink(tmpFile).catch(() => undefined);
    }
  });

  it('reads stdin when --in is omitted', async () => {
    const formatterTrace = makeFormatter();
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: {
        importSettings: jest.fn(async () => ({
          imported: [],
          skipped: [],
          errors: [],
        })),
      },
    };
    const { withEngine } = makeEngine(services);

    const stdin = Readable.from([
      Buffer.from(JSON.stringify({ version: '1.0.0', from: 'stdin' })),
    ]);

    const exit = await execute(
      { subcommand: 'import' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: stderrTrace.stderr,
        stdin,
        withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    expect(services.importService.importSettings).toHaveBeenCalledWith(
      { version: '1.0.0', from: 'stdin' },
      { overwrite: false },
    );
  });

  it('exits 2 (UsageError) on empty input', async () => {
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: { importSettings: jest.fn() },
    };
    const { withEngine } = makeEngine(services);
    const stdin = Readable.from([Buffer.from('')]);

    const exit = await execute(
      { subcommand: 'import' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        stdin,
        withEngine,
      },
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/empty input/);
  });

  it('exits 2 (UsageError) on invalid JSON', async () => {
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: { importSettings: jest.fn() },
    };
    const { withEngine } = makeEngine(services);
    const stdin = Readable.from([Buffer.from('not json {')]);

    const exit = await execute(
      { subcommand: 'import' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        stdin,
        withEngine,
      },
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/invalid JSON/);
  });

  it('returns GeneralError when importSettings reports errors', async () => {
    const formatterTrace = makeFormatter();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: {
        importSettings: jest.fn(async () => ({
          imported: [],
          skipped: [],
          errors: ['provider conflict'],
        })),
      },
    };
    const { withEngine } = makeEngine(services);
    const stdin = Readable.from([Buffer.from(JSON.stringify({ a: 1 }))]);

    const exit = await execute(
      { subcommand: 'import' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: makeStderr().stderr,
        stdin,
        withEngine,
      },
    );

    expect(exit).toBe(ExitCode.GeneralError);
    const params = formatterTrace.notifications[0]?.params as {
      errors: string[];
    };
    expect(params.errors).toEqual(['provider conflict']);
  });
});

describe('ptah settings unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const stderrTrace = makeStderr();
    const services: ServiceStubs = {
      exportService: { collectSettings: jest.fn() },
      importService: { importSettings: jest.fn() },
    };
    const { withEngine } = makeEngine(services);

    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'export' } satisfies SettingsOptions,
      baseGlobals,
      {
        formatter: makeFormatter().formatter,
        stderr: stderrTrace.stderr,
        withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });
});
