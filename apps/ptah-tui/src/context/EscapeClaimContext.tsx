import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  NO_ESCAPE_CLAIMS,
  addEscapeClaim,
  isEscapeClaimed,
  removeEscapeClaim,
} from '../lib/escape-claims.js';

interface EscapeClaimApi {
  /** True while some surface owns the next Escape press. */
  readonly claimed: boolean;
  readonly claim: (id: string) => void;
  readonly release: (id: string) => void;
}

const EscapeClaimContext = createContext<EscapeClaimApi>({
  claimed: false,
  claim: () => undefined,
  release: () => undefined,
});

/**
 * Thin React shell over `lib/escape-claims.ts`. All the behaviour worth
 * testing lives in that module; this only wires it to a provider so a surface
 * nested anywhere under the shell can claim without a prop chain through
 * Layout and Sidebar.
 */
export function EscapeClaimProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [claims, setClaims] = useState(NO_ESCAPE_CLAIMS);

  const claim = useCallback((id: string) => {
    setClaims((prev) => addEscapeClaim(prev, id));
  }, []);
  const release = useCallback((id: string) => {
    setClaims((prev) => removeEscapeClaim(prev, id));
  }, []);

  const value = useMemo(
    (): EscapeClaimApi => ({
      claimed: isEscapeClaimed(claims),
      claim,
      release,
    }),
    [claims, claim, release],
  );

  return (
    <EscapeClaimContext.Provider value={value}>
      {children}
    </EscapeClaimContext.Provider>
  );
}

/** Read side, for the AppShell handler deciding whether this press is its own. */
export function useEscapeClaimed(): boolean {
  return useContext(EscapeClaimContext).claimed;
}

/**
 * Claim Escape for as long as `active` holds. Call it unconditionally at the
 * top of a component — the effect is what turns the claim on and off, so it
 * obeys the rules of hooks while still tracking transient state.
 */
export function useEscapeClaim(id: string, active: boolean): void {
  const { claim, release } = useContext(EscapeClaimContext);
  useEffect(() => {
    if (!active) return;
    claim(id);
    return () => release(id);
  }, [id, active, claim, release]);
}
