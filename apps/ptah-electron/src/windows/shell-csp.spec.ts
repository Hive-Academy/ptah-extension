import { spawn } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';

// Exercise the same patcher used by copy-renderer, copy-renderer-dev and the watcher.
const { secureRendererHtml } = require('../../scripts/copy-renderer.js') as {
  secureRendererHtml: (html: string) => string;
};
const root = resolve(__dirname, '../../../..');
const source = readFileSync(
  join(root, 'apps/ptah-extension-webview/src/index.html'),
  'utf8',
);

describe('effective Electron shell CSP', () => {
  let directory: string;
  let result: {
    policy: string;
    evalBlocked: boolean;
    inlineBlocked: boolean;
    theme: string;
    microphone: boolean;
    microphoneError?: string;
  };

  beforeAll(async () => {
    directory = mkdtempSync(join(__dirname, '.shell-security-'));
    const html = source
      .replace('<head>', '<head><script src="./seed.js"></script>')
      .replace('</body>', '<script src="./probe.js"></script></body>');
    writeFileSync(join(directory, 'index.html'), secureRendererHtml(html));
    writeFileSync(
      join(directory, 'seed.js'),
      "window.vscode = { getState: () => ({ theme: 'anubis-light' }) };",
    );
    copyFileSync(
      join(__dirname, 'fixtures/shell-probe.js'),
      join(directory, 'probe.js'),
    );
    buildSync({
      entryPoints: [join(__dirname, 'permission-policy.ts')],
      outfile: join(directory, 'permission-policy.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
    });
    const electronDir = join(root, 'node_modules/electron');
    const executable = join(
      electronDir,
      'dist',
      readFileSync(join(electronDir, 'path.txt'), 'utf8').trim(),
    );
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    // Match electron-e2e.yml: a hidden Electron window still needs X on Linux.
    // Never skip this security test when no display is attached.
    const headlessLinux = process.platform === 'linux' && !env['DISPLAY'];
    const args = [join(__dirname, 'fixtures/shell-security.cjs'), directory];
    if (env['CI']) args.push('--no-sandbox', '--disable-dev-shm-usage');
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(
        headlessLinux ? 'xvfb-run' : executable,
        headlessLinux ? ['--auto-servernum', executable, ...args] : args,
        {
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Electron security probe timed out: ${stderr}`));
      }, 30_000);
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(new Error(`Electron exited ${code}: ${stderr}\n${stdout}`));
        else resolveOutput(stdout);
      });
    });
    const line = output
      .split(/\r?\n/)
      .find((value) => value.startsWith('SHELL_SECURITY_RESULT:'));
    if (!line) throw new Error(`No Electron security result: ${output}`);
    result = JSON.parse(line.slice('SHELL_SECURITY_RESULT:'.length));
  }, 40_000);

  afterAll(() => {
    if (!directory) return;
    if (
      dirname(directory) !== __dirname ||
      !basename(directory).startsWith('.shell-security-')
    ) {
      throw new Error(
        'Refusing to remove a directory outside this security fixture',
      );
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('pins every directive in the policy read from the loaded file document', () => {
    const directives = Object.fromEntries(
      result.policy.split(';').map((entry) => {
        const [name, ...values] = entry.trim().split(/\s+/);
        return [name, values];
      }),
    );
    const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1];
    if (script === undefined) throw new Error('Shell theme bootstrap is missing');
    const hash = createHash('sha256')
      .update(script.replace(/\r\n?/g, '\n'))
      .digest('base64');
    expect(directives).toEqual({
      'default-src': ["'none'"],
      'script-src': ["'self'", `'sha256-${hash}'`],
      'style-src': [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
      ],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'connect-src': ["'self'"],
      'media-src': ["'self'", 'blob:'],
      'worker-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-src': ["'none'"],
      'form-action': ["'none'"],
    });
  });

  it('blocks eval and an unhashed inline script while allowing the theme bootstrap', () => {
    expect(result.evalBlocked).toBe(true);
    expect(result.inlineBlocked).toBe(true);
    expect(result.theme).toBe('anubis-light');
  });

  it('preserves audio-only voice capture through the real Electron handlers', () => {
    expect({
      microphone: result.microphone,
      error: result.microphoneError,
    }).toEqual({ microphone: true, error: undefined });
  });
});
