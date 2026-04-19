/**
 * UserQuestionPrompt -- Shows questions from the backend (AskUserQuestion).
 *
 * Supports two modes: vertical option selection (arrow keys + Enter) and
 * free-text input. Multiple questions are shown one at a time; answers are
 * collected and submitted when all are answered.
 *
 * Pushes a focus scope on mount so background handlers are suspended.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTheme } from '../../hooks/use-theme.js';
import { usePushFocus } from '../../hooks/use-focus-manager.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { KeyHint, Panel } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

interface QuestionItemShape {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

interface UserQuestionPromptProps {
  questions: QuestionItemShape[];
  onAnswer: (answers: Record<string, string>) => void;
}

export function UserQuestionPrompt({
  questions,
  onAnswer,
}: UserQuestionPromptProps): React.JSX.Element {
  const theme = useTheme();
  const isActive = usePushFocus('user-question-prompt');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [textValue, setTextValue] = useState('');

  const currentQuestion =
    currentIndex < questions.length ? questions[currentIndex] : undefined;

  const hasOptions =
    currentQuestion !== undefined && currentQuestion.options.length > 0;

  const advanceOrFinish = useCallback(
    (answer: string) => {
      const key = currentQuestion?.header ?? String(currentIndex);
      const updatedAnswers = { ...answers, [key]: answer };

      if (currentIndex + 1 >= questions.length) {
        onAnswer(updatedAnswers);
      } else {
        setAnswers(updatedAnswers);
        setCurrentIndex((prev) => prev + 1);
        setTextValue('');
      }
    },
    [answers, currentIndex, currentQuestion, onAnswer, questions.length],
  );

  const handleDismiss = useCallback(() => {
    const emptyAnswers: Record<string, string> = {};
    for (const q of questions) {
      emptyAnswers[q.header] = '';
    }
    onAnswer(emptyAnswers);
  }, [questions, onAnswer]);

  const { activeIndex, reset } = useKeyboardNav({
    itemCount: currentQuestion?.options.length ?? 0,
    isActive: isActive && hasOptions,
    wrap: true,
    onSelect: (i) => {
      const selected = currentQuestion?.options[i];
      if (selected) {
        advanceOrFinish(selected.label);
      }
    },
    onEscape: handleDismiss,
  });

  // Reset option cursor when advancing to the next question.
  React.useEffect(() => {
    reset();
  }, [currentIndex, reset]);

  // Escape for free-text mode (useKeyboardNav is inactive there).
  useInput(
    (_char, key) => {
      if (key.escape) {
        handleDismiss();
      }
    },
    { isActive: isActive && !hasOptions },
  );

  const handleTextSubmit = useCallback(
    (value: string) => {
      advanceOrFinish(value.trim() || '');
    },
    [advanceOrFinish],
  );

  if (!currentQuestion) {
    return (
      <Panel title="Question" isActive padding={1}>
        <Text dimColor>No questions to display.</Text>
      </Panel>
    );
  }

  const title =
    questions.length > 1
      ? `Question (${currentIndex + 1}/${questions.length})`
      : 'Question';

  return (
    <Panel title={title} isActive padding={1}>
      <Box flexDirection="column">
        <Text>{currentQuestion.question}</Text>

        {hasOptions ? (
          <Box flexDirection="column" marginTop={1}>
            {currentQuestion.options.map((opt, idx) => (
              <ListItem
                key={opt.label}
                label={opt.label}
                description={opt.description || undefined}
                isSelected={idx === activeIndex}
              />
            ))}
            <Box marginTop={1} gap={2}>
              <KeyHint keys="↑↓" label="navigate" />
              <KeyHint keys="Enter" label="select" />
              <KeyHint keys="Esc" label="dismiss" />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text color={theme.ui.accent} bold>
                {'> '}
              </Text>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleTextSubmit}
                placeholder="Type your answer... (Enter to submit)"
              />
            </Box>
            <Box marginTop={1} gap={2}>
              <KeyHint keys="Enter" label="submit" />
              <KeyHint keys="Esc" label="dismiss" />
            </Box>
          </Box>
        )}
      </Box>
    </Panel>
  );
}
