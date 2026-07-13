/**
 * Shared layout for the social-recovery screens: a safe-area canvas with an
 * optional back button + title/subtitle header, an optional four-step progress
 * indicator, a scrolling content region, and a footer pinned above the home
 * indicator. Mirrors the design system's `MSub` used by `Recovery.jsx`.
 */
import {type ReactNode} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Heading, Text} from '../../components';
import {useTheme} from '../../theme';

/** The four setup steps the progress dots track. */
const STEP_COUNT = 4;

export interface RecoveryScaffoldProps {
  title: string;
  subtitle?: string;
  /** Shows a back affordance in the header when provided. */
  onBack?: () => void;
  /**
   * Zero-based step (0 Choose · 1 Split · 2 Distribute · 3 Done) to light the
   * progress dots. Omit on the pre-flow screens (unlock, intro).
   */
  step?: number;
  children: ReactNode;
  footer?: ReactNode;
  /** Center the content vertically (short, focal screens). */
  center?: boolean;
}

export function RecoveryScaffold({
  title,
  subtitle,
  onBack,
  step,
  children,
  footer,
  center = false,
}: RecoveryScaffoldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={[styles.fill, {backgroundColor: theme.colors.bg}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}>
        {onBack !== undefined && (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={{marginBottom: theme.spacing.sm}}>
            <Text variant="body" color={theme.colors.primary}>
              ‹ Back
            </Text>
          </Pressable>
        )}
        <Heading level="headingMedium">{title}</Heading>
        {subtitle !== undefined && (
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={{marginTop: theme.spacing.xs}}>
            {subtitle}
          </Text>
        )}
        {step !== undefined && <StepDots current={step} />}
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          center && styles.centered,
          {
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>

      {footer !== undefined && (
        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.lg,
              gap: theme.spacing.sm,
            },
          ]}>
          {footer}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** A four-segment progress indicator; segments up to `current` are filled. */
function StepDots({current}: {current: number}) {
  const theme = useTheme();
  return (
    <View style={[styles.dots, {marginTop: theme.spacing.md}]}>
      {Array.from({length: STEP_COUNT}, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor:
                i <= current ? theme.colors.primary : theme.colors.surfaceSunken,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  content: {flexGrow: 1},
  centered: {justifyContent: 'center'},
  footer: {},
  dots: {flexDirection: 'row', gap: 6},
  dot: {flex: 1, height: 4, borderRadius: 2},
});
