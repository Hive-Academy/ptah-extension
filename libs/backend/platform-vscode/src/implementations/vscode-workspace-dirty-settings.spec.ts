/**
 * `VscodeWorkspaceProvider.setConfiguration` — the dirty-settings retry.
 *
 * ## Why this path needs its own spec
 *
 * VS Code refuses `config.update()` while the user has unsaved edits in
 * `settings.json`. The thrown error is not reliably identifiable, so the
 * provider treats a dirty user-settings document as corroborating evidence,
 * saves exactly that one document, waits for the write to settle, and retries.
 *
 * Three things can go wrong here and each is silent in production:
 *
 *  1. The provider swallows an unrelated failure and reports success, so a
 *     genuinely rejected write looks like it landed.
 *  2. The provider saves *everything*, committing unrelated editor buffers on
 *     the user's behalf.
 *  3. The retry never happens, so the user's write is lost with no error.
 *
 * The spec drives the real provider against the stateful `vscode` double, with
 * the double rigged to fail the first `update` call the way VS Code does.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

// Redirect HOME before the impl is imported — PtahFileSettingsManager reads
// homedir() at construction time.
const TEST_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ptah-vscode-dirty-settings-spec-'),
);
const prevHome = process.env['HOME'];
const prevUserProfile = process.env['USERPROFILE'];
process.env['HOME'] = TEST_HOME;
process.env['USERPROFILE'] = TEST_HOME;

afterAll(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevUserProfile;
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

import { VscodeWorkspaceProvider } from './vscode-workspace-provider';

const USER_SETTINGS = '/User/settings.json';

describe('VscodeWorkspaceProvider.setConfiguration — dirty settings retry', () => {
  let provider: VscodeWorkspaceProvider;

  beforeEach(() => {
    __resetVscodeTestDouble();
    const dir = path.join(TEST_HOME, '.ptah');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    provider = new VscodeWorkspaceProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  it('saves the dirty user-settings document and retries the write', async () => {
    const [settingsDoc] = __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'vscode-userdata', isDirty: true },
    ]);
    __vscodeState.queueConfigUpdateFailure(
      new Error('Unable to write into user settings: it has unsaved changes'),
    );

    await provider.setConfiguration('ptah', 'regularSetting', 'retried');

    expect(settingsDoc.save).toHaveBeenCalledTimes(1);
    // The retry is what makes the value land — without it the store is empty.
    expect(__vscodeState.config.get('ptah.regularSetting')).toBe('retried');
  });

  it('leaves unrelated dirty editors alone', async () => {
    const [settingsDoc, sourceDoc] = __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'vscode-userdata', isDirty: true },
      { path: '/repo/src/main.ts', scheme: 'file', isDirty: true },
    ]);
    __vscodeState.queueConfigUpdateFailure(new Error('unsaved changes'));

    await provider.setConfiguration('ptah', 'regularSetting', 'value');

    expect(settingsDoc.save).toHaveBeenCalledTimes(1);
    expect(sourceDoc.save).not.toHaveBeenCalled();
    expect(sourceDoc.isDirty).toBe(true);
  });

  it('recognises the dirty document by scheme+name even when the error is opaque', async () => {
    // No 'unsaved changes' text — the dirty vscode-userdata document is the
    // only evidence, and it must be enough.
    const [settingsDoc] = __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'vscode-userdata', isDirty: true },
    ]);
    __vscodeState.queueConfigUpdateFailure(new Error('EPERM'));

    await provider.setConfiguration('ptah', 'opaque', 1);

    expect(settingsDoc.save).toHaveBeenCalledTimes(1);
    expect(__vscodeState.config.get('ptah.opaque')).toBe(1);
  });

  it('rethrows when nothing corroborates a dirty settings document', async () => {
    // A clean settings doc and a dirty unrelated one: neither is evidence.
    __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'vscode-userdata', isDirty: false },
      { path: '/repo/src/main.ts', scheme: 'file', isDirty: true },
    ]);
    const failure = new Error('Setting is not registered');
    __vscodeState.queueConfigUpdateFailure(failure);

    await expect(
      provider.setConfiguration('ptah', 'unregistered', 'x'),
    ).rejects.toThrow('Setting is not registered');
    expect(__vscodeState.config.has('ptah.unregistered')).toBe(false);
  });

  it('rethrows a non-Error rejection unchanged rather than reporting success', async () => {
    // `String(error)` is the only narrowing available for a thrown string.
    __vscodeState.queueConfigUpdateFailure(
      'plain string failure' as unknown as Error,
    );

    await expect(provider.setConfiguration('ptah', 'weird', 'x')).rejects.toBe(
      'plain string failure',
    );
  });

  it('treats a thrown string mentioning unsaved changes as the dirty case', async () => {
    const [settingsDoc] = __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'file', isDirty: true },
    ]);
    __vscodeState.queueConfigUpdateFailure(
      'settings.json has unsaved changes' as unknown as Error,
    );

    await provider.setConfiguration('ptah', 'stringy', 'ok');

    // The `file` scheme is not evidence on its own, but the message is — and
    // the save fallback still finds the document because `find` accepts both
    // schemes.
    expect(settingsDoc.save).toHaveBeenCalledTimes(1);
    expect(__vscodeState.config.get('ptah.stringy')).toBe('ok');
  });

  it('falls back to the active editor when no matching document is listed', async () => {
    // Evidence comes from the message; `textDocuments` is empty, so the only
    // way to unblock the retry is the active editor.
    const activeDoc = __vscodeState.setActiveEditorDocument({
      path: '/User/settings.json',
      scheme: 'vscode-userdata',
      isDirty: true,
    });
    __vscodeState.queueConfigUpdateFailure(new Error('unsaved changes'));

    await provider.setConfiguration('ptah', 'fromActiveEditor', true);

    expect(activeDoc?.save).toHaveBeenCalledTimes(1);
    expect(__vscodeState.config.get('ptah.fromActiveEditor')).toBe(true);
  });

  it('does not save an active editor that is clean or is not settings.json', async () => {
    const activeDoc = __vscodeState.setActiveEditorDocument({
      path: '/repo/src/main.ts',
      scheme: 'file',
      isDirty: true,
    });
    __vscodeState.queueConfigUpdateFailure(new Error('unsaved changes'));

    await provider.setConfiguration('ptah', 'noSave', 'v');

    expect(activeDoc?.save).not.toHaveBeenCalled();
    // The retry still runs — the provider does not make the write conditional
    // on having found something to save.
    expect(__vscodeState.config.get('ptah.noSave')).toBe('v');
  });

  it('propagates a retry that fails again instead of looping', async () => {
    __vscodeState.setTextDocuments([
      { path: USER_SETTINGS, scheme: 'vscode-userdata', isDirty: true },
    ]);
    __vscodeState.queueConfigUpdateFailure(new Error('unsaved changes'));
    __vscodeState.queueConfigUpdateFailure(new Error('still refused'));

    await expect(
      provider.setConfiguration('ptah', 'twice', 'v'),
    ).rejects.toThrow('still refused');
  });

  it('never reaches the retry path for file-based keys', async () => {
    // File-based keys bypass vscode config entirely, so a queued failure must
    // stay queued.
    __vscodeState.queueConfigUpdateFailure(new Error('should not be thrown'));

    await provider.setConfiguration('ptah', 'authMethod', 'oauth');

    expect(provider.getConfiguration('ptah', 'authMethod')).toBe('oauth');
    expect(__vscodeState.config.has('ptah.authMethod')).toBe(false);
  });
});

describe('VscodeWorkspaceProvider — synthetic config event for file-based writes', () => {
  let provider: VscodeWorkspaceProvider;

  beforeEach(() => {
    __resetVscodeTestDouble();
    const dir = path.join(TEST_HOME, '.ptah');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    provider = new VscodeWorkspaceProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  it('matches the exact key, its parent section, and a deeper probe', async () => {
    const probes: Record<string, boolean> = {};
    const sub = provider.onDidChangeConfiguration((e) => {
      probes['exact'] = e.affectsConfiguration('ptah.authMethod');
      probes['parent'] = e.affectsConfiguration('ptah');
      probes['deeper'] = e.affectsConfiguration('ptah.authMethod.nested');
      probes['sibling'] = e.affectsConfiguration('ptah.somethingElse');
      probes['other'] = e.affectsConfiguration('editor');
    });

    await provider.setConfiguration('ptah', 'authMethod', 'apiKey');
    sub.dispose();

    expect(probes).toEqual({
      exact: true,
      parent: true,
      deeper: true,
      sibling: false,
      other: false,
    });
  });

  it('forwards VS Code’s own configuration events through the port', () => {
    const seen: boolean[] = [];
    const sub = provider.onDidChangeConfiguration((e) => {
      seen.push(e.affectsConfiguration('ptah'));
    });

    __vscodeState.configEmitter.fire({
      affectsConfiguration: (section: string) => section === 'ptah',
    });
    sub.dispose();

    expect(seen).toEqual([true]);
  });
});
