/**
 * UserQuestionPrompt -- Shows questions from the backend (e.g., AskUserQuestion tool).
 *
 * TASK_2025_263 Batch 4
 *
 * Supports two modes:
 *   1. Option selection: vertical list with arrow key navigation and Enter to select
 *   2. Free-text input: ink-text-input for open-ended answers
 *
 * When multiple questions are provided, they are shown one at a time.
 * After all questions are answered, onAnswer is called with the collected answers.
 *
 * Keyboard:
 *   Up/Down - Navigate options
 *   Enter - Select option / Submit text
 *   Escape - Dismiss with empty answers
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

/** Simplified question shape matching QuestionItem from shared types */
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
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
        // All questions answered
        onAnswer(updatedAnswers);
      } else {
        setAnswers(updatedAnswers);
        setCurrentIndex((prev) => prev + 1);
        setSelectedOptionIndex(0);
        setTextValue('');
      }
    },
    [answers, currentIndex, currentQuestion, onAnswer, questions.length],
  );

  // Handle keyboard for option selection mode
  useInput(
    (char, key) => {
      if (key.escape) {
        // Dismiss with empty answers
        const emptyAnswers: Record<string, string> = {};
        for (const q of questions) {
          emptyAnswers[q.header] = '';
        }
        onAnswer(emptyAnswers);
        return;
      }

      if (!hasOptions) return;

      const optionCount = currentQuestion.options.length;
      if (key.upArrow) {
        setSelectedOptionIndex((prev) =>
          prev > 0 ? prev - 1 : optionCount - 1,
        );
      } else if (key.downArrow) {
        setSelectedOptionIndex((prev) =>
          prev < optionCount - 1 ? prev + 1 : 0,
        );
      } else if (key.return) {
        const selected = currentQuestion.options[selectedOptionIndex];
        if (selected) {
          advanceOrFinish(selected.label);
        }
      }
    },
    { isActive: currentQuestion !== undefined },
  );

  // Handle free-text submission
  const handleTextSubmit = useCallback(
    (value: string) => {
      advanceOrFinish(value.trim() || '');
    },
    [advanceOrFinish],
  );

  if (!currentQuestion) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No questions to display.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Question
        {questions.length > 1
          ? ` (${currentIndex + 1}/${questions.length})`
          : ''}
      </Text>
      <Box marginTop={1}>
        <Text>{currentQuestion.question}</Text>
      </Box>
      {hasOptions ? (
        <Box flexDirection="column" marginTop={1}>
          {currentQuestion.options.map((opt, idx) => {
            const isSelected = idx === selectedOptionIndex;
            return (
              <Box key={opt.label}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '> ' : '  '}
                  {opt.label}
                </Text>
                {opt.description ? (
                  <Text dimColor> — {opt.description}</Text>
                ) : null}
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>
              Use Up/Down to navigate, Enter to select, Escape to dismiss
            </Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="cyan" bold>
              {'> '}
            </Text>
            <TextInput
              value={textValue}
              onChange={setTextValue}
              onSubmit={handleTextSubmit}
              placeholder="Type your answer... (Enter to submit)"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to submit, Escape to dismiss</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
