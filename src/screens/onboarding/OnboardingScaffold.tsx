/**
 * Shared layout for the onboarding screens: a safe-area canvas with a scrolling
 * content region and a footer pinned above the home indicator. Keeps the five
 * create-wallet screens visually consistent without repeating the plumbing.
 */
import {type ReactNode} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {BackLink} from '../../components';
import {darkColors, useTheme} from '../../theme';

export interface OnboardingScaffoldProps {
  /** Main content; fills the space above the footer. */
  children: ReactNode;
  /** Pinned action area at the bottom (typically buttons). */
  footer?: ReactNode;
  /** Center the content vertically (for short, focal screens). */
  center?: boolean;
  /**
   * Render on the dark "night" canvas regardless of the OS theme — the brand
   * moments (Welcome, generating). Forces a light-content status bar.
   */
  dark?: boolean;
  /**
   * Where the top-left back link goes — the same BackLink affordance the rest
   * of the app uses (see ScreenHeader/BackLink). Omit only for a screen that is
   * genuinely the bottom of its stack (Welcome) or must not be interrupted
   * (wallet generation in progress). Pinned above the scroll area so it stays
   * put even on centered screens.
   */
  onBack?: () => void;
  /** Back label; defaults to "Back". */
  backLabel?: string;
}

export function OnboardingScaffold({
  children,
  footer,
  center = false,
  dark = false,
  onBack,
  backLabel,
}: OnboardingScaffoldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bg = dark ? darkColors.bg : theme.colors.bg;

  return (
    <KeyboardAvoidingView
      style={[styles.fill, {backgroundColor: bg}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {dark && <StatusBar barStyle="light-content" backgroundColor={bg} />}
      {onBack !== undefined && (
        <View
          style={{
            paddingTop: insets.top + theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
          }}>
          <BackLink onPress={onBack} label={backLabel} />
        </View>
      )}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          center && styles.centered,
          {
            // With a back link above, the top gap is already spent on it.
            paddingTop:
              onBack !== undefined ? theme.spacing.md : insets.top + theme.spacing.xl,
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

const styles = StyleSheet.create({
  fill: {flex: 1},
  content: {flexGrow: 1},
  centered: {justifyContent: 'center'},
  footer: {},
});
