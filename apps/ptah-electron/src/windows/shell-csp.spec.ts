import { spawn } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

// Exercise the same patcher used by copy-renderer, copy-renderer-dev and the watcher.
const { secureRendererHtml } = require('../../scripts/copy-renderer.js') as {
  secureRendererHtml: (html: string) => {
    html: string;
    scripts: Array<{ fileName: string; content: string }>;
  };
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
    metaCount: number;
    evalBlocked: boolean;
    inlineExecuted: boolean;
    violations: Array<{ directive: string; blockedURI: string }>;
    theme: string;
    microphone: boolean;
    microphoneError?: string;
    camera: boolean;
    cameraError?: string;
    clipboardWriteState: string;
    microphoneState: string;
    cameraState: string;
  };

  beforeAll(async () => {
    directory = mkdtempSync(join(__dirname, '.shell-security-'));
    const html = source
      .replace('<head>', '<head><script src="./seed.js"></script>')
      .replace('</body>', '<script src="./probe.js"></script></body>');
    // Patch TWICE. The second pass must be a no-op: it is the packaging path
    // running against an already-patched document.
    const once = secureRendererHtml(html);
    const twice = secureRendererHtml(once.html);
    expect(twice.html).toBe(once.html);
    expect(twice.scripts).toEqual([]);
    writeFileSync(join(directory, 'index.html'), twice.html);
    for (const script of once.scripts) {
      writeFileSync(join(directory, script.fileName), script.content);
    }
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
      }, 40_000);
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
  }, 60_000);

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
    expect(directives).toEqual({
      'default-src': ["'none'"],
      // No hash and no nonce: every inline script is lifted to its own file.
      'script-src': ["'self'"],
      'style-src': [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
      ],
      // https: keeps remote marketplace icons and remote markdown images
      // loading. See copy-renderer.js and context.md, "Shell CSP".
      'img-src': ["'self'", 'https:', 'data:', 'blob:'],
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

  it('emits exactly one policy even after a second patch pass', () => {
    expect(result.metaCount).toBe(1);
  });

  it('blocks eval and an unhashed inline script while allowing the theme bootstrap', () => {
    expect(result.evalBlocked).toBe(true);
    expect(result.inlineExecuted).toBe(false);
    // Anchor the block on a real CSP violation, not on the script merely
    // failing to run for some other reason.
    expect(
      result.violations.some((entry) => entry.directive === 'script-src-elem'),
    ).toBe(true);
    expect(result.theme).toBe('anubis-light');
  });

  it('allows an https image and blocks an http one', () => {
    const blocked = result.violations.filter(
      (entry) => entry.directive === 'img-src',
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blockedURI).toContain('http://ptah-csp-probe.invalid');
  });

  it('preserves audio-only voice capture through the real Electron handlers', () => {
    expect({
      microphone: result.microphone,
      error: result.microphoneError,
    }).toEqual({ microphone: true, error: undefined });
  });

  it('denies camera capture through the real Electron handlers', () => {
    expect(result.camera).toBe(false);
  });

  it('reports the state a real permission query asks for', () => {
    expect({
      microphone: result.microphoneState,
      camera: result.cameraState,
      clipboardWrite: result.clipboardWriteState,
    }).toEqual({
      microphone: 'granted',
      camera: 'denied',
      clipboardWrite: 'granted',
    });
  });
});
