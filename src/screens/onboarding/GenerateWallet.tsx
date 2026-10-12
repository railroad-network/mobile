/**
 * Wallet generation (T1.2.2). On entry this actually creates the identity:
 * generates the Ed25519 keypair via the Rust FFI, seals it under the chosen
 * passphrase, and stores the encrypted bytes in the OS secure store (with a
 * biometric gate if the user opted in). A brief progress indicator covers the
 * work, then it advances to WalletReady.
 *
 * The passphrase is wiped from onboarding state once sealing succeeds, and the
 * stack is reset to WalletReady so the screens that held it are unmounted and
 * cannot be revisited.
 *
 * It never writes over a wallet already on the device and never seals under a
 * passphrase that is no longer in memory: either condition stops it before any
 * key is minted or stored (the wallet layer refuses both as well).
 */
import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {usePreventRemove} from '@react-navigation/native';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {
  createWallet,
  hasWallet,
  MIN_PASSPHRASE_LENGTH,
  persistWallet,
  WalletExistsError,
  type Wallet,
} from '../../wallet/Wallet';
import {useWalletSession} from '../../wallet/WalletSession';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

const CREATE_STEPS = [
  'Generating your keypair',
  'Encrypting with your passphrase',
  'Storing securely on device',
];

// The recover path already holds the rebuilt identity; the work here is the
// (slow) seal under the new device passphrase and the keychain write.
const RESTORE_STEPS = [
  'Sealing with your new passphrase',
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

/**
 * Why this screen stopped. `no-passphrase` and `exists` are not retryable here:
 * the first starts onboarding over, the second opens the wallet already stored.
 */
type Failure =
  | {kind: 'no-passphrase'}
  | {kind: 'exists'}
  | {kind: 'error'; message: string};

const NO_PASSPHRASE_MESSAGE =
  'Your passphrase is no longer in memory. Go back and choose it again.';
const EXISTS_MESSAGE = 'A wallet already exists on this device.';

export function GenerateWallet({
  navigation,
}: OnboardingScreenProps<'GenerateWallet'>) {
  const theme = useTheme();
  const {
    passphrase,
    biometricEnabled,
    recoveredWallet,
    setCreatedAddress,
    setCreatedWallet,
    clearSecrets,
  } = useOnboarding();
  const {refresh} = useWalletSession();
  // A recovered/imported identity is a truthy handle; treat both null and a
  // partial context (undefined) as the ordinary create path.
  const restoring = Boolean(recoveredWallet);
  const [error, setError] = useState<Failure | null>(null);
  // Flips once the wallet is sealed and stored; releases the Back guard below so
  // the reset to WalletReady can go through.
  const [finished, setFinished] = useState(false);
  // Guards against the effect running twice (React strict-mode double invoke /
  // re-render) and creating two wallets.
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  // While the seal runs, Back (the Android system button included — the stack's
  // `gestureEnabled: false` covers only the iOS swipe) is ignored: leaving here
  // mid-seal would strand a half-finished write, and re-entering would find the
  // passphrase gone. Released on success and on any error.
  usePreventRemove(!finished && error === null, () => {});

  // Reset rather than replace, so nothing beneath WalletReady — the screens that
  // held the passphrase — can be returned to. Runs after the render in which
  // `finished` released the Back guard; a reset dispatched while the guard is
  // still registered would be swallowed by it.
  useEffect(() => {
    if (!finished) return;
    navigation.reset({index: 0, routes: [{name: 'WalletReady'}]});
  }, [finished, navigation]);

  useEffect(() => {
    // Create exactly once. The ref (not a cleanup flag) is what dedups here:
    // wallet creation writes to the keychain, so it must never run twice — and
    // a strict-mode unmount/remount must not drop the single result either.
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        // Reaching here without the passphrase (it is wiped after a successful
        // seal) means the flow was re-entered; sealing under what is left would
        // lock the member out. Start over instead of calling the wallet layer.
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
          setError({kind: 'no-passphrase'});
          return;
        }
        // Never write over an identity already on this device — checked before
        // any write this screen makes.
        if (await hasWallet()) {
          setError({kind: 'exists'});
          return;
        }
        // Let the navigation transition finish and this screen paint before the
        // (JS-thread-blocking) seal starts — see PRE_PAINT_MS. Otherwise the seal
        // freezes the previous screen in place and this one flashes by afterward.
        await delay(PRE_PAINT_MS);
        const startedAt = Date.now();
        // On the recover path the identity already exists (reconstructed from a
        // circle or opened from an export) — seal *that* under the new device
        // passphrase rather than minting a fresh keypair. Either way the write is
        // the same keychain-backed, passphrase-sealed store.
        let wallet: Wallet;
        if (recoveredWallet) {
          await persistWallet(recoveredWallet, passphrase, undefined, {
            requireBiometric: biometricEnabled,
          });
          wallet = recoveredWallet;
        } else {
          wallet = await createWallet(passphrase, undefined, {
            requireBiometric: biometricEnabled,
          });
        }
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
        setFinished(true);
      } catch (e) {
        if (e instanceof WalletExistsError) {
          setError({kind: 'exists'});
          return;
        }
        const fallback = restoring
          ? 'Could not restore your wallet.'
          : 'Could not create your wallet.';
        setError({
          kind: 'error',
          message: e instanceof Error ? e.message : fallback,
        });
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

  function startOver() {
    navigation.reset({index: 0, routes: [{name: 'Welcome'}]});
  }

  if (error !== null) {
    const message =
      error.kind === 'no-passphrase'
        ? NO_PASSPHRASE_MESSAGE
        : error.kind === 'exists'
          ? EXISTS_MESSAGE
          : error.message;
    // An existing wallet is opened, not retried over: refreshing the session
    // routes the root navigator to the lock screen for it.
    const footer =
      error.kind === 'no-passphrase' ? (
        <Button variant="primary" size="lg" fullWidth onPress={startOver}>
          Start over
        </Button>
      ) : error.kind === 'exists' ? (
        <Button variant="primary" size="lg" fullWidth onPress={() => refresh()}>
          Open it
        </Button>
      ) : (
        <Button variant="primary" size="lg" fullWidth onPress={retry}>
          Try again
        </Button>
      );
    return (
      <OnboardingScaffold
        center
        onBack={error.kind === 'error' ? () => navigation.goBack() : undefined}
        footer={footer}>
        <View style={styles.center}>
          <Heading
            level="headingSmall"
            color={error.kind === 'exists' ? undefined : theme.colors.danger}
            style={[styles.centerText, {marginBottom: theme.spacing.sm}]}>
            {error.kind === 'exists'
              ? 'This device already has a wallet'
              : 'Something went wrong'}
          </Heading>
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={styles.centerText}>
            {message}
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
          {restoring ? 'Restoring your wallet' : 'Creating your identity'}
        </Heading>
        <View style={[styles.steps, {gap: theme.spacing.md}]}>
          {(restoring ? RESTORE_STEPS : CREATE_STEPS).map(step => (
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
