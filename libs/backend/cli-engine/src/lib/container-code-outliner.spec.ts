/**
 * The CLI host binds `SDK_CODE_OUTLINER` (TASK_2026_614 D.10). Without it the
 * tool-output capper silently falls back to head/tail truncation for whole-file
 * reads. `setup()` is not run here (see `container-git-info-singleton.spec.ts`);
 * the registration helper it calls is exercised on a child container.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { TreeSitterCodeOutliner } from '@ptah-extension/vscode-lm-tools';
import { registerCodeOutliner } from './container';

describe('CLI DI — code outliner binding', () => {
  it('resolves SDK_CODE_OUTLINER to a TreeSitterCodeOutliner', () => {
    const c = rootContainer.createChildContainer();
    c.register(TOKENS.TREE_SITTER_PARSER_SERVICE, {
      useValue: { parse: jest.fn() },
    });
    registerCodeOutliner(c);

    expect(c.resolve(SDK_TOKENS.SDK_CODE_OUTLINER)).toBeInstanceOf(
      TreeSitterCodeOutliner,
    );
  });

  it('does not resolve the parser at registration time', () => {
    const c = rootContainer.createChildContainer();
    const resolve = jest.spyOn(c, 'resolve');

    registerCodeOutliner(c);

    expect(resolve).not.toHaveBeenCalled();
  });
});
