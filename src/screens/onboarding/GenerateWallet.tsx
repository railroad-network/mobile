/**
 * Wallet generation (T1.2.2). On entry this actually creates the identity:
 * generates the Ed25519 keypair via the Rust FFI, seals it under the chosen
 * passphrase, and stores the encrypted bytes in the OS secure store (with a
 * biometric gate if the user opted in). A brief progress indicator covers the
 * work, then it advances to WalletReady.
 *
 * The passphrase is wiped from onboarding state the moment sealing succeeds.
 */
import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {createWallet} from '../../wallet/Wallet';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

const STEPS = [
  'Generating your keypair',
  'Encrypting with your passphrase',
  'Storing securely on device',
];

/**
 * Wallet creation's fast parts (keygen, keychain write) can finish in well under
 * a second, which reads as a flicker rather than as the app having done something
 * consequential. Hold this screen for at least this long so the progress state is
 * legible. (The passphrase seal — Argon2id — takes a few seconds on its own, so on
 * the non-biometric path the screen is already shown at least that long; this
 * floor mainly governs the biometric path, where the seal happens behind the OS
 * prompt, and any future fast-KDF build.)
 */
const MIN_VISIBLE_MS = 3500;

/**
 * How long to wait after this screen mounts before kicking off wallet creation.
 * The passphrase seal (Argon2id) is a *synchronous* FFI call that ties up the JS
 * thread for a few seconds; if we start it immediately, the navigation transition
 * into this screen has not finished painting, so the JS thread freezes with the
 * *previous* screen still on-screen and "Creating your identity" only appears for
 * a blink afterward. This pause lets the transition complete and this screen paint
 * first, so it's the one frozen in place while the seal runs. It must comfortably
 * exceed the stack transition (~350ms on Android).
 */
const PRE_PAINT_MS = 700;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function GenerateWallet({
  navigation,
}: OnboardingScreenProps<'GenerateWallet'>) {
  const theme = useTheme();
  const {passphrase, biometricEnabled, setCreatedAddress, setCreatedWallet, clearSecrets} =
    useOnboarding();
  const [error, setError] = useState<string | null>(null);
  // Guards against the effect running twice (React strict-mode double invoke /
  // re-render) and creating two wallets.
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Create exactly once. The ref (not a cleanup flag) is what dedups here:
    // wallet creation writes to the keychain, so it must never run twice — and
    // a strict-mode unmount/remount must not drop the single result either.
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        // Let the navigation transition finish and this screen paint before the
        // (JS-thread-blocking) seal starts — see PRE_PAINT_MS. Otherwise the seal
        // freezes the previous screen in place and this one flashes by afterward.
        await delay(PRE_PAINT_MS);
        const startedAt = Date.now();
        const wallet = await createWallet(passphrase, undefined, {
          requireBiometric: biometricEnabled,
        });
        // When biometric is enabled, createWallet's keychain write puts up an OS
        // prompt that covers this screen, so the seconds the user spent
        // authenticating were not spent looking at the progress UI. Measure the
        // minimum-visible window from *after* that work (and its prompt) finishes
        // so the screen is legible once they're back — otherwise the budget is
        // consumed while the screen is hidden and it flashes past on return.
        // Without biometric there is no prompt: the pre-paint above put this screen
        // on-screen and the seal then freezes *it* in place, so it is genuinely
        // visible throughout — time it from mount and top up to the floor.
        const visibleSince = biometricEnabled ? Date.now() : startedAt;
        setCreatedAddress(wallet.address);
        // Keep the unlocked handle so the last onboarding screen can hand it to
        // the session — a new user should not have to re-unlock what they just
        // created. The passphrase (the actual secret) is still wiped below.
        setCreatedWallet(wallet);
        clearSecrets();
        // Only the success path is padded; an error should surface immediately.
        await delay(MIN_VISIBLE_MS - (Date.now() - visibleSince));
        navigation.replace('WalletReady');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create your wallet.');
      }
    })();
    // `attempt` re-arms the effect on retry; other deps are stable for the
    // lifetime of the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function retry() {
    setError(null);
    startedRef.current = false;
    setAttempt(a => a + 1);
  }

  if (error !== null) {
    return (
      <OnboardingScaffold
        center
        footer={
          <Button variant="primary" size="lg" fullWidth onPress={retry}>
            Try again
          </Button>
        }>
        <View style={styles.center}>
          <Heading
            level="headingSmall"
            color={theme.colors.danger}
            style={[styles.centerText, {marginBottom: theme.spacing.sm}]}>
            Something went wrong
          </Heading>
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={styles.centerText}>
            {error}
          </Text>
        </View>
      </OnboardingScaffold>
    );
  }

  return (
    <OnboardingScaffold center>
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
          style={{marginBottom: theme.spacing.xl}}
        />
        <Heading
          level="headingMedium"
          style={[styles.centerText, {marginBottom: theme.spacing.lg}]}>
          Creating your identity
        </Heading>
        <View style={[styles.steps, {gap: theme.spacing.md}]}>
          {STEPS.map(step => (
            <View key={step} style={styles.step}>
              <View
                style={[styles.dot, {backgroundColor: theme.colors.primary}]}
              />
              <Text variant="body" color={theme.colors.textSecondary}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  steps: {
    alignSelf: 'stretch',
  },
  centerText: {
    textAlign: 'center',
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
