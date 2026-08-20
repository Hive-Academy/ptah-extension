import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';

import { MemoryRpcService } from '../services/memory-rpc.service';

import {
  CORPUS_CHAT_NAVIGATOR,
  CorpusListComponent,
} from './corpus-list.component';

const VALID_SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('CorpusListComponent', () => {
  let rpcMock: {
    listCorpora: jest.Mock;
    suggestCorpora: jest.Mock;
    buildCorpus: jest.Mock;
    primeCorpus: jest.Mock;
    queryCorpus: jest.Mock;
    reprimeCorpus: jest.Mock;
    rebuildCorpus: jest.Mock;
    deleteCorpus: jest.Mock;
  };
  let navigatorMock: { switchSession: jest.Mock };
  let postMessageMock: jest.Mock;

  beforeEach(async () => {
    rpcMock = {
      listCorpora: jest.fn().mockResolvedValue({ corpora: [] }),
      suggestCorpora: jest.fn().mockResolvedValue({ suggestions: [] }),
      buildCorpus: jest.fn(),
      primeCorpus: jest.fn(),
      queryCorpus: jest.fn(),
      reprimeCorpus: jest.fn(),
      rebuildCorpus: jest.fn(),
      deleteCorpus: jest.fn(),
    };
    navigatorMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    };
    postMessageMock = jest.fn();

    await TestBed.configureTestingModule({
      imports: [CorpusListComponent],
      providers: [
        { provide: MemoryRpcService, useValue: rpcMock },
        { provide: CORPUS_CHAT_NAVIGATOR, useValue: navigatorMock },
        { provide: VSCodeService, useValue: { postMessage: postMessageMock } },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
      ],
    }).compileComponents();
  });

  it('loads corpora on init and renders the empty state when none', async () => {
    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(rpcMock.listCorpora).toHaveBeenCalledWith('/ws');
    // ngOnInit must fetch suggestions exactly once — `refresh()` tail-calls
    // `loadSuggestions()`, so ngOnInit must NOT call it a second time directly.
    expect(rpcMock.suggestCorpora).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
    });
    expect(rpcMock.suggestCorpora).toHaveBeenCalledTimes(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No corpora yet');
  });

  it('renders corpus rows and triggers prime + switchSession on click', async () => {
    rpcMock.listCorpora.mockResolvedValue({
      corpora: [
        {
          id: 'c-1',
          name: 'auth',
          count: 12,
          builtAt: 1700000000000,
          rebuiltAt: null,
          workspaceRoot: '/ws',
        },
      ],
    });
    rpcMock.primeCorpus.mockResolvedValue({ sessionId: VALID_SESSION_ID });

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('auth');
    expect(text).toContain('12 memories');

    const primeBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(
      (b) => (b.textContent ?? '').trim() === 'Prime in new chat',
    ) as HTMLButtonElement;
    primeBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(rpcMock.primeCorpus).toHaveBeenCalledWith('auth');
    expect(navigatorMock.switchSession).toHaveBeenCalledWith(VALID_SESSION_ID);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('falls back to postMessage(CHAT_SWITCH_SESSION) when no navigator is provided', async () => {
    TestBed.resetTestingModule();
    rpcMock.listCorpora.mockResolvedValue({
      corpora: [
        {
          id: 'c-2',
          name: 'auth',
          count: 1,
          builtAt: 1700000000000,
          rebuiltAt: null,
          workspaceRoot: '/ws',
        },
      ],
    });
    rpcMock.primeCorpus.mockResolvedValue({ sessionId: VALID_SESSION_ID });

    await TestBed.configureTestingModule({
      imports: [CorpusListComponent],
      providers: [
        { provide: MemoryRpcService, useValue: rpcMock },
        { provide: VSCodeService, useValue: { postMessage: postMessageMock } },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const primeBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(
      (b) => (b.textContent ?? '').trim() === 'Prime in new chat',
    ) as HTMLButtonElement;
    primeBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat:switchSession',
        payload: { sessionId: VALID_SESSION_ID },
      }),
    );
  });

  it('confirms before delete and skips RPC when cancelled', async () => {
    rpcMock.listCorpora.mockResolvedValue({
      corpora: [
        {
          id: 'c-1',
          name: 'auth',
          count: 4,
          builtAt: 1700000000000,
          rebuiltAt: null,
          workspaceRoot: '/ws',
        },
      ],
    });
    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const deleteBtn = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find(
        (b) => (b.textContent ?? '').trim() === 'Delete',
      ) as HTMLButtonElement;
      deleteBtn.click();
      await Promise.resolve();

      expect(rpcMock.deleteCorpus).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('surfaces an error banner when listCorpora rejects', async () => {
    rpcMock.listCorpora.mockRejectedValueOnce(new Error('store gone'));

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('store gone');
  });

  it('loadSuggestions populates the Suggested boards strip', async () => {
    rpcMock.suggestCorpora.mockResolvedValue({
      suggestions: [
        {
          suggestedName: 'auth',
          filter: { name: 'auth', concepts: ['auth'], limit: 100 },
          memberCount: 8,
          topConcepts: ['auth'],
          rationale: '8 memories tagged "auth"',
          signal: 'concept',
        },
      ],
    });

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(rpcMock.suggestCorpora).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Suggested boards');
    expect(text).toContain('8 memories tagged "auth"');
  });

  it('clears the strip without breaking the corpus list when suggestCorpora rejects', async () => {
    rpcMock.suggestCorpora.mockRejectedValue(new Error('suggest gone'));
    rpcMock.listCorpora.mockResolvedValue({
      corpora: [
        {
          id: 'c-1',
          name: 'auth',
          count: 4,
          builtAt: 1700000000000,
          rebuiltAt: null,
          workspaceRoot: '/ws',
        },
      ],
    });

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Corpus list still renders …
    expect(text).toContain('auth');
    expect(text).toContain('4 memories');
    // … and the failure did not raise the error banner nor the strip.
    expect(text).not.toContain('suggest gone');
    expect(text).not.toContain('Suggested boards');
  });

  it('onCreateSuggestion routes through runBuild (corpus:build)', async () => {
    const suggestion = {
      suggestedName: 'auth',
      filter: { name: 'auth', concepts: ['auth'], limit: 100 },
      memberCount: 8,
      topConcepts: ['auth'],
      rationale: '8 memories tagged "auth"',
      signal: 'concept' as const,
    };
    rpcMock.suggestCorpora.mockResolvedValue({ suggestions: [suggestion] });
    rpcMock.buildCorpus.mockResolvedValue({
      corpus: {
        id: 'c-1',
        name: 'auth',
        count: 8,
        builtAt: 1700000000000,
        rebuiltAt: null,
        workspaceRoot: '/ws',
      },
    });

    const fixture = TestBed.createComponent(CorpusListComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const createBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(
      (b) => (b.textContent ?? '').trim() === 'Create',
    ) as HTMLButtonElement;
    createBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(rpcMock.buildCorpus).toHaveBeenCalledWith(suggestion.filter);
  });
});
