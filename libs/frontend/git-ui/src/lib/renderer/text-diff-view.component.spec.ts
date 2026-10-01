import {
  Component,
  signal,
  type Signal,
  type Type,
  viewChild,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TextDiffViewComponent } from './text-diff-view.component';

interface FakeHunk {
  additionStart: number;
  additionCount: number;
  deletionStart: number;
  deletionCount: number;
  collapsedBefore: number;
}

const pierre = {
  instances: [] as FakeFileDiff[],
  parsedFiles: [] as Array<{
    oldFile: { name: string; contents: string } | null;
    newFile: { name: string; contents: string } | null;
  }>,
  parseThrows: false,
};

class FakeFileDiff {
  cleanedUp = false;
  themeTypes: string[] = [];
  rendered: {
    fileDiff: { hunks: FakeHunk[] };
    fileContainer: HTMLElement;
  } | null = null;

  constructor(
    public options: Record<string, unknown>,
    public workerManager: unknown,
    public isContainerManaged: boolean,
  ) {
    pierre.instances.push(this);
  }

  render(props: NonNullable<FakeFileDiff['rendered']>): boolean {
    this.rendered = props;
    const container = props.fileContainer;
    const root =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const pre = document.createElement('pre');
    pre.textContent = 'unified diff content';
    root.appendChild(pre);
    return true;
  }

  setThemeType(mode: string): void {
    this.themeTypes.push(mode);
  }

  cleanUp(): void {
    this.cleanedUp = true;
  }
}

jest.mock('@pierre/diffs', () => ({
  DEFAULT_THEMES: { dark: 'pierre-dark', light: 'pierre-light' },
  FileDiff: FakeFileDiff,
  registerCustomLanguage: jest.fn(),
  parseDiffFromFile: (
    oldFile: { name: string; contents: string } | null,
    newFile: { name: string; contents: string } | null,
  ) => {
    pierre.parsedFiles.push({ oldFile, newFile });
    if (pierre.parseThrows) throw new Error('parseDiffFromFile: failed');
    return {
      hunks: [],
      oldFile,
      newFile,
    };
  },
}));

interface HostShape {
  readonly oldText: ReturnType<typeof signal<string | null>>;
  readonly newText: ReturnType<typeof signal<string | null>>;
  readonly fileName: ReturnType<typeof signal<string>>;
  readonly language: ReturnType<typeof signal<string>>;
  readonly theme: ReturnType<typeof signal<'light' | 'dark'>>;
  readonly diffView: Signal<TextDiffViewComponent>;
}

async function createHostComponent(): Promise<Type<HostShape>> {
  const { TextDiffViewComponent: DiffView } =
    await import('./text-diff-view.component');

  @Component({
    standalone: true,
    imports: [DiffView],
    template: `
      <ptah-text-diff-view
        [oldText]="oldText()"
        [newText]="newText()"
        [fileName]="fileName()"
        [language]="language()"
        [themeType]="theme()"
      />
    `,
  })
  class HostComponent implements HostShape {
    readonly oldText = signal<string | null>('console.log("hello");');
    readonly newText = signal<string | null>('console.log("world");');
    readonly fileName = signal<string>('test.ts');
    readonly language = signal<string>('');
    readonly theme = signal<'light' | 'dark'>('dark');
    readonly diffView = viewChild.required(DiffView);
  }
  return HostComponent;
}

describe('TextDiffViewComponent', () => {
  let fixture: ComponentFixture<HostShape>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    pierre.instances = [];
    pierre.parsedFiles = [];
    pierre.parseThrows = false;
    const HostComponent = await createHostComponent();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await settle();
  });

  it('configures host-managed FileDiff with unified style and word-level diff', () => {
    expect(pierre.instances).toHaveLength(1);
    const [instance] = pierre.instances;
    expect(instance.isContainerManaged).toBe(true);
    expect(instance.options).toMatchObject({
      diffStyle: 'unified',
      lineDiffType: 'word',
      preferredHighlighter: 'shiki-js',
      hunkSeparators: 'line-info',
      expandUnchanged: false,
      themeType: 'dark',
    });
    expect(instance.rendered?.fileContainer.tagName.toLowerCase()).toBe(
      'diffs-container',
    );
  });

  it('passes oldText, newText and fileName to parseDiffFromFile', () => {
    expect(pierre.parsedFiles).toHaveLength(1);
    expect(pierre.parsedFiles[0].oldFile).toEqual({
      name: 'test.ts',
      contents: 'console.log("hello");',
    });
    expect(pierre.parsedFiles[0].newFile).toEqual({
      name: 'test.ts',
      contents: 'console.log("world");',
    });
    expect(fixture.componentInstance.diffView().error()).toBeNull();
  });

  it('uses language to formulate file extension if fileName is empty', async () => {
    fixture.componentInstance.fileName.set('');
    fixture.componentInstance.language.set('typescript');
    await settle();
    expect(pierre.parsedFiles.at(-1)?.oldFile?.name).toBe('file.typescript');
    expect(pierre.parsedFiles.at(-1)?.newFile?.name).toBe('file.typescript');
  });

  it('does not instantiate FileDiff when both oldText and newText are null', async () => {
    const instancesBefore = pierre.instances.length;
    fixture.componentInstance.oldText.set(null);
    fixture.componentInstance.newText.set(null);
    await settle();
    expect(pierre.instances).toHaveLength(instancesBefore);
    expect(fixture.componentInstance.diffView().error()).toBeNull();
  });

  it('handles parseDiffFromFile errors gracefully and displays error message', async () => {
    pierre.parseThrows = true;
    fixture.componentInstance.newText.set('trigger error');
    await settle();
    expect(fixture.componentInstance.diffView().error()).toBe(
      'parseDiffFromFile: failed',
    );
    const errorEl = fixture.nativeElement.querySelector(
      '[data-testid="text-diff-error"]',
    );
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('This diff could not be displayed.');
  });

  it('disposes the previous FileDiff on content input change', async () => {
    const first = pierre.instances[0];
    expect(first.cleanedUp).toBe(false);
    fixture.componentInstance.newText.set('console.log("updated");');
    await settle();
    expect(first.cleanedUp).toBe(true);
    expect(pierre.instances).toHaveLength(2);
    expect(pierre.instances[1].cleanedUp).toBe(false);
  });

  it('applies theme changes in place without recreating FileDiff', async () => {
    const instancesBefore = pierre.instances.length;
    fixture.componentInstance.theme.set('light');
    await settle();
    expect(pierre.instances).toHaveLength(instancesBefore);
    expect(pierre.instances[0].themeTypes.at(-1)).toBe('light');
  });

  it('disposes FileDiff on destroy', () => {
    const [instance] = pierre.instances;
    fixture.destroy();
    expect(instance.cleanedUp).toBe(true);
  });
});
