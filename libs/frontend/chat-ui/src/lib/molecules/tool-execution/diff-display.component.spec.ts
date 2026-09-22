import { TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { DiffDisplayComponent } from './diff-display.component';

describe('DiffDisplayComponent', () => {
  it('fences a diff beyond the longest backtick run in either input', async () => {
    await TestBed.configureTestingModule({
      imports: [DiffDisplayComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdown(),
        {
          provide: FILE_LINK_OPENER,
          useValue: { open: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DiffDisplayComponent);
    fixture.componentRef.setInput('toolInput', {
      file_path: '/tmp/source.ts',
      old_string: '```',
      new_string: '``````````\n<div class="fixed">x</div>',
    });

    expect(fixture.componentInstance.formattedDiff()).toBe(
      '```````````diff\n@@ Edit @@\n- ```\n+ ``````````\n' +
        '+ <div class="fixed">x</div>\n```````````',
    );
  });
});
