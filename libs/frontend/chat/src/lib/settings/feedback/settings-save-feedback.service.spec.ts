import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  VSCodeService,
  type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import {
  SAVE_REFUSED_MESSAGE,
  UNDO_STALE_MESSAGE,
  SETTINGS_TOAST_TIMEOUT_MS,
  SettingsSaveFeedbackService,
  type SettingsGenericSaveRequest,
  type SettingsSaveRequest,
} from './settings-save-feedback.service';

const EMPTY: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

describe('SettingsSaveFeedbackService', () => {
  let commit: WritableSignal<ProvidersSettingsCommit>;
  let service: SettingsSaveFeedbackService;

  /** A write that moves `commit()` through saving to `outcome`, like a real state command. */
  function writeResolving(outcome: Partial<ProvidersSettingsCommit>): jest.Mock<Promise<boolean>> {
    return jest.fn(async () => {
      commit.set({ ...EMPTY, status: 'saving' });
      await Promise.resolve();
      commit.set({ ...EMPTY, ...outcome });
      return true;
    });
  }

  function request(overrides: Partial<SettingsSaveRequest> = {}): SettingsSaveRequest {
    return {
      label: 'main agent model',
      scope: 'workspace',
      write: writeResolving({ status: 'saved', saved: ['model'] }),
      undo: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    commit = signal<ProvidersSettingsCommit>(EMPTY);
    TestBed.configureTestingModule({
      providers: [
        SettingsSaveFeedbackService,
        { provide: ProvidersSettingsStateService, useValue: { commit } },
      ],
    });
    service = TestBed.inject(SettingsSaveFeedbackService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('shows a polite success toast naming the field and scope, with Undo when undo is given', async () => {
    await service.save(request({ undo: jest.fn().mockResolvedValue(true) }));

    expect(service.toast()).toEqual({
      tone: 'status',
      message: 'Saved main agent model to This workspace.',
      canUndo: true,
    });
  });

  // Batch 27b: the App scope is the running host's own layer, named after the host.
  it.each([
    { host: 'VS Code', isElectron: false, app: 'VS Code' },
    { host: 'Electron', isElectron: true, app: 'Desktop app' },
  ])('labels each scope as the Save-to choice does ($host host)', async ({ isElectron, app }) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SettingsSaveFeedbackService,
        { provide: ProvidersSettingsStateService, useValue: { commit } },
        { provide: VSCodeService, useValue: { isElectron } },
      ],
    });
    service = TestBed.inject(SettingsSaveFeedbackService);
    await service.save(request({ scope: 'app' }));
    expect(service.toast()?.message).toBe(`Saved main agent model to ${app}.`);
    await service.save(request({ scope: 'global' }));
    expect(service.toast()?.message).toBe('Saved main agent model to All Ptah apps.');
    service.dismiss();
  });

  it('offers no Undo when the request has none', async () => {
    await service.save(request());
    expect(service.toast()?.canUndo).toBe(false);
  });

  it('Undo performs a second real write through save(), and the result offers no further Undo', async () => {
    const undo = writeResolving({ status: 'saved', saved: ['model'] });
    const write = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ write, undo }));

    await service.undo();

    expect(write).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(service.toast()).toEqual({
      tone: 'status',
      message: 'Saved main agent model to This workspace.',
      canUndo: false,
    });
    await service.undo();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('m1: Undo while another save is in flight keeps the toast and its Undo, and says why; it runs once that save ends', async () => {
    const undo = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ undo }));
    commit.set({ ...EMPTY, status: 'saving' });

    await service.undo();

    expect(undo).not.toHaveBeenCalled();
    expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: true });
    commit.set({ ...EMPTY, status: 'saved' });
    await service.undo();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(service.toast()?.canUndo).toBe(false);
  });

  it('m-1 (Batch 55b): Undo after a newer write of the same field that bypassed the toast is refused, with a fixed sentence', async () => {
    const undo = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ undo }));
    // A drawer tab's own write (runDrawerWrite) of the same field: a new commit, no toast.
    commit.set({ ...EMPTY, status: 'saved', saved: ['model'] });

    await service.undo();

    expect(undo).not.toHaveBeenCalled();
    expect(service.toast()).toEqual({ tone: 'alert', message: UNDO_STALE_MESSAGE, canUndo: false });
    await service.undo();
    expect(undo).not.toHaveBeenCalled();
  });

  it('m-1: a newer write that failed on the same field also makes the Undo stale; one of other fields does not', async () => {
    const undo = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ undo }));
    commit.set({ ...EMPTY, status: 'failed', unconfirmed: ['model'] });
    await service.undo();
    expect(undo).not.toHaveBeenCalled();

    const second = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ undo: second }));
    commit.set({ ...EMPTY, status: 'saved', saved: ['effort'] });
    await service.undo();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a failed Undo write reports failure and offers no Undo', async () => {
    const undo = writeResolving({ status: 'failed', unsaved: ['model'] });
    await service.save(request({ undo }));

    await service.undo();

    expect(service.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save main agent model. Not saved: model.',
      canUndo: false,
    });
  });

  it('a failed save is an alert listing unsaved fields and the commit message, with no Undo', async () => {
    const undo = jest.fn().mockResolvedValue(true);
    await service.save(
      request({
        write: writeResolving({
          status: 'failed',
          unsaved: ['model', 'effort'],
          message: 'Some settings could not be refreshed. Retry those sections.',
        }),
        undo,
      }),
    );

    expect(service.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save main agent model. Not saved: model, effort. Some settings could not be refreshed. Retry those sections.',
      canUndo: false,
    });
    expect(undo).not.toHaveBeenCalled();
  });

  it.each([
    ['partial', { status: 'partial', saved: ['model'], unsaved: ['effort'] }, 'Not saved: effort.'],
    ['unconfirmed', { status: 'unconfirmed', unconfirmed: ['model'] }, 'Not confirmed: model.'],
    ['blocked', { status: 'blocked', unsaved: ['model'], message: 'Review the current workspace.' }, 'Not saved: model. Review the current workspace.'],
  ] as const)('a %s commit is an alert without Undo', async (_name, outcome, detail) => {
    await service.save(
      request({ write: writeResolving(outcome), undo: jest.fn().mockResolvedValue(true) }),
    );

    expect(service.toast()).toEqual({
      tone: 'alert',
      message: `Could not save main agent model. ${detail}`,
      canUndo: false,
    });
  });

  // Gate V 36 M2: callers close or confirm from this save's own result, never from a shared earlier commit.
  it('M2: resolves this call\'s own outcome, also when commit() still says an earlier save landed', async () => {
    expect(await service.save(request())).toBe('saved');
    // commit() is now `saved`; a refused write must not read as saved.
    expect(await service.save(request({ write: jest.fn().mockResolvedValue(false) }))).toBe('refused');
    expect(await service.save(request({ write: jest.fn().mockRejectedValue(new Error('broken')) }))).toBe('failed');
    expect(await service.save(request({ write: writeResolving({ status: 'failed', unsaved: ['model'] }) }))).toBe('failed');
    commit.set({ ...EMPTY, status: 'saving' });
    expect(await service.save(request())).toBe('refused');
  });

  it('Minor 3: raw settings keys never appear in a failure toast; human field labels still do', async () => {
    await service.save(request({
      label: 'Glm Opus tier',
      write: writeResolving({ status: 'failed', unsaved: ['ptahCliAgents.glm-1.tierMappings', 'Main agent opus model'] }),
    }));
    expect(service.toast()?.message).toBe('Could not save Glm Opus tier. Not saved: Main agent opus model.');
    await service.save(request({
      label: 'Copilot auto-approve',
      write: writeResolving({ status: 'unconfirmed', unconfirmed: ['agentOrchestration.copilotAutoApprove'] }),
    }));
    expect(service.toast()?.message).toBe(
      'Could not save Copilot auto-approve. It may have been saved; check the current value before retrying.');
  });

  it('uses the request\'s fixed failure and success copy, and the Undo reports with the default copy', async () => {
    await service.save(request({
      write: writeResolving({ status: 'partial', saved: ['ptahCliAgents.a.name'], unsaved: ['ptahCliAgents.a.apiKey'] }),
      failureMessage: (result) => result.saved.length ? 'Name saved. The key was not saved.' : null,
    }));
    expect(service.toast()?.message).toBe('Name saved. The key was not saved.');
    const undo = writeResolving({ status: 'saved', saved: ['model'] });
    await service.save(request({ undo, successMessage: 'Created Glm. Key stored, not verified.' }));
    expect(service.toast()?.message).toBe('Created Glm. Key stored, not verified.');
    await service.undo();
    expect(service.toast()?.message).toBe('Saved main agent model to This workspace.');
  });

  it('announce shows a fixed toast with no Undo (M3)', () => {
    service.announce('Key stored, not verified.', 'status');
    expect(service.toast()).toEqual({ tone: 'status', message: 'Key stored, not verified.', canUndo: false });
  });

  it('refuses re-entry while a save is in flight without calling write', async () => {
    commit.set({ ...EMPTY, status: 'saving' });
    const write = jest.fn().mockResolvedValue(true);

    await service.save(request({ write }));

    expect(write).not.toHaveBeenCalled();
    expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
    expect(service.saving()).toBe(true);
  });

  it('a refused write (false) never shows success, even while commit() still shows an earlier saved commit', async () => {
    // An earlier save left commit() at `saved` and its toast on screen.
    await service.save(request({ undo: jest.fn().mockResolvedValue(true) }));
    expect(commit().status).toBe('saved');
    expect(service.toast()?.tone).toBe('status');

    // This call is refused by the state service (another save won the race): commit() is untouched.
    const refusedUndo = jest.fn().mockResolvedValue(true);
    await service.save(
      request({ label: 'effort', write: jest.fn().mockResolvedValue(false), undo: refusedUndo }),
    );

    expect(commit().status).toBe('saved');
    expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
    await service.undo();
    expect(refusedUndo).not.toHaveBeenCalled();
  });

  it('a write that throws reports the save as unconfirmed, with no Undo', async () => {
    await service.save(
      request({
        write: jest.fn().mockRejectedValue(new Error('boom')),
        undo: jest.fn().mockResolvedValue(true),
      }),
    );

    expect(service.toast()).toEqual({
      tone: 'alert',
      message: 'Could not confirm whether main agent model was saved.',
      canUndo: false,
    });
  });

  it('auto-dismisses after 8 s with one timer, replaced (not stacked) by the next toast', async () => {
    await service.save(request());
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(SETTINGS_TOAST_TIMEOUT_MS - 1000);
    await service.save(request({ scope: 'global' }));
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(1000);
    expect(service.toast()?.message).toBe('Saved main agent model to All Ptah apps.');
    jest.advanceTimersByTime(SETTINGS_TOAST_TIMEOUT_MS);
    expect(service.toast()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('dismiss clears the toast, the Undo and the timer', async () => {
    const undo = jest.fn().mockResolvedValue(true);
    await service.save(request({ undo }));

    service.dismiss();

    expect(service.toast()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    await service.undo();
    expect(undo).not.toHaveBeenCalled();
  });

  it('clears the timer when its injector is destroyed', async () => {
    await service.save(request());
    expect(jest.getTimerCount()).toBe(1);

    TestBed.resetTestingModule();

    expect(jest.getTimerCount()).toBe(0);
  });

  describe('saveGeneric (G2)', () => {
    function genericRequest(overrides: Partial<SettingsGenericSaveRequest> = {}): SettingsGenericSaveRequest {
      return {
        label: 'MCP port',
        write: jest.fn().mockResolvedValue({ ok: true }),
        undo: null,
        ...overrides,
      };
    }

    it('toasts "Saved {label}." with no scope words and offers Undo when undo is given', async () => {
      const undo = jest.fn().mockResolvedValue({ ok: true });
      // Batch 51.4: callers act on the returned result, never on the toast.
      await expect(service.saveGeneric(genericRequest({ undo }))).resolves.toBe('saved');

      expect(service.toast()).toEqual({
        tone: 'status',
        message: 'Saved MCP port.',
        canUndo: true,
      });
    });

    it('offers no Undo when the request has none', async () => {
      await expect(service.saveGeneric(genericRequest())).resolves.toBe('saved');
      expect(service.toast()?.canUndo).toBe(false);
    });

    it('a failed write shows the failure message and no Undo', async () => {
      await expect(service.saveGeneric(
        genericRequest({ write: jest.fn().mockResolvedValue({ ok: false, message: 'Port must be between 1024 and 65535.' }) }),
      )).resolves.toBe('failed');

      expect(service.toast()).toEqual({
        tone: 'alert',
        message: 'Port must be between 1024 and 65535.',
        canUndo: false,
      });
    });

    it('a write that throws reports the save as unconfirmed, with no Undo', async () => {
      await expect(service.saveGeneric(genericRequest({ write: jest.fn().mockRejectedValue(new Error('boom')) }))).resolves.toBe('failed');

      expect(service.toast()).toEqual({
        tone: 'alert',
        message: 'Could not confirm whether MCP port was saved.',
        canUndo: false,
      });
    });

    it('refuses re-entry while a generic save is in flight without calling write', async () => {
      let finishWrite: () => void = () => void 0;
      const write = jest.fn(() => new Promise<{ ok: true }>((resolve) => { finishWrite = () => resolve({ ok: true }); }));
      const first = service.saveGeneric(genericRequest({ write }));
      expect(service.saving()).toBe(true);

      await expect(service.saveGeneric(genericRequest({ label: 'other', write: jest.fn() }))).resolves.toBe('refused');

      expect(write).toHaveBeenCalledTimes(1);
      expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
      finishWrite();
      await expect(first).resolves.toBe('saved');
    });

    it('refuses re-entry while a Providers commit is saving without calling write', async () => {
      commit.set({ ...EMPTY, status: 'saving' });
      const write = jest.fn().mockResolvedValue({ ok: true });

      await expect(service.saveGeneric(genericRequest({ write }))).resolves.toBe('refused');

      expect(write).not.toHaveBeenCalled();
      expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
    });

    it('Undo performs a second real write through saveGeneric(), and the result offers no further Undo', async () => {
      const undo = jest.fn().mockResolvedValue({ ok: true });
      const write = jest.fn().mockResolvedValue({ ok: true });
      await service.saveGeneric(genericRequest({ write, undo }));

      await service.undo();

      expect(write).toHaveBeenCalledTimes(1);
      expect(undo).toHaveBeenCalledTimes(1);
      expect(service.toast()).toEqual({
        tone: 'status',
        message: 'Saved MCP port.',
        canUndo: false,
      });
    });

    it('a failed Undo write reports the failure and offers no Undo', async () => {
      const undo = jest.fn().mockResolvedValue({ ok: false, message: 'Undo failed.' });
      await service.saveGeneric(genericRequest({ undo }));

      await service.undo();

      expect(service.toast()).toEqual({
        tone: 'alert',
        message: 'Undo failed.',
        canUndo: false,
      });
    });

    it('m1: Undo while another save is in flight keeps the toast and its Undo, and runs once that save ends', async () => {
      const undo = jest.fn().mockResolvedValue({ ok: true });
      await service.saveGeneric(genericRequest({ undo }));
      commit.set({ ...EMPTY, status: 'saving' });

      await service.undo();

      expect(undo).not.toHaveBeenCalled();
      expect(service.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: true });
      commit.set({ ...EMPTY, status: 'saved' });
      await service.undo();
      expect(undo).toHaveBeenCalledTimes(1);
    });
  });
});
