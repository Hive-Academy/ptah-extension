import { useCallback, useEffect, useState } from 'react';
import { useInput } from 'ink';

import { resolveNavAction } from './nav-actions.js';

export type { NavAction, NavKey } from './nav-actions.js';

export interface UseKeyboardNavOptions {
  itemCount: number;
  isActive?: boolean;
  initialIndex?: number;
  wrap?: boolean;
  onSelect?: (index: number) => void;
  onEscape?: () => void;
}

export interface UseKeyboardNavResult {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  reset: () => void;
}

export function useKeyboardNav({
  itemCount,
  isActive = true,
  initialIndex = 0,
  wrap = false,
  onSelect,
  onEscape,
}: UseKeyboardNavOptions): UseKeyboardNavResult {
  const [activeIndex, setActiveIndexRaw] = useState(initialIndex);

  useEffect(() => {
    if (itemCount === 0) {
      setActiveIndexRaw(0);
      return;
    }
    if (activeIndex >= itemCount) {
      setActiveIndexRaw(itemCount - 1);
    }
  }, [itemCount, activeIndex]);

  const setActiveIndex = useCallback(
    (index: number) => {
      if (itemCount === 0) {
        setActiveIndexRaw(0);
        return;
      }
      const clamped = Math.max(0, Math.min(itemCount - 1, index));
      setActiveIndexRaw(clamped);
    },
    [itemCount],
  );

  const reset = useCallback(() => {
    setActiveIndexRaw(initialIndex);
  }, [initialIndex]);

  useInput(
    (_input, key) => {
      const action = resolveNavAction(key, activeIndex, itemCount, wrap);
      switch (action.kind) {
        case 'escape':
          onEscape?.();
          return;
        case 'select':
          onSelect?.(activeIndex);
          return;
        case 'move':
          setActiveIndexRaw(action.index);
          return;
        default:
          return;
      }
    },
    { isActive },
  );

  return { activeIndex, setActiveIndex, reset };
}
