import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  HANDOFF_FILES_TIMEOUT_MS,
  withinHandoffTimeout,
  SubagentHandoffFiles,
  prepareHandoffFiles,
} from './subagent-handoff-files';

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

describe('prepareHandoffFiles', () => {
  const paths = { notes: '/ws/n.md', task: '/ws/n.task.md' };
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports the outcome of both file operations when they settle in time', async () => {
    const files = {
      saveTask: jest.fn(async () => true),
      notesExist: jest.fn(async () => false),
    };

    await expect(
      prepareHandoffFiles(files, paths, 'the prompt'),
    ).resolves.toEqual({ paths, taskSaved: true, notesWritten: false });
    expect(files.saveTask).toHaveBeenCalledWith(paths, 'the prompt');
  });

  it('without paths touches no file', async () => {
    const files = { saveTask: jest.fn(), notesExist: jest.fn() };

    await expect(prepareHandoffFiles(files, undefined, 'p')).resolves.toEqual({
      taskSaved: false,
      notesWritten: false,
    });
    expect(files.saveTask).not.toHaveBeenCalled();
    expect(files.notesExist).not.toHaveBeenCalled();
  });

  it('reports the files unavailable once the bound expires; a late result changes nothing', async () => {
    jest.useFakeTimers();
    let finish: (value: boolean) => void = () => undefined;
    const files = {
      saveTask: jest.fn(
        () => new Promise<boolean>((resolve) => (finish = resolve)),
      ),
      notesExist: jest.fn(async () => true),
    };
    const settled = jest.fn();

    const result = prepareHandoffFiles(files, paths, 'p').then((state) => {
      settled(state);
      return state;
    });
    await jest.advanceTimersByTimeAsync(HANDOFF_FILES_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({
      paths,
      taskSaved: false,
      notesWritten: false,
      unavailable: true,
    });
    finish(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('a rejected file operation reads as unavailable, never a rejection', async () => {
    const files = {
      saveTask: jest.fn(async () => true),
      notesExist: jest.fn(async (): Promise<boolean> => {
        throw new Error('EIO');
      }),
    };

    await expect(prepareHandoffFiles(files, paths, 'p')).resolves.toMatchObject(
      { unavailable: true },
    );
  });
});

describe('withinHandoffTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves the value of an operation that settles in time and clears its timer', async () => {
    const onLate = jest.fn();
    await expect(
      withinHandoffTimeout(Promise.resolve(7), onLate),
    ).resolves.toEqual({ value: 7 });
    expect(jest.getTimerCount()).toBe(0);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('times out at the bound; a late value goes to onLate', async () => {
    let finish: (value: string) => void = () => undefined;
    const onLate = jest.fn();
    const result = withinHandoffTimeout(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
      onLate,
    );
    await jest.advanceTimersByTimeAsync(HANDOFF_FILES_TIMEOUT_MS);
    await expect(result).resolves.toBeUndefined();

    finish('late');
    await jest.advanceTimersByTimeAsync(0);
    expect(onLate).toHaveBeenCalledWith('late');
  });

  it('a rejected operation resolves undefined, never a rejection', async () => {
    await expect(
      withinHandoffTimeout(Promise.reject(new Error('io'))),
    ).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
