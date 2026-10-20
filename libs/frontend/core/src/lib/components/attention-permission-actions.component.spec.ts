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
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    const field = host.querySelector<HTMLInputElement>('input');
    if (!field) throw new Error('Missing denial reason field');
    field.value = '   ';
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(selected).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`#${field.getAttribute('aria-describedby')}`)?.textContent).toContain('Enter a reason');
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
    [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Deny with message'))?.click();
    fixture.detectChanges();
    host.querySelector('form')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('form')).toBeNull();
  });
});
