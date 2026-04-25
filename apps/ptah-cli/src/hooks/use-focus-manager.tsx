/**
 * useFocusManager -- Centralized focus stack for the TUI.
 *
 * Replaces the prop-drilled `isActive` pattern scattered across 16 `useInput`
 * call sites. Components register a focus scope id; only the scope at the
 * top of the stack receives keyboard input.
 *
 * Scopes are pushed when a component mounts into focus (or opens an overlay)
 * and popped when it unmounts or closes. Modal overlays automatically mask
 * background scopes by pushing onto the stack.
 *
 * Usage:
 *   // 1. Wrap the app in FocusProvider:
 *   <FocusProvider>...</FocusProvider>
 *
 *   // 2. In a component that needs keyboard input:
 *   const isActive = useFocusable('settings-panel');
 *   useInput(handler, { isActive });
 *
 *   // 3. In a modal/overlay:
 *   usePushFocus('permission-modal');  // auto-pushes on mount, pops on unmount
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type FocusScopeId = string;

interface FocusContextValue {
  stack: FocusScopeId[];
  push: (id: FocusScopeId) => void;
  pop: (id: FocusScopeId) => void;
  top: FocusScopeId | null;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export interface FocusProviderProps {
  /** Optional initial scope at the bottom of the stack (e.g., 'chat'). */
  initialScope?: FocusScopeId;
  children: React.ReactNode;
}

export function FocusProvider({
  initialScope,
  children,
}: FocusProviderProps): React.JSX.Element {
  const [stack, setStack] = useState<FocusScopeId[]>(
    initialScope ? [initialScope] : [],
  );

  const push = useCallback((id: FocusScopeId) => {
    setStack((prev) => {
      // Remove any existing occurrence and push to top.
      const filtered = prev.filter((s) => s !== id);
      return [...filtered, id];
    });
  }, []);

  const pop = useCallback((id: FocusScopeId) => {
    setStack((prev) => prev.filter((s) => s !== id));
  }, []);

  const value = useMemo<FocusContextValue>(
    () => ({
      stack,
      push,
      pop,
      top: stack.length > 0 ? (stack[stack.length - 1] ?? null) : null,
    }),
    [stack, push, pop],
  );

  return (
    <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
  );
}

function useFocusContext(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) {
    throw new Error(
      'useFocusManager hooks must be used inside <FocusProvider>',
    );
  }
  return ctx;
}

/**
 * Returns true if the given scope id is currently the top of the focus stack.
 * Components should pass this to `useInput` as `{ isActive }`.
 */
export function useFocusable(id: FocusScopeId): boolean {
  const { top } = useFocusContext();
  return top === id;
}

/**
 * Push a scope onto the focus stack for the lifetime of the component.
 * Pops automatically on unmount. Returns `isActive`.
 */
export function usePushFocus(id: FocusScopeId): boolean {
  const { push, pop, top } = useFocusContext();
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    push(idRef.current);
    const current = idRef.current;
    return () => {
      pop(current);
    };
  }, [push, pop]);

  return top === id;
}

/**
 * Imperative API for programmatic push/pop (e.g., when opening overlays
 * in response to events rather than via component mount).
 */
export function useFocusManager(): {
  push: (id: FocusScopeId) => void;
  pop: (id: FocusScopeId) => void;
  top: FocusScopeId | null;
  stack: readonly FocusScopeId[];
} {
  const ctx = useFocusContext();
  return {
    push: ctx.push,
    pop: ctx.pop,
    top: ctx.top,
    stack: ctx.stack,
  };
}
