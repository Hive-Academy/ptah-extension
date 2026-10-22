import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  CloneSummary,
  SkillSynthesisListClonesParams,
  SkillSynthesisListClonesResult,
} from '@ptah-extension/shared';

import { useRpc } from '../../hooks/use-rpc.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import { describeLibraryEntry } from './skills-library.js';

interface SkillsPanelProps {
  isActive: boolean;
  degraded: boolean;
  reason?: string;
}


export function SkillsPanel({
  isActive,
  degraded,
  reason,
}: SkillsPanelProps): React.JSX.Element {
  const theme = useTheme();
  const { call } = useRpc();
  const [clones, setClones] = useState<CloneSummary[]>([]);
  const [loading, setLoading] = useState(!degraded);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const loadLibrary = useCallback(
    async (isCurrent: () => boolean): Promise<void> => {
      setLoading(true);
      setLoadError(false);
      const result = await call<
        SkillSynthesisListClonesParams,
        SkillSynthesisListClonesResult
      >('skillSynthesis:listClones', {});
      if (!isCurrent()) return;
      if (!result || !Array.isArray(result.clones)) {
        setLoadError(true);
      } else {
        setClones(result.clones);
      }
      setLoading(false);
    },
    [call],
  );

  useEffect(() => {
    if (degraded) return;
    let current = true;
    void loadLibrary(() => current);
    return () => {
      current = false;
    };
  }, [degraded, loadLibrary, refresh]);

  const { activeIndex } = useKeyboardNav({
    itemCount: clones.length,
    isActive: isActive && !degraded && !loading,
  });

  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (input.toLowerCase() === 'r') setRefresh((value) => value + 1);
    },
    { isActive: isActive && !degraded && !loading },
  );

  if (degraded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.status.warning}>
          Skills subsystem degraded{reason ? ` — ${reason}` : ''}.
        </Text>
        <Text dimColor>Chat remains available; skill features are paused.</Text>
      </Box>
    );
  }

  if (loading) return <Spinner label="Loading skills…" />;

  return (
    <Box flexDirection="column">
      <Text color={theme.ui.accent} bold>Skills Library</Text>
      <Text dimColor>Edit skills in the desktop app or VS Code.</Text>

      <Box marginTop={1} flexDirection="column">
        {loadError ? (
          <Text color={theme.status.error}>Could not load the Skills Library.</Text>
        ) : clones.length === 0 ? (
          <Text dimColor>No skills, agents, or commands in the Library.</Text>
        ) : (
          clones.map((clone, index) => (
            <ListItem
              key={`${clone.kind}:${clone.slug}`}
              label={clone.slug}
              description={describeLibraryEntry(clone)}
              isSelected={index === activeIndex && isActive}
              badge={<Badge variant="outline">{clone.kind}</Badge>}
            />
          ))
        )}
      </Box>

      <Box marginTop={1} gap={2}>
        <KeyHint keys="↑↓" label="navigate" />
        <KeyHint keys="R" label="refresh" />
      </Box>
    </Box>
  );
}

export default SkillsPanel;
