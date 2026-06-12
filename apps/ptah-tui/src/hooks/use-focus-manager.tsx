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

export function useFocusable(id: FocusScopeId): boolean {
  const { top } = useFocusContext();
  return top === id;
}

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