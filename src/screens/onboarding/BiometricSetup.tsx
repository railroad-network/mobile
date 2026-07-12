/**
 * Biometric unlock opt-in (T1.2.2). Strictly a convenience layer: the wallet is
 * created either way, and the passphrase is always required for sensitive
 * actions. Enabling here only records the user's preference; the biometric gate
 * itself is applied to the keychain entry when the wallet is saved
 * (GenerateWallet → createWallet → SecureStore).
 *
 * If the device has no enrolled biometrics, the screen degrades to a single
 * "Continue" — there is nothing to opt into.
 */
import {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

/** A friendly name for the device's biometric method. */
function biometryLabel(type: Keychain.BIOMETRY_TYPE | null): string {
  switch (type) {
    case Keychain.BIOMETRY_TYPE.FACE_ID:
      return 'Face ID';
    case Keychain.BIOMETRY_TYPE.TOUCH_ID:
      return 'Touch ID';
    case Keychain.BIOMETRY_TYPE.OPTIC_ID:
      return 'Optic ID';
    case Keychain.BIOMETRY_TYPE.FACE:
      return 'face unlock';
    case Keychain.BIOMETRY_TYPE.IRIS:
      return 'iris unlock';
    case Keychain.BIOMETRY_TYPE.FINGERPRINT:
      return 'fingerprint unlock';
    default:
      return 'biometric unlock';
  }
}

export function BiometricSetup({
  navigation,
}: OnboardingScreenProps<'BiometricSetup'>) {
  const theme = useTheme();
  const {setBiometricEnabled} = useOnboarding();

  // `undefined` while we're still checking; `null` when unsupported.
  const [biometryType, setBiometryType] = useState<
    Keychain.BIOMETRY_TYPE | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    Keychain.getSupportedBiometryType()
      .then(type => {
        if (!cancelled) setBiometryType(type);
      })
      .catch(() => {
        if (!cancelled) setBiometryType(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function proceed(enabled: boolean) {
    setBiometricEnabled(enabled);
    navigation.navigate('GenerateWallet');
  }

  const supported = biometryType != null;
  const label = biometryLabel(biometryType ?? null);

  return (
    <OnboardingScaffold
      center
      footer={
        supported ? (
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => proceed(true)}>
              {`Enable ${label}`}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onPress={() => proceed(false)}>
              Not now
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => proceed(false)}>
            Continue
          </Button>
        )
      }>
      <View style={styles.body}>
        <View style={[styles.mark, {backgroundColor: theme.colors.primaryTint}]}>
          <Text style={[styles.markGlyph, {color: theme.colors.primary}]}>
            {supported ? '⛨' : '🔒'}
          </Text>
        </View>
        <Heading
          level="headingMedium"
          style={[styles.centerText, {marginBottom: theme.spacing.sm}]}>
          {supported ? `Unlock with ${label}` : 'Passphrase unlock'}
        </Heading>
        <Text
          variant="body"
          color={theme.colors.textSecondary}
          style={styles.centerText}>
          {supported
            ? `Skip typing your passphrase every time. Your passphrase still works as a backup, and is always required for sensitive actions.`
            : `This device has no biometrics set up, so you'll use your passphrase to unlock. You can enable biometrics later from Settings.`}
        </Text>
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
  },
  mark: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  markGlyph: {
    fontSize: 44,
    lineHeight: 52,
  },
  centerText: {
    textAlign: 'center',
  },
});
