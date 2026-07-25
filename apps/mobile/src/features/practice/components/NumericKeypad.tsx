/**
 * On-screen numeric entry for numeric-response questions.
 *
 * Every key emits an ASCII codepoint, unconditionally. A device set to a
 * Devanagari, Bengali or Arabic-Indic numeral locale renders its own digits on
 * the system keyboard, and a student entering "१२.५" is entering a value the
 * naive comparator will not match. The scoring engine normalises those forms
 * anyway (they map to ASCII before parsing), but the value stored verbatim
 * should be what the student meant, and the on-screen path should never be the
 * thing that introduces the ambiguity.
 *
 * There is no calculator, in any mode. The examinations this app prepares for
 * do not permit one, and a practice surface that provides one trains a habit
 * that costs marks on the day.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useColors } from '../../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../../theme/tokens.js';
import { Text } from '../../../components/ui/Text.js';

const KEYS: readonly (readonly string[])[] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['-', '0', '.'],
];

const SPOKEN: Readonly<Record<string, string>> = {
  '-': 'minus sign',
  '.': 'decimal point',
};

export interface NumericKeypadProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean;
}

function appendKey(current: string, key: string): string {
  if (key === '-') {
    // A leading minus toggles rather than accumulating. "--5" is not a value any
    // student intends and rejecting it later is worse than not creating it.
    return current.startsWith('-') ? current.slice(1) : `-${current}`;
  }
  if (key === '.' && current.includes('.')) return current;
  return current + key;
}

export function NumericKeypad(props: NumericKeypadProps): ReactNode {
  const colors = useColors();
  const disabled = props.disabled ?? false;

  const press = (key: string): void => {
    props.onChange(appendKey(props.value, key));
  };

  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Numeric keypad">
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={props.value === '' ? 'No value entered' : `Entered ${props.value}`}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          justifyContent: 'center',
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Text variant="mono">{props.value === '' ? ' ' : props.value}</Text>
      </View>

      {KEYS.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row', gap: space.sm }}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={SPOKEN[key] ?? key}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => {
                press(key);
              }}
              style={{
                flex: 1,
                minHeight: MIN_TOUCH_TARGET,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <Text variant="title">{key}</Text>
            </Pressable>
          ))}
        </View>
      ))}

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete last character"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            props.onChange(props.value.slice(0, -1));
          }}
          style={{
            flex: 1,
            minHeight: MIN_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text variant="bodyStrong">Delete</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear the entered value"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            props.onChange('');
          }}
          style={{
            flex: 1,
            minHeight: MIN_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text variant="bodyStrong">Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}
