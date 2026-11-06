/** @jest-environment jsdom */
import { TestBed } from '@angular/core/testing';
import type { ParsedRelease } from '@ptah-web/core';
import { PlatformCardsComponent } from './platform-cards.component';

const release: ParsedRelease = {
  version: '1.0.0',
  tagName: 'electron-v1.0.0',
  name: 'PtahCode 1.0.0',
  publishedAt: '2026-10-01T12:00:00Z',
  releaseUrl: 'https://github.com/Hive-Academy/PtahCode/releases/tag/electron-v1.0.0',
  windows: [],
  macos: [{ label: 'macOS Apple Silicon (.dmg)', fileName: 'PtahCode.dmg', downloadUrl: 'https://example.invalid/PtahCode.dmg', size: '1 MB' }],
  linux: [],
};

function render(os: 'windows' | 'macos' | 'linux' | null, latest: ParsedRelease | null): HTMLElement {
  const fixture = TestBed.createComponent(PlatformCardsComponent);
  fixture.componentRef.setInput('os', os);
  fixture.componentRef.setInput('latest', latest);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('PlatformCardsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('marks the detected platform without changing its link text', () => {
    const root = render('macos', null);
    const cards = Array.from(root.querySelectorAll('.dl-platform'));

    expect(cards.map((card) => card.classList.contains('is-detected'))).toEqual([false, true, false]);
    expect(cards[1].querySelector('a')?.textContent?.trim()).toBe('Download for macOS');
    expect(cards[1].textContent).toContain('This device');
  });

  it('lists the latest installers, the Store for Windows, and missing builds', () => {
    const details = Array.from(render(null, release).querySelectorAll('.dl-detail')).map((p) => p.textContent?.trim());

    expect(details).toEqual(['Get it from the Microsoft Store', 'macOS Apple Silicon (.dmg)', 'No Linux builds']);
  });

  it('falls back to the latest release page before details load', () => {
    const root = render(null, null);

    expect(root.querySelectorAll('.is-detected')).toHaveLength(0);
    expect(root.querySelector('.dl-detail')?.textContent?.trim()).toBe('Latest GitHub release');
  });
});
