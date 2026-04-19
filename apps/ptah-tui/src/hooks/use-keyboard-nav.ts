/**
 * useKeyboardNav -- Arrow/Home/End/Enter/Escape navigation for lists.
 *
 * Ports Angular's KeyboardNavigationService to React. Manages an activeIndex
 * bounded to [0, itemCount), handles wrap-around (optional), and wires
 * keyboard events via useInput.
 *
 * Usage:
 *   const { activeIndex, setActiveIndex } = useKeyboardNav({
 *     itemCount: items.length,
 *     isActive: isFocused,
 *     onSelect: (i) => handleSelect(items[i]),
 *     onEscape: () => handleDismiss(),
 *   });
 */

import { useCallback, useEffect, useState } from 'react';
import { useInput } from 'ink';

export interface UseKeyboardNavOptions {
  itemCount: number;
  /** Whether this nav handler is currently active (listens to keys). */
  isActive?: boolean;
  /** Initial active index. Defaults to 0. */
  initialIndex?: number;
  /** Wrap around when navigating past first/last. Defaults to false. */
  wrap?: boolean;
  /** Called when Enter is pressed on the active item. */
  onSelect?: (index: number) => void;
  /** Called when Escape is pressed. */
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

  // Clamp activeIndex if itemCount shrinks below it.
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
      if (itemCount === 0) return;

      if (key.upArrow) {
        setActiveIndexRaw((prev) => {
          if (prev > 0) return prev - 1;
          return wrap ? itemCount - 1 : prev;
        });
        return;
      }

      if (key.downArrow) {
        setActiveIndexRaw((prev) => {
          if (prev < itemCount - 1) return prev + 1;
          return wrap ? 0 : prev;
        });
        return;
      }

      if (key.pageUp) {
        setActiveIndexRaw((prev) => Math.max(0, prev - 10));
        return;
      }

      if (key.pageDown) {
        setActiveIndexRaw((prev) => Math.min(itemCount - 1, prev + 10));
        return;
      }

      if (key.return && onSelect) {
        onSelect(activeIndex);
        return;
      }

      if (key.escape && onEscape) {
        onEscape();
        return;
      }
    },
    { isActive },
  );

  return { activeIndex, setActiveIndex, reset };
}
