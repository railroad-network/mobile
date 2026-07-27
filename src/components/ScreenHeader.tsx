/**
 * ScreenHeader — the title block every pushed screen opens with: a back link,
 * the screen's title, and an optional line of explanation.
 *
 * This existed as copy-pasted markup on fifteen screens (three of them with
 * byte-identical local `Header` components), and the copying is what let
 * VouchList ship with no back link at all — reachable from Community, pushed
 * over the tabs, with the OS gesture as the only way out. A shared component
 * makes that omission visible: a pushed screen without `onBack` now reads as a
 * deliberate choice rather than an oversight.
 *
 * Tab roots (Home, Send, Community, History, Settings) and Lock legitimately
 * have no back affordance — they are the bottom of the stack — so `onBack` is
 * optional and the title block renders fine without it.
 */
import {Pressable, StyleSheet, View} from 'react-native';

import {useTheme} from '../theme';
import {Heading} from './Heading';
import {Text} from './Text';

export interface BackLinkProps {
  /** Usually `() => navigation.goBack()`. */
  onPress: () => void;
  /** Word after the chevron, and the accessibility label. Defaults to "Back". */
  label?: string;
}

/**
 * The "‹ Back" link on its own, for a screen whose layout puts it somewhere
 * other than above a title (see ConfirmReceived's step screens).
 *
 * A `Pressable` with `hitSlop` rather than a pressable `Text`: the link is one
 * short line of body text, which is a small target to hit accurately, and the
 * slop costs nothing visually. Two screens already did it this way; this makes
 * it the rule.
 */
export function BackLink({onPress, label = 'Back'}: BackLinkProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}>
      <Text variant="body" color={theme.colors.primary}>
        ‹ {label}
      </Text>
    </Pressable>
  );
}

export interface ScreenHeaderProps {
  /** The screen's title. */
  title: string;
  /** One line of explanation under the title. */
  subtitle?: string;
  /**
   * Where back goes. Omit **only** for a tab root or another screen that is
   * genuinely the bottom of its stack — anything pushed needs a way out.
   */
  onBack?: () => void;
  /** Back label; defaults to "Back". */
  backLabel?: string;
}

export function ScreenHeader({title, subtitle, onBack, backLabel}: ScreenHeaderProps) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      {onBack !== undefined && <BackLink onPress={onBack} label={backLabel} />}
      <Heading level="headingLarge">{title}</Heading>
      {subtitle !== undefined && (
        <Text variant="body" color={theme.colors.textSecondary}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // theme.spacing.xs — the block is tight on purpose; the surrounding screen
  // supplies the larger gap to whatever follows.
  block: {gap: 4},
});
