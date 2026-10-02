// CommonJS — registered into the shared minimal runner by index.cjs.
//
// TASK_2026_576 Requirement 5: the change-set card hands the changed files to
// VS Code's own views through the `ptah.review.*` commands. This suite drives
// those commands against the real extension host, in a git repository created
// inside the runner's temp workspace folder.
//
// Packaging cannot run inside the extension host, so the VSIX-asset check
// inspects the built extension directory — the exact tree `vsce package`
// packs (see the `package` target of ptah-extension-vscode).

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const HEAD_SCHEME = 'ptah-git-head';
const OUTSIDE_MESSAGE = 'Path is outside the workspace.';
const TAB_TIMEOUT_MS = 15_000;

const FILE_A = 'review-a.txt';
const FILE_B = 'review-b.txt';
const HEAD_A = 'alpha at HEAD\n';
const HEAD_B = 'bravo at HEAD\n';

function git(cwd, args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Ptah E2E',
      '-c',
      'user.email=e2e@ptah.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/**
 * Turns the runner's temp workspace folder into a repository with two files
 * committed at HEAD and then modified in the working tree.
 */
function prepareRepository(workspaceRoot) {
  if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
    git(workspaceRoot, ['init', '-q']);
  }
  fs.writeFileSync(path.join(workspaceRoot, FILE_A), HEAD_A);
  fs.writeFileSync(path.join(workspaceRoot, FILE_B), HEAD_B);
  git(workspaceRoot, ['add', '-A']);
  git(workspaceRoot, ['commit', '-q', '-m', 'ptah e2e baseline']);
  fs.writeFileSync(path.join(workspaceRoot, FILE_A), 'alpha changed\n');
  fs.writeFileSync(path.join(workspaceRoot, FILE_B), 'bravo changed\n');
}

function allTabs() {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs);
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + TAB_TIMEOUT_MS;
  for (;;) {
    const found = predicate();
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${description}. Open tabs: ${JSON.stringify(
          allTabs().map((t) => t.label),
        )}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function closeAllEditors() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
}

/** Files under `dir` (relative, forward slashes), skipping node_modules. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * @param {(name: string, fn: () => Promise<void>) => void} test
 * @param {{ waitForActivation: () => Promise<vscode.Extension<unknown>> }} helpers
 */
