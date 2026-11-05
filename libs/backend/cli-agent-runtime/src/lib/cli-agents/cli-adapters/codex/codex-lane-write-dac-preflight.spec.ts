import { Logger } from '@ptah-extension/vscode-core';
import { CODEX_WRITE_DAC_DENIAL_CACHE_MS, CODEX_WRITE_DAC_TIMEOUT_MS, CodexLaneWriteDacDeniedError, CodexLaneWriteDacPreflight, type WriteDacProbeRunner } from './codex-lane-write-dac-preflight';

function setup(result: string | Error, platform: NodeJS.Platform = 'win32') {
  const logger = Object.create(Logger.prototype) as Logger;
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'info').mockImplementation(() => undefined);
  const runner: WriteDacProbeRunner = { run: jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }) };
  const clock = { now: 1_000 };
  const check = new CodexLaneWriteDacPreflight(logger, runner, platform, () => clock.now);
  return { check, runner, logger, clock };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('CodexLaneWriteDacPreflight', () => {
  afterEach(() => { delete process.env['PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT']; });

  it('caches an allow using a case-insensitive Windows key', async () => {
    const h = setup('0');
    await h.check.check('C:\\Foo', 'workspace-write');
    await h.check.check('c:\\foo', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(1);
  });

  it('caches a denial briefly, then re-probes and allows a repaired path', async () => {
    const h = setup('5');
    await expect(h.check.check('C:\\deny', 'workspace-write')).rejects.toThrow(CodexLaneWriteDacDeniedError);
    await settle();
    h.clock.now += CODEX_WRITE_DAC_DENIAL_CACHE_MS - 1;
    await expect(h.check.check('C:\\deny', 'workspace-write')).rejects.toThrow('PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT=1');
    expect(h.runner.run).toHaveBeenCalledTimes(1);
    h.clock.now += 1;
    jest.mocked(h.runner.run).mockResolvedValue('0');
    await h.check.check('C:\\deny', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(2);
    await settle();
    h.clock.now += CODEX_WRITE_DAC_DENIAL_CACHE_MS * 10;
    await h.check.check('C:\\deny', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(2);
  });

  it('prewarms the cache without throwing on a denial', async () => {
    const allow = setup('0');
    allow.check.prewarm('C:\\warm');
    await settle();
    await allow.check.check('c:\\WARM', 'workspace-write');
    expect(allow.runner.run).toHaveBeenCalledTimes(1);
    const deny = setup('5');
    deny.check.prewarm('C:\\cold');
    await settle();
    await expect(deny.check.check('C:\\cold', 'workspace-write')).rejects.toThrow(CodexLaneWriteDacDeniedError);
    expect(deny.runner.run).toHaveBeenCalledTimes(1);
  });

  it('does not prewarm off Windows or with the opt-out', async () => {
    const posix = setup('0', 'linux');
    posix.check.prewarm('/work');
    process.env['PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT'] = '1';
    const win = setup('0');
    win.check.prewarm('C:\\work');
    await settle();
    expect(posix.runner.run).not.toHaveBeenCalled();
    expect(win.runner.run).not.toHaveBeenCalled();
  });

  it.each([['32', 'unexpected-code'], ['garbage', 'unparseable-output']])('does not cache inconclusive output %s', async (result, outcome) => {
    const h = setup(result);
    await h.check.check('C:\\inconclusive', 'workspace-write');
    await h.check.check('C:\\inconclusive', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(2);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ outcome, elapsedMs: expect.any(Number) }));
  });

  it.each([
    [Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), 'timeout'],
    [Object.assign(new Error('missing'), { code: 'ENOENT', killed: false }), 'spawn-failed'],
  ])('continues and retries after helper failure %s', async (error, outcome) => {
    const h = setup(error);
    await h.check.check('C:\\helper', 'workspace-write');
    await h.check.check('C:\\helper', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(2);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ outcome }));
  });

  it('skips non-Windows and other sandbox modes', async () => {
    const posix = setup('5', 'linux');
    const win = setup('5');
    await posix.check.check('/work', 'workspace-write');
    await win.check.check('C:\\work', 'read-only');
    await win.check.check('C:\\work', 'danger-full-access');
    expect(posix.runner.run).not.toHaveBeenCalled();
    expect(win.runner.run).not.toHaveBeenCalled();
  });

  it('honors the environment opt-out', async () => {
    process.env['PTAH_CODEX_SKIP_WRITE_DAC_PREFLIGHT'] = '1';
    const h = setup('5');
    await h.check.check('C:\\work', 'workspace-write');
    expect(h.runner.run).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight probe for simultaneous checks', async () => {
    const h = setup('0');
    let release: ((value: string) => void) | undefined;
    jest.mocked(h.runner.run).mockImplementation(() => new Promise<string>((resolve) => { release = resolve; }));
    const first = h.check.check('C:\\parallel', 'workspace-write');
    const second = h.check.check('C:\\parallel', 'workspace-write');
    expect(h.runner.run).toHaveBeenCalledTimes(1);
    release?.('0');
    await Promise.all([first, second]);
  });

  it('encodes paths with spaces, quotes and Unicode as data', async () => {
    const h = setup('0');
    await h.check.check('C:\\work space\\O\'Brien-\u0645\u0635\u0631', 'workspace-write');
    const encoded = jest.mocked(h.runner.run).mock.calls[0][0];
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).not.toContain("O'Brien");
    const payload = script.match(/FromBase64String\('([^']+)'\)/)?.[1];
    expect(Buffer.from(payload ?? '', 'base64').toString('utf16le')).toContain("O'Brien-\u0645\u0635\u0631");
  });

  it('checks the current owner before compiling the CreateFileW probe', async () => {
    const h = setup('0');
    await h.check.check('C:\\owned', 'workspace-write');
    const encoded = jest.mocked(h.runner.run).mock.calls[0][0];
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).toContain('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
    expect(script).toContain('GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner)');
    expect(script).toContain('if ($owner -eq $me) { [Console]::Out.WriteLine(0); exit 0 }');
    expect(script.indexOf('if ($owner -eq $me)')).toBeLessThan(script.indexOf('Add-Type'));
    expect(script).toContain('CreateFileW(path, 0x00040000, 7, IntPtr.Zero, 3, 0x02000000');
  });

  it('allows thirty seconds for the slow helper path', () => {
    expect(CODEX_WRITE_DAC_TIMEOUT_MS).toBe(30_000);
  });
});
