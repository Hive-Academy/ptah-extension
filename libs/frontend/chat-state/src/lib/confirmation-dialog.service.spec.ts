/**
 * ConfirmationDialogService — async confirmation flow coverage.
 */

import { TestBed } from '@angular/core/testing';
import { ConfirmationDialogService } from './confirmation-dialog.service';

describe('ConfirmationDialogService', () => {
  let svc: ConfirmationDialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ConfirmationDialogService] });
    svc = TestBed.inject(ConfirmationDialogService);
  });

  it('exposes default-closed state', () => {
    expect(svc.isOpen()).toBe(false);
    expect(svc.options()).toBeNull();
  });

  it('confirm() resolves true when handleConfirm is invoked', async () => {
    const promise = svc.confirm({ title: 'T', message: 'M' });
    expect(svc.isOpen()).toBe(true);
    expect(svc.options()?.title).toBe('T');
    svc.handleConfirm();
    await expect(promise).resolves.toBe(true);
    expect(svc.isOpen()).toBe(false);
    expect(svc.options()).toBeNull();
  });

  it('confirm() resolves false when handleCancel is invoked', async () => {
    const promise = svc.confirm({ title: 'T', message: 'M' });
    svc.handleCancel();
    await expect(promise).resolves.toBe(false);
    expect(svc.isOpen()).toBe(false);
  });

  it('handleConfirm/handleCancel are no-ops when no dialog is open', () => {
    expect(() => svc.handleConfirm()).not.toThrow();
    expect(() => svc.handleCancel()).not.toThrow();
    expect(svc.isOpen()).toBe(false);
  });

  it('preserves the options snapshot during the open lifecycle', () => {
    void svc.confirm({
      title: 'Close?',
      message: 'sure',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      confirmStyle: 'error',
    });
    const opts = svc.options();
    expect(opts?.confirmLabel).toBe('Yes');
    expect(opts?.cancelLabel).toBe('No');
    expect(opts?.confirmStyle).toBe('error');
  });

  describe('confirmWithCheckboxes', () => {
    it('resolves with { confirmed: true, checkboxes } reflecting user-toggled state', async () => {
      const promise = svc.confirmWithCheckboxes({
        title: 'Rewind',
        message: 'Continue?',
        checkboxes: [
          { id: 'deleteOriginal', label: 'Also delete original session' },
          { id: 'notifyMe', label: 'Notify me when complete' },
        ],
      });
      expect(svc.isOpen()).toBe(true);
      expect(svc.options()?.checkboxes?.length).toBe(2);

      svc.handleConfirmWithState({ deleteOriginal: true, notifyMe: false });

      const result = await promise;
      expect(result).toEqual({
        confirmed: true,
        checkboxes: { deleteOriginal: true, notifyMe: false },
      });
      expect(svc.isOpen()).toBe(false);
      expect(svc.options()).toBeNull();
    });

    it('resolves with { confirmed: false } on cancel, ignoring checkbox state', async () => {
      const promise = svc.confirmWithCheckboxes({
        title: 'Rewind',
        message: 'Continue?',
        checkboxes: [
          {
            id: 'deleteOriginal',
            label: 'Also delete original session',
            defaultChecked: true,
          },
        ],
      });

      svc.handleCancel();

      const result = await promise;
      expect(result).toEqual({ confirmed: false });
      expect((result as { checkboxes?: unknown }).checkboxes).toBeUndefined();
      expect(svc.isOpen()).toBe(false);
    });

    it('exposes defaultChecked metadata in the options snapshot for renderer initialization', () => {
      void svc.confirmWithCheckboxes({
        title: 'Rewind',
        message: 'Continue?',
        checkboxes: [
          {
            id: 'deleteOriginal',
            label: 'Also delete original session',
            defaultChecked: true,
          },
          { id: 'plain', label: 'Plain', defaultChecked: false },
          { id: 'unset', label: 'Unset' },
        ],
      });

      const checkboxes = svc.options()?.checkboxes;
      expect(checkboxes).toBeDefined();
      expect(checkboxes?.[0]).toEqual({
        id: 'deleteOriginal',
        label: 'Also delete original session',
        defaultChecked: true,
      });
      expect(checkboxes?.[1].defaultChecked).toBe(false);
      expect(checkboxes?.[2].defaultChecked).toBeUndefined();
    });
  });
});
