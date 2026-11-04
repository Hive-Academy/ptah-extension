import { signal } from '@angular/core';
import { ReviewRunsStore } from '../review-runs.store';
import { TestBed } from '@angular/core/testing';
import { ReviewSettingsDrawerComponent } from './review-settings-drawer.component';

describe('ReviewSettingsDrawerComponent', () => {
  it('shows the Minor default without publication controls and closes on Escape', () => {
    TestBed.configureTestingModule({ imports: [ReviewSettingsDrawerComponent], providers: [{ provide: ReviewRunsStore, useValue: { botIdentity: signal(null), tokenStorage: signal('encrypted'), attestorLogin: signal(''), liveAttested: signal(false), credentialState: signal('idle'), loadBotIdentity: jest.fn(), setBotToken: jest.fn(), clearBotToken: jest.fn(), setPublicationPause: jest.fn() } }] });
    const fixture = TestBed.createComponent(ReviewSettingsDrawerComponent);
    fixture.componentRef.setInput('draft', { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: false, dryRun: true,
      publicationPaused: false }], maintainerLogins: [], pollMinutes: 10, globalPublicationPaused: false,
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [] });
    const close = jest.fn(); fixture.componentInstance.closed.subscribe(close);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Minor');
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).not.toBeNull();
    fixture.nativeElement.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('clears the password field after submitting and asks before resuming publication', async () => {
    const setBotToken = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ imports: [ReviewSettingsDrawerComponent], providers: [{ provide: ReviewRunsStore, useValue: {
      botIdentity: signal(null), tokenStorage: signal('encrypted'), attestorLogin: signal(''), liveAttested: signal(false), credentialState: signal('idle'), loadBotIdentity: jest.fn(), setBotToken,
      clearBotToken: jest.fn(), setPublicationPause: jest.fn(),
    } }] });
    const fixture = TestBed.createComponent(ReviewSettingsDrawerComponent);
    fixture.componentRef.setInput('draft', { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true,
      publicationPaused: false }], maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: true,
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [] });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#review-bot-token') as HTMLInputElement;
    input.value = 'secret-token';
    await fixture.componentInstance.submitToken(input);
    expect(input.value).toBe('');
    expect(setBotToken).toHaveBeenCalledWith('secret-token');
    const toggle = Array.from(fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>)
      .find(item => item.classList.contains('toggle-warning'));
    toggle!.checked = false;
    toggle!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Resume live publication?');
  });
  it('asks for fresh live permission attestation after replacing a token', async () => {
    const setBotToken = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ imports: [ReviewSettingsDrawerComponent], providers: [{ provide: ReviewRunsStore,
      useValue: { botIdentity: signal(null), tokenStorage: signal('encrypted'), attestorLogin: signal(''),
        liveAttested: signal(false), credentialState: signal('idle'), loadBotIdentity: jest.fn(),
        setBotToken, clearBotToken: jest.fn(), setPublicationPause: jest.fn() } }] });
    const fixture = TestBed.createComponent(ReviewSettingsDrawerComponent);
    fixture.componentRef.setInput('draft', { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true,
      dryRun: false, publicationPaused: false }], maintainerLogins: ['maintainer'], pollMinutes: 10,
      globalPublicationPaused: false, laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [] });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#review-bot-token') as HTMLInputElement;
    input.value = 'replacement';
    await fixture.componentInstance.submitToken(input);
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Enable live publication?');
    expect(setBotToken).toHaveBeenCalledWith('replacement');
  });
});
