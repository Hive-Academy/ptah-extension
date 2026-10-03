/**
 * The review shell's two push relays are `MESSAGE_HANDLERS` entries
 * (TASK_2026_576 Batch 58, cutover checklist).
 *
 * `FileContentChangesService` hands `file:content-changed` to the open spot
 * editor and `GitOperationOutputService` hands `git:operationOutput` to the
 * commit composer's hook log. Components cannot be handlers, so if either
 * registration is missing the shell silently never hears its push — every
 * git-ui unit spec stays green because they call `handleMessage` directly.
 *
 * Two halves, the same split as `webview-routing.spec.ts`:
 *   1. the registrations are pinned against the real `app.config.ts`, and
 *      imported from the services-only entry (never the main git-ui barrel,
 *      which would pull the components into the eager bundle);
 *   2. the same registrations, wired to the REAL `MessageRouterService`,
 *      deliver a raw `window` message to a listener.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  FileContentChangesService,
  GitOperationOutputService,
} from '@ptah-extension/git-ui/services';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

function makeVscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

function dispatch(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, payload } }),
  );
}

describe('app.config.ts registers the review shell push relays', () => {
  const source = readFileSync(join(__dirname, 'app.config.ts'), 'utf-8');

  it.each(['FileContentChangesService', 'GitOperationOutputService'])(
    'registers %s under MESSAGE_HANDLERS with useExisting',
    (name) => {
      expect(source).toMatch(
        new RegExp(
          `provide:\\s*MESSAGE_HANDLERS,\\s*useExisting:\\s*${name},\\s*multi:\\s*true`,
        ),
      );
    },
  );

  it("binds AGENT_FEEDBACK_SENDER at the root, where the shell's conflict banner and draft bar inject it", () => {
    expect(source).toMatch(
      /provide:\s*AGENT_FEEDBACK_SENDER,\s*useExisting:\s*ChatAgentFeedbackSender/,
    );
  });

  it('imports both from the services-only entry, never the main git-ui barrel', () => {
    const servicesImport =
      /import\s*\{([^}]*)\}\s*from\s*'@ptah-extension\/git-ui\/services'/.exec(
        source,
      );
    expect(servicesImport?.[1]).toContain('FileContentChangesService');
    expect(servicesImport?.[1]).toContain('GitOperationOutputService');
    expect(source).not.toMatch(/from\s*'@ptah-extension\/git-ui'/);
  });
});

describe('review shell push relays deliver through MessageRouterService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        MessageRouterService,
        // Mirrors app.config.ts.
        {
          provide: MESSAGE_HANDLERS,
          useExisting: FileContentChangesService,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: GitOperationOutputService,
          multi: true,
        },
      ],
    });
    // Constructing the router reads handledMessageTypes off every handler.
    TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('holds the root instances the shell and the composer inject', () => {
    const handlers = TestBed.inject(MESSAGE_HANDLERS);
    expect(handlers).toContain(TestBed.inject(FileContentChangesService));
    expect(handlers).toContain(TestBed.inject(GitOperationOutputService));
  });

  it('delivers a raw file:content-changed message to a listener', () => {
    const listener = jest.fn();
    const release = TestBed.inject(FileContentChangesService).listen(listener);

    dispatch(MESSAGE_TYPES.FILE_CONTENT_CHANGED, {
      filePaths: ['/ws/a/src/a.ts'],
      truncated: false,
    });

    expect(listener).toHaveBeenCalledWith({
      filePaths: ['/ws/a/src/a.ts'],
      truncated: false,
    });
    release();
  });

  it('delivers a raw git:operationOutput message to its operation listener', () => {
    const listener = jest.fn();
    const release = TestBed.inject(GitOperationOutputService).listen(
      'op-1',
      listener,
    );

    dispatch(MESSAGE_TYPES.GIT_OPERATION_OUTPUT, {
      operationId: 'op-1',
      stream: 'stderr',
      chunk: 'lint passed\n',
    });

    expect(listener).toHaveBeenCalledWith({
      operationId: 'op-1',
      stream: 'stderr',
      chunk: 'lint passed\n',
    });
    release();
  });
});
