/**
 * `ElectronFileDialog` — the whole adapter, including the two branches the
 * suite never reached: a cancelled dialog and a multi-select request carrying
 * filters. Both are ordinary user outcomes, not edge cases, and neither had a
 * test (TASK_2026_411: this file sat at 20 % line coverage).
 *
 * `electron` is mocked virtually because this lib declares it a peer and the
 * adapter reaches it through a dynamic `await import('electron')`.
 */

import 'reflect-metadata';

const showOpenDialog = jest.fn();

jest.mock(
  'electron',
  () => ({
    dialog: {
      showOpenDialog: (...args: unknown[]) =>
        showOpenDialog(...args) as unknown,
    },
  }),
  { virtual: true },
);

import { ElectronFileDialog } from './electron-file-dialog';

describe('ElectronFileDialog', () => {
  let provider: ElectronFileDialog;

  beforeEach(() => {
    showOpenDialog.mockReset();
    provider = new ElectronFileDialog();
  });

  it('returns the selected paths for a single-file request', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/one.ts'],
    });

    const result = await provider.openFiles({
      multiple: false,
      title: 'Pick a file',
    });

    expect(result).toEqual(['/tmp/one.ts']);
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      title: 'Pick a file',
    });
  });

  it('adds multiSelections and maps filters into Electron shape', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/a.ts', '/tmp/b.ts'],
    });

    const result = await provider.openFiles({
      multiple: true,
      title: 'Pick files',
      filters: { TypeScript: ['ts', 'tsx'], Images: ['png'] },
    });

    expect(result).toEqual(['/tmp/a.ts', '/tmp/b.ts']);
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      title: 'Pick files',
      filters: [
        { name: 'TypeScript', extensions: ['ts', 'tsx'] },
        { name: 'Images', extensions: ['png'] },
      ],
    });
  });

  it('returns an empty list when the user cancels', async () => {
    // Electron still reports `filePaths` on a cancel; returning it would hand
    // the caller paths the user explicitly declined.
    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: ['/tmp/stale.ts'],
    });

    await expect(
      provider.openFiles({ multiple: true, title: 'Pick files' }),
    ).resolves.toEqual([]);
  });
});
