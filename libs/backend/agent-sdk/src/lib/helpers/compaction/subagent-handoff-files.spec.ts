import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SubagentHandoffFiles } from './subagent-handoff-files';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('SubagentHandoffFiles', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-handoff-files-'));
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const dir = () => path.join(workspace, '.ptah', 'subagent-handoffs');

  it('derives both paths from the session workspace and the tool_use id', () => {
    const workspaceOf = jest.fn(() => workspace);
    const files = new SubagentHandoffFiles(
      makeLogger() as unknown as Logger,
      workspaceOf,
    );

    expect(files.paths('sess-1', 'toolu_01AbC')).toEqual({
      notes: path.join(dir(), 'toolu_01AbC.md'),
      task: path.join(dir(), 'toolu_01AbC.task.md'),
    });
    expect(workspaceOf).toHaveBeenCalledWith('sess-1');
  });

  it('keeps a hostile tool_use id inside the handoff directory', () => {
    const files = new SubagentHandoffFiles(
      makeLogger() as unknown as Logger,
      () => workspace,
    );

    const paths = files.paths('sess-1', '../../etc/passwd');

    expect(path.dirname(paths?.notes ?? '')).toBe(dir());
    expect(path.dirname(paths?.task ?? '')).toBe(dir());
    expect(files.paths('sess-1', '../..')).toBeUndefined();
  });

  it('has no paths without a workspace', () => {
    const files = new SubagentHandoffFiles(
      makeLogger() as unknown as Logger,
      () => undefined,
    );

    expect(files.paths('sess-1', 'toolu_1')).toBeUndefined();
  });

  it('saves the task prompt and reports whether the notes exist', async () => {
    const files = new SubagentHandoffFiles(
      makeLogger() as unknown as Logger,
      () => workspace,
    );
    const paths = files.paths('sess-1', 'toolu_1');
    if (!paths) throw new Error('expected paths');

    expect(await files.saveTask(paths, 'the full prompt')).toBe(true);
    expect(fs.readFileSync(paths.task, 'utf8')).toBe('the full prompt');
    expect(await files.notesExist(paths)).toBe(false);

    fs.writeFileSync(paths.notes, 'notes');
    expect(await files.notesExist(paths)).toBe(true);
  });

  it('reports a failed save as false with one warning, never throwing', async () => {
    const logger = makeLogger();
    // A file where the handoff directory should be makes mkdir fail.
    fs.mkdirSync(path.join(workspace, '.ptah'));
    fs.writeFileSync(dir(), 'not a directory');
    const files = new SubagentHandoffFiles(
      logger as unknown as Logger,
      () => workspace,
    );
    const paths = files.paths('sess-1', 'toolu_1');
    if (!paths) throw new Error('expected paths');

    expect(await files.saveTask(paths, 'prompt')).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(await files.notesExist(paths)).toBe(false);
  });
});
