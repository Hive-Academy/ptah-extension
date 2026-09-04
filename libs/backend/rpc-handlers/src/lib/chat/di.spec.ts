/**
 * `registerChatServices` — cross-lib registration precondition.
 *
 * `ChatSessionService` injects `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION`, which
 * `output-styles` owns rather than this lib, because the CLI-agent spawn path
 * needs the same composition and cannot import `rpc-handlers`.
 *
 * That makes the requirement CROSS-lib, and tsyringe resolves lazily: a host
 * that forgets `registerOutputStyleServices` boots clean and then throws on the
 * first message the user sends, in a stack that names neither function. These
 * specs pin the loud-at-bootstrap behaviour that replaces it.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import { OUTPUT_STYLE_TOKENS } from '@ptah-extension/output-styles';

// `di.ts` imports the chat services, one of which reaches `agent-generation`,
// whose barrel loads `workspace-intelligence`'s tree-sitter bootstrap and its
// `import.meta.url` — unparseable by this Jest transform. Only the DI token is
// needed; nothing here instantiates a service.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
    SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
  },
}));

import { registerChatServices, CHAT_TOKENS } from './di';
import { SessionMcpStatusRegistry } from './session/session-mcp-status.registry';

describe('registerChatServices — output-style precondition', () => {
  it('throws when registerOutputStyleServices has not run', () => {
    const c = rootContainer.createChildContainer();

    expect(() => registerChatServices(c)).toThrow(
      /registerOutputStyleServices/,
    );
  });

  it('names the token so the fix is obvious from the message alone', () => {
    const c = rootContainer.createChildContainer();

    expect(() => registerChatServices(c)).toThrow(/SESSION_ACTIVATION/);
  });

  it('registers the chat services once the precondition is met', () => {
    const c = rootContainer.createChildContainer();
    c.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });

    expect(() => registerChatServices(c)).not.toThrow();
    expect(c.isRegistered(CHAT_TOKENS.SESSION)).toBe(true);
  });

  it('accepts a registration inherited from a parent container', () => {
    const parent = rootContainer.createChildContainer();
    parent.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });

    // Hosts build child containers per workspace; the token is bound once on
    // the parent. `isRegistered(token, true)` is what makes this pass.
    expect(() =>
      registerChatServices(parent.createChildContainer()),
    ).not.toThrow();
  });
});

/**
 * TASK_2026_375 B4.3 — the MCP-status registry and its alias wiring.
 *
 * A fresh session streams under its tabId until the SDK reports the real UUID,
 * so without the re-key `session:status` would answer "nothing recorded" for
 * every session that ever had one.
 */
type ResolveSubscriber = (payload: {
  tabId: string | undefined;
  realSessionId: string;
}) => void;

describe('registerChatServices — SessionMcpStatusRegistry', () => {
  const SDK_SESSION_ID_RESOLVED = Symbol.for(
    'SdkSessionIdResolvedCallbackRegistry',
  );

  function makeContainer() {
    const c = rootContainer.createChildContainer();
    c.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });
    return c;
  }

  it('registers the registry as a singleton', () => {
    const c = makeContainer();
    registerChatServices(c);

    expect(c.isRegistered(CHAT_TOKENS.MCP_STATUS)).toBe(true);
    expect(c.resolve(CHAT_TOKENS.MCP_STATUS)).toBe(
      c.resolve(CHAT_TOKENS.MCP_STATUS),
    );
  });

  it('re-keys the record when the SDK reports the real session id', () => {
    const c = makeContainer();
    // Held in an array rather than a `let`: TypeScript's control-flow
    // analysis narrows a closure-assigned `let` to `never` at the call site.
    const subscribers: ResolveSubscriber[] = [];
    c.register(SDK_SESSION_ID_RESOLVED, {
      useValue: {
        register: (cb: ResolveSubscriber) => {
          subscribers.push(cb);
          return () => undefined;
        },
      },
    });
    registerChatServices(c);

    const registry = c.resolve<SessionMcpStatusRegistry>(
      CHAT_TOKENS.MCP_STATUS,
    );
    registry.recordServers('tab-1', [{ name: 'a', status: 'connected' }]);
    subscribers[0]?.({ tabId: 'tab-1', realSessionId: 'real-1' });

    expect(registry.get('tab-1')).toBeNull();
    expect(registry.get('real-1')?.servers).toEqual([
      { name: 'a', status: 'connected' },
    ]);
  });

  it('ignores a resolve event that carries no tabId — nothing to re-key', () => {
    const c = makeContainer();
    // Held in an array rather than a `let`: TypeScript's control-flow
    // analysis narrows a closure-assigned `let` to `never` at the call site.
    const subscribers: ResolveSubscriber[] = [];
    c.register(SDK_SESSION_ID_RESOLVED, {
      useValue: {
        register: (cb: ResolveSubscriber) => {
          subscribers.push(cb);
          return () => undefined;
        },
      },
    });
    registerChatServices(c);

    const registry = c.resolve<SessionMcpStatusRegistry>(
      CHAT_TOKENS.MCP_STATUS,
    );
    registry.recordServers('real-1', []);
    subscribers[0]?.({ tabId: undefined, realSessionId: 'real-1' });

    expect(registry.get('real-1')).not.toBeNull();
  });

  it('still registers when the resolve fan-out is absent — the host simply never re-keys', () => {
    const c = makeContainer();

    expect(() => registerChatServices(c)).not.toThrow();
    expect(c.isRegistered(CHAT_TOKENS.MCP_STATUS)).toBe(true);
  });
});