function register(test, { waitForActivation }) {
  let workspaceRoot;

  async function setup() {
    const ext = await waitForActivation();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the runner must open a workspace folder');
    if (workspaceRoot === undefined) {
      workspaceRoot = folder.uri.fsPath;
      prepareRepository(workspaceRoot);
    }
    await closeAllEditors();
    return ext;
  }

  test('review: ptah.review.* commands are registered', async () => {
    await setup();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'ptah.review.openChanges',
      'ptah.review.openDiff',
      'ptah.review.openMerge',
      'ptah.review.openScm',
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  test('review: openChanges with two files opens one multi-diff editor', async () => {
    await setup();
    await vscode.commands.executeCommand('ptah.review.openChanges', {
      workspaceRoot,
      files: [
        { path: FILE_A, status: 'M' },
        { path: FILE_B, status: 'M' },
      ],
    });
    const tab = await waitFor(
      () =>
        allTabs().find((t) => t.label.startsWith('Agent changes (2 files)')),
      'the "Agent changes (2 files)" multi-diff tab',
    );
    // `TabInputTextMultiDiff` exists on recent VS Code; the title above is the
    // fallback identity when the class is not exposed.
    if (typeof vscode.TabInputTextMultiDiff === 'function') {
      assert.ok(
        tab.input instanceof vscode.TabInputTextMultiDiff,
        'the changes tab is not a multi-diff editor',
      );
      assert.equal(tab.input.textDiffs.length, 2, 'expected two diff rows');
      for (const diff of tab.input.textDiffs) {
        assert.equal(diff.original.scheme, HEAD_SCHEME);
      }
    }
  });

  test('review: openDiff opens a diff with a ptah-git-head: left side holding HEAD content', async () => {
    await setup();
    await vscode.commands.executeCommand('ptah.review.openDiff', {
      workspaceRoot,
      path: FILE_A,
      status: 'M',
    });
    const tab = await waitFor(
      () =>
        allTabs().find(
          (t) =>
            t.input instanceof vscode.TabInputTextDiff &&
            t.input.original.scheme === HEAD_SCHEME,
        ),
      'a text diff tab whose left side is ptah-git-head:',
    );
    const { original, modified } = tab.input;
    assert.equal(modified.scheme, 'file');
    assert.equal(path.basename(modified.fsPath), FILE_A);
    const head = await vscode.workspace.openTextDocument(original);
    assert.equal(head.getText(), HEAD_A, 'left side must hold the HEAD text');
    assert.equal(
      fs.readFileSync(modified.fsPath, 'utf8'),
      'alpha changed\n',
      'right side is the working tree',
    );
  });

  test('review: a path outside the workspace is refused', async () => {
    await setup();
    const outsideAbsolute = path.join(
      path.dirname(workspaceRoot),
      'outside.txt',
    );
    for (const bad of ['../outside.txt', outsideAbsolute]) {
      const err = await rejection(
        vscode.commands.executeCommand('ptah.review.openDiff', {
          workspaceRoot,
          path: bad,
          status: 'M',
        }),
      );
      assert.ok(err instanceof Error, `openDiff accepted ${bad}`);
      assert.equal(err.message, OUTSIDE_MESSAGE);
      assert.ok(
        !err.message.includes(workspaceRoot),
        'the refusal must not leak an absolute path',
      );
    }
    const changesErr = await rejection(
      vscode.commands.executeCommand('ptah.review.openChanges', {
        workspaceRoot,
        files: [{ path: '../outside.txt', status: 'M' }],
      }),
    );
    assert.equal(changesErr?.message, OUTSIDE_MESSAGE);
    const rootErr = await rejection(
      vscode.commands.executeCommand('ptah.review.openDiff', {
        workspaceRoot: path.dirname(workspaceRoot),
        path: FILE_A,
      }),
    );
    assert.equal(rootErr?.message, OUTSIDE_MESSAGE);
    assert.equal(
      allTabs().filter((t) => t.input instanceof vscode.TabInputTextDiff)
        .length,
      0,
      'a refused path must not open an editor',
    );
  });

  test('review: openMerge falls back to opening the file when the git merge editor is unavailable', async () => {
    await setup();
    const target = path.join(workspaceRoot, FILE_A);
    // The built-in vscode.git extension is active in the test host. For a file
    // with no conflict it either opens its merge editor or rejects, and then
    // the command must fall back to the plain editor. Both outcomes leave the
    // target open and the command resolved. (The git extension logs its own
    // rejection; that is not ours.)
    await vscode.commands.executeCommand('ptah.review.openMerge', {
      workspaceRoot,
      path: FILE_A,
    });
    const tab = await waitFor(
      () =>
        allTabs().find(
          (t) =>
            (t.input instanceof vscode.TabInputText &&
              path.normalize(t.input.uri.fsPath) === path.normalize(target)) ||
            t.label.startsWith('Merging:'),
        ),
      'the merge editor or the fallback plain editor for the merge target',
    );
    assert.ok(tab, 'neither the merge editor nor the fallback opened');
  });

  test('review: openScm runs without error', async () => {
    await setup();
    await vscode.commands.executeCommand('ptah.review.openScm');
  });

  // The packaged VSIX is the built extension directory. This guards Req 5.8:
  // the review commands add no editor-only assets (Monaco, CodeMirror, the
  // spot-editor / review-canvas chunks) to what ships in the VSIX.
  test('review: the packaged extension tree has no editor-only assets', async () => {
    const ext = await waitForActivation();
    const files = listFiles(ext.extensionPath);
    assert.ok(files.length > 0, 'extension directory is empty');
    const offenders = files.filter((f) =>
      /codemirror|monaco|spot-editor|review-canvas|review-shell/i.test(f),
    );
    assert.deepEqual(
      offenders,
      [],
      `editor-only assets must not ship in the VSIX:\n  ${offenders.join('\n  ')}`,
    );
  });
}

module.exports = { register };
