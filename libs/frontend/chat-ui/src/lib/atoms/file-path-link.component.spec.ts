import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { FilePathLinkComponent } from './file-path-link.component';

describe('FilePathLinkComponent', () => {
  let openFile: jest.Mock;
  let isElectron: boolean;

  async function setup(opts: { electron?: boolean } = {}) {
    isElectron = !!opts.electron;
    openFile = jest.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [FilePathLinkComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { openFile } },
        { provide: VSCodeService, useValue: { isElectron } },
      ],
    }).compileComponents();
  }

  it('renders shortened path with title set to full path', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '/very/deep/nested/path/file.ts');
    fixture.detectChanges();

    const span = fixture.nativeElement.querySelector('span[title]');
    expect(span.getAttribute('title')).toBe('/very/deep/nested/path/file.ts');
    expect(span.textContent).toContain('.../path/file.ts');
  });

  it('returns the path verbatim when only one segment', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', 'foo/bar');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('foo/bar');
  });

  it('opens via RPC service when not Electron', async () => {
    await setup({ electron: false });
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '/a/b/c.ts');
    fixture.detectChanges();

    let evt: Event | null = null;
    fixture.componentInstance.clicked.subscribe((e) => (evt = e));
    fixture.nativeElement.querySelector('span[title]').click();

    expect(openFile).toHaveBeenCalledWith('/a/b/c.ts');
    expect(evt).not.toBeNull();
  });

  it('does nothing when path is empty', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('span[title]').click();
    expect(openFile).not.toHaveBeenCalled();
  });
});
