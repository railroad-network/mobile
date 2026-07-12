/**
 * Passphrase entry (T1.2.2): the user chooses the secret that encrypts their
 * wallet on this device. Entered twice and confirmed to match; a minimum
 * length is enforced with an explanation of why it matters; a strength meter
 * nudges toward stronger secrets.
 *
 * Security posture: autocorrect / autocapitalize / spellcheck are all disabled
 * and autofill is suppressed so the passphrase never enters the keyboard's
 * learned dictionary or the OS password store; it is masked by default with an
 * explicit reveal toggle.
 */
import {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {Button, Field, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';
import {
  estimateStrength,
  MIN_PASSPHRASE_LENGTH,
} from './passphraseStrength';

const STRENGTH_COLOR_KEY = ['danger', 'danger', 'warning', 'success'] as const;

export function Passphrase({navigation}: OnboardingScreenProps<'Passphrase'>) {
  const theme = useTheme();
  const {setPassphrase} = useOnboarding();

  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [reveal, setReveal] = useState(false);

  const tooShort = p1.length > 0 && p1.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = p2.length > 0 && p1 !== p2;
  const canContinue = p1.length >= MIN_PASSPHRASE_LENGTH && p1 === p2;
  const strength = estimateStrength(p1);
  const strengthColor = theme.colors[STRENGTH_COLOR_KEY[strength.level]];

  const secureProps = {
    secureTextEntry: !reveal,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    spellCheck: false,
    autoComplete: 'off' as const,
    textContentType: 'none' as const,
    importantForAutofill: 'no' as const,
  };

  const revealToggle = (
    <Pressable
      onPress={() => setReveal(v => !v)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={reveal ? 'Hide passphrase' : 'Show passphrase'}>
      <Text variant="label" color={theme.colors.textLink}>
        {reveal ? 'Hide' : 'Show'}
      </Text>
    </Pressable>
  );

  function onContinue() {
    setPassphrase(p1);
    navigation.navigate('BiometricSetup');
  }

  return (
    <OnboardingScaffold
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={onContinue}>
          Continue
        </Button>
      }>
      <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
        Set a passphrase
      </Heading>
      <Text
        variant="body"
        color={theme.colors.textSecondary}
        style={{marginBottom: theme.spacing.lg}}>
        This encrypts your wallet on this device. Use at least{' '}
        {MIN_PASSPHRASE_LENGTH} characters.{' '}
        <Text variant="body" color={theme.colors.text}>
          If you lose it, only social recovery can get you back in.
        </Text>
      </Text>

      <View style={{gap: theme.spacing.lg}}>
        <Field
          label="Passphrase"
          value={p1}
          onChangeText={setP1}
          placeholder="••••••••••••"
          suffix={revealToggle}
          error={tooShort ? `At least ${MIN_PASSPHRASE_LENGTH} characters` : undefined}
          {...secureProps}
        />

        {p1.length >= MIN_PASSPHRASE_LENGTH && (
          <View style={{marginTop: -theme.spacing.sm, gap: theme.spacing.xs}}>
            <View style={styles.meter} accessibilityElementsHidden>
              {[0, 1, 2].map(i => (
                <View
                  key={i}
                  style={[
                    styles.meterSegment,
                    {
                      backgroundColor:
                        i < strength.level ? strengthColor : theme.colors.border,
                    },
                  ]}
                />
              ))}
            </View>
            <Text
              variant="label"
              color={strengthColor}
              accessibilityLabel={`Passphrase strength: ${strength.label}`}>
              {strength.label}
            </Text>
          </View>
        )}

        <Field
          label="Confirm passphrase"
          value={p2}
          onChangeText={setP2}
          placeholder="••••••••••••"
          error={mismatch ? "Passphrases don't match" : undefined}
          {...secureProps}
        />
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  meter: {
    flexDirection: 'row',
    gap: 5,
  },
  meterSegment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
});
