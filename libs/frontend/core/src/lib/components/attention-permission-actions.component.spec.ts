import { TestBed } from '@angular/core/testing';
import type { AttentionItem } from '../services/attention.types';
import { AttentionPermissionActionsComponent } from './attention-permission-actions.component';

describe('AttentionPermissionActionsComponent', () => {
  const item: AttentionItem = {
    key: 'permission:one', generation: 1, kind: 'permission', source: 'chat',
    workspacePath: '/ws', workspaceName: 'ws', severity: 'warning', title: 'Permission required',
    permissionPreview: 'Input: echo approved · Description: Run command',
    actions: [{ id: 'allow', label: 'Allow' }, { id: 'always_allow', label: 'Always allow' },
      { id: 'deny', label: 'Deny' }, { id: 'deny_with_message', label: 'Deny with message' }],
    actionable: true, soundEligible: false,
  };

  it('shows safe input text and sends an entered denial reason', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const fixture = TestBed.createComponent(AttentionPermissionActionsComponent);
    fixture.componentRef.setInput('item', item);
    const selected = jest.fn();
    fixture.componentInstance.selected.subscribe(selected);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Input: echo approved');
    expect([...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Allow')?.classList.contains('btn-primary')).toBe(true);
    host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]')?.click();
    fixture.detectChanges();
    const toggle = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'));
    toggle?.click(); fixture.detectChanges();
    const field = host.querySelector<HTMLInputElement>('input');
    if (!field) throw new Error('Missing denial reason field');
    expect(field.labels?.[0]?.textContent).toBe('Reason for denial');
    expect(document.activeElement).toBe(field);
    field.value = 'Please narrow the command';
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(selected).toHaveBeenCalledWith({ actionId: 'deny_with_message', reason: 'Please narrow the command' });
  });

  it('keeps whitespace-only denial open and describes the inline error', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const fixture = TestBed.createComponent(AttentionPermissionActionsComponent);
    fixture.componentRef.setInput('item', item);
    const selected = jest.fn();
    fixture.componentInstance.selected.subscribe(selected);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]')?.click();
    fixture.detectChanges();
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    const field = host.querySelector<HTMLInputElement>('input');
    if (!field) throw new Error('Missing denial reason field');
    field.value = '   ';
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(selected).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const errorId = field.getAttribute('aria-describedby');
    expect(errorId).toMatch(/^permission-reason-error-\d+$/);
    if (!errorId) throw new Error('Missing denial error description');
    expect(document.getElementById(errorId)?.textContent).toContain('Enter a reason');
    field.value = '  Please revise  ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(selected).toHaveBeenCalledWith({ actionId: 'deny_with_message', reason: 'Please revise' });
  });

  it('closes the message field on Escape without submitting', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const fixture = TestBed.createComponent(AttentionPermissionActionsComponent);
    fixture.componentRef.setInput('item', item); fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]')?.click();
    fixture.detectChanges();
    const more = host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]');
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    host.querySelector('form')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(more);
    more?.click();
    fixture.detectChanges();
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')?.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(more);
  });

  it('disables and blocks Send denial when the action becomes unavailable', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const fixture = TestBed.createComponent(AttentionPermissionActionsComponent);
    fixture.componentRef.setInput('item', item);
    const selected = jest.fn();
    fixture.componentInstance.selected.subscribe(selected);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]')?.click();
    fixture.detectChanges();
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    const field = host.querySelector<HTMLInputElement>('input');
    if (!field) throw new Error('Missing denial reason field');
    field.value = 'Please revise';
    fixture.componentRef.setInput('unavailable', new Map([[`${item.key}:${item.generation}:deny_with_message`, 'Action unavailable']]));
    fixture.detectChanges();
    expect([...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Send denial')?.disabled).toBe(true);
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(selected).not.toHaveBeenCalled();
  });

  it('promotes the first available action and closes More on Escape', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const fixture = TestBed.createComponent(AttentionPermissionActionsComponent);
    fixture.componentRef.setInput('item', { ...item, actions: [
      { id: 'allow', label: 'Allow', disabledReason: 'Already decided' },
      { id: 'open', label: 'Show in canvas' },
      { id: 'deny_with_message', label: 'Deny with message' },
    ] });
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const open = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Show in canvas');
    expect(open?.classList.contains('btn-primary')).toBe(true);
    host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]')?.click();
    fixture.detectChanges();
    const more = host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]');
    const disclosure = host.querySelector<HTMLElement>(`#${more?.getAttribute('aria-controls')}`);
    expect(disclosure).not.toBeNull();
    expect(document.activeElement).toBe(disclosure?.querySelector('button'));
    disclosure?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector<HTMLElement>(`#${more?.getAttribute('aria-controls')}`)?.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
  });

  it('keeps Deny visible and returns focus after an extra action', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const first = TestBed.createComponent(AttentionPermissionActionsComponent);
    first.componentRef.setInput('item', item);
    first.detectChanges();
    const host = first.nativeElement as HTMLElement;
    const more = host.querySelector<HTMLButtonElement>('[aria-label="More permission actions"]');
    expect([...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Deny')).toBeTruthy();
    more?.click(); first.detectChanges();
    const always = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Always allow');
    expect(document.activeElement).toBe(always);
    always?.click(); first.detectChanges();
    expect(document.activeElement).toBe(more);
  });

  it('gives duplicate mounted items unique disabled reason ids', () => {
    TestBed.configureTestingModule({ imports: [AttentionPermissionActionsComponent] });
    const first = TestBed.createComponent(AttentionPermissionActionsComponent);
    first.componentRef.setInput('item', item);
    first.componentRef.setInput('unavailable', new Map([[`${item.key}:${item.generation}:allow`, 'Already answered']]));
    first.detectChanges();
    const second = TestBed.createComponent(AttentionPermissionActionsComponent);
    second.componentRef.setInput('item', item);
    second.componentRef.setInput('unavailable', new Map([[`${item.key}:${item.generation}:allow`, 'Already answered']]));
    second.detectChanges();
    expect((first.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[title="Already answered"]')?.getAttribute('aria-describedby'))
      .not.toBe((second.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[title="Already answered"]')?.getAttribute('aria-describedby'));
  });
});
