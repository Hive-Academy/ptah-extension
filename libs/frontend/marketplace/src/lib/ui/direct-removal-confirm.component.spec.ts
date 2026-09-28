/**
 * DirectRemovalConfirmComponent specs: the single and bulk wording, every
 * config path listed, the two outputs, and no innerHTML.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  DirectRemovalConfirmComponent,
  type DirectRemovalTarget,
} from './direct-removal-confirm.component';

const LINEAR: DirectRemovalTarget = {
  title: 'linear',
  configPaths: ['C:\\Users\\me\\.cursor\\mcp.json'],
};
const GITHUB: DirectRemovalTarget = {
  title: 'github',
  configPaths: ['C:\\repo\\.vscode\\mcp.json', 'C:\\repo\\.mcp.json'],
};

describe('DirectRemovalConfirmComponent', () => {
  let fixture: ComponentFixture<DirectRemovalConfirmComponent>;

  const render = (
    targets: readonly DirectRemovalTarget[],
    selectedCount: number | null = null,
  ): HTMLElement => {
    fixture = TestBed.createComponent(DirectRemovalConfirmComponent);
    fixture.componentRef.setInput('targets', targets);
    fixture.componentRef.setInput('selectedCount', selectedCount);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const text = (el: Element | null): string =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const paths = (root: HTMLElement): string[] =>
    Array.from(
      root.querySelectorAll('[data-testid="direct-removal-path"]'),
    ).map(text);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DirectRemovalConfirmComponent],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('names the single server and lists its paths bare', () => {
    const root = render([LINEAR]);
    const group = root.querySelector('[role="group"]');

    expect(group?.getAttribute('aria-label')).toBe('Confirm removal of linear');
    expect(text(group)).toContain('Ptah did not install linear.');
    expect(paths(root)).toEqual(['C:\\Users\\me\\.cursor\\mcp.json']);
  });

  it('counts the bulk run and prefixes each path with its server', () => {
    const root = render([LINEAR, GITHUB], 5);

    expect(
      root.querySelector('[role="group"]')?.getAttribute('aria-label'),
    ).toBe('Confirm removal of 5 servers');
    expect(text(root)).toContain('2 of the 5 selected servers');
    expect(paths(root)).toEqual([
      'linear — C:\\Users\\me\\.cursor\\mcp.json',
      'github — C:\\repo\\.vscode\\mcp.json',
      'github — C:\\repo\\.mcp.json',
    ]);
  });

  it('emits confirmed and cancelled from its buttons', () => {
    const root = render([LINEAR]);
    const confirmed = jest.fn();
    const cancelled = jest.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="direct-removal-confirm-button"]',
      )
      ?.click();
    root
      .querySelector<HTMLButtonElement>('[data-testid="direct-removal-cancel"]')
      ?.click();

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('does not use innerHTML in the component source', () => {
    expect(
      readFileSync(
        join(__dirname, 'direct-removal-confirm.component.ts'),
        'utf8',
      ),
    ).not.toMatch(/innerHTML/i);
  });
});
