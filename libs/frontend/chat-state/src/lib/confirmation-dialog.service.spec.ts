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
});
