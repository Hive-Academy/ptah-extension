import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PROMPT_CATALOGUE } from '../setup-plugins/prompt-catalogue';
import {
  buildLaunchers,
  PromptLaunchersComponent,
} from './prompt-launchers.component';

const LAUNCHERS = buildLaunchers();

describe('PromptLaunchersComponent', () => {
  let fixture: ComponentFixture<PromptLaunchersComponent>;
  let host: HTMLElement;

  function buttons(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll('button'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PromptLaunchersComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PromptLaunchersComponent);
    host = fixture.nativeElement;
    fixture.componentRef.setInput('launchers', LAUNCHERS);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('builds launchers from the full catalogue (6 categories, 27 prompts)', () => {
    expect(PROMPT_CATALOGUE.map((c) => c.id)).toEqual([
      'build',
      'fix',
      'review',
      'agents',
      'explore',
      'creative',
    ]);
    expect(PROMPT_CATALOGUE.flatMap((c) => c.prompts)).toHaveLength(27);
    expect(LAUNCHERS.map((l) => [l.id, l.label, l.icon, l.text])).toEqual(
      ['build', 'fix', 'review', 'explore'].map((id) => {
        const category = PROMPT_CATALOGUE.find((c) => c.id === id);
        return [id, category?.label, category?.icon, category?.prompts[0].text];
      }),
    );
    expect(LAUNCHERS[0].text).toBe(
      '/orchestrate Build [describe your feature] with full workflow orchestration',
    );
  });

  it('skips a launcher category that is missing or has no prompts', () => {
    const catalogue = PROMPT_CATALOGUE.map((c) =>
      c.id === 'fix' ? { ...c, prompts: [] } : c,
    ).filter((c) => c.id !== 'review');

    expect(buildLaunchers(catalogue).map((l) => l.id)).toEqual([
      'build',
      'explore',
    ]);
    expect(
      buildLaunchers(PROMPT_CATALOGUE, ['explore']).map((l) => l.id),
    ).toEqual(['explore']);
  });

  it('renders one named button per launcher inside a labelled group', () => {
    expect(host.getAttribute('role')).toBe('group');
    expect(host.getAttribute('aria-label')).toBe('Start with a prompt');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'Build',
      'Fix',
      'Review',
      'Explore',
    ]);
    for (const button of buttons()) {
      expect(button.type).toBe('button');
      expect(
        button
          .querySelector('.ptah-launcher__icon')
          ?.getAttribute('aria-hidden'),
      ).toBe('true');
    }
  });

  it('emits the prompt text of the activated launcher', () => {
    const emitted: string[] = [];
    fixture.componentInstance.launch.subscribe((text) => emitted.push(text));

    buttons()[1].click();

    expect(emitted).toEqual([
      "/orchestrate BUGFIX: Fix [describe the bug you're seeing]",
    ]);
    expect(buttons()[1].title).toBe(emitted[0]);
  });

  it('gates the hover motion and shows a visible focus ring', () => {
    const source = readFileSync(
      join(__dirname, 'prompt-launchers.component.ts'),
      'utf8',
    );
    const flat = source.replace(/\s+/g, ' ');

    expect(flat).toMatch(
      /\.ptah-launcher:focus-visible \{[^}]*outline: 2px solid oklch\(var\(--p\)\);/,
    );
    const motion = flat.split('@media (prefers-reduced-motion: no-preference)');
    expect(motion).toHaveLength(2);
    expect(motion[0]).not.toMatch(/transition|transform/);
    expect(source).not.toMatch(/innerHTML/);
  });
});
