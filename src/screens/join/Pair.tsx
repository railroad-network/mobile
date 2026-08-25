/**
 * Pair with a station (T1.3.3), step two of joining a community.
 *
 * The station chosen on {@link Find} (or typed by hand) arrives here as a route
 * param; nothing about it is trusted yet. Pairing is the in-person step that
 * changes that, per ADR-0008: the app signs a request with the wallet key, the
 * station signs back, and both derive the same 8-hex code from the two public
 * keys. The user compares that code against the one the operator reads from
 * `station pair-mobile`. Only if they match — and only when the user says so —
 * does the app remember the station. A network attacker would have to present
 * its own key, which changes the code, so the human comparison is the actual
 * security boundary; the transport underneath is plain HTTP by design.
 *
 * Signing needs the wallet secret, so — as in Send — the wallet is re-opened
 * here with the passphrase (the OS biometric prompt fires on the keychain read).
 * When this flow was reached from onboarding (`origin === 'onboarding'`) the app
 * is not unlocked yet, so the wallet opened here is also what enters the app:
 * the final step adopts it, mirroring the recovery flow's hand-off.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  ScreenHeader,
  StationAvatar,
  Text,
} from '../../components';
import {useTheme} from '../../theme';
import type {JoinScreenProps, MainStackParamList} from '../../navigation/types';
import {requestPairing, type PairingFailure} from '../../network/Pairing';
import {addPairedStation} from '../../network/pairedStation';
import {loadWallet, type Wallet} from '../../wallet/Wallet';
import {useWalletSession} from '../../wallet/WalletSession';

type Step = 'unlock' | 'confirm' | 'paired';

/** What a station's typed rejection means for the user, in plain language. */
function failureMessage(failure: PairingFailure): string {
  switch (failure.error) {
    case 'network':
      return 'Couldn’t reach the station. Check that you’re on the same Wi‑Fi and that it’s switched on, then try again.';
    case 'rejected':
      // The station reached us and declined — show its own short reason.
      return `The station turned down the request: ${failure.detail}`;
    case 'malformed':
      return 'That address answered, but not like a Railroad station. Double‑check you picked the right one.';
    case 'unverified':
      // Security-relevant: something answered that cannot prove its identity.
      return 'Couldn’t verify that station — its reply didn’t prove it holds its identity key. Don’t pair with it.';
  }
}

export function Pair({navigation, route}: JoinScreenProps<'Pair'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {station, origin} = route.params;
  const {adopt, refresh} = useWalletSession();

  const [step, setStep] = useState<Step>('unlock');
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set once the handshake succeeds; drives the confirm step.
  const [sas, setSas] = useState('');
  const [stationAddress, setStationAddress] = useState('');
  // Held across the confirm step so an onboarding pair can adopt it into the app
  // without a second unlock. Discarded on unmount; the app already holds the
  // wallet for the whole session once adopted.
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const onboarding = origin === 'onboarding';

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  async function unlockAndPair() {
    if (passphrase.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opened = await loadWallet(passphrase);
      if (opened === null) {
        setError('No wallet found on this device.');
        return;
      }
      const result = await requestPairing(station, opened);
      if (!result.ok) {
        setError(failureMessage(result));
        return;
      }
      setWallet(opened);
      setSas(result.sas);
      setStationAddress(result.stationAddress);
      setPassphrase('');
      setStep('confirm');
    } catch {
      // A wrong passphrase or a cancelled biometric prompt both land here; we
      // never say which, and never leak the exception text. Name which
      // passphrase, since entering the station's here is a common mix-up.
      setError(
        'That didn’t unlock your wallet. Enter your wallet passphrase — the one you unlock this app with, not the station’s.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmPairing() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addPairedStation({
        address: stationAddress,
        host: station.host,
        port: station.port,
        pairedAt: Math.floor(Date.now() / 1000),
        // Cosmetic label for the paired list — the address is the identity.
        name: station.name,
      });
      setStep('paired');
    } catch {
      setError('Couldn’t save the pairing. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Leave the flow once paired. From onboarding this is the app hand-off:
  // adopting the wallet flips the root navigator to the unlocked app (the
  // onboarding stack unmounts, so no navigation is needed). From settings the
  // app is already unlocked — return to the tabs.
  function finish() {
    if (onboarding) {
      if (wallet !== null) {
        adopt(wallet);
      } else {
        // The wallet was opened during the unlock step, so this fallback is only
        // for a lost handle; the lock screen then asks for the passphrase.
        refresh();
      }
      return;
    }
    navigation
      .getParent<NativeStackNavigationProp<MainStackParamList>>()
      ?.navigate('Tabs', {screen: 'Settings'});
  }

  // Step: unlock -------------------------------------------------------------
  if (step === 'unlock') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <ScreenHeader
          title="Pair with station"
          subtitle={`Confirm it’s you to pair with ${station.name}.`}
          onBack={() => navigation.goBack()}
        />
        <Card style={styles.stationHeader}>
          <StationAvatar size={44} radius={12} />
          <View style={styles.stationText}>
            <Text variant="label" color={theme.colors.textSecondary}>
              Station
            </Text>
            <Text variant="body" color={theme.colors.text} numberOfLines={1}>
              {station.name}
            </Text>
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              ellipsizeMode="middle">
              {station.host}:{station.port}
            </Text>
          </View>
        </Card>
        {error !== null ? (
          <Banner variant="warning" title="Couldn’t pair">
            {error}
          </Banner>
        ) : null}
        <Field
          label="Your wallet passphrase"
          hint="The one you unlock this app with — not the station’s."
          value={passphrase}
          onChangeText={t => {
            setPassphrase(t);
            if (error !== null) setError(null);
          }}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          onSubmitEditing={unlockAndPair}
          returnKeyType="go"
          suffix={
            <Text
              variant="label"
              color={theme.colors.primary}
              onPress={() => setShowPass(s => !s)}
              accessibilityRole="button"
              accessibilityLabel={showPass ? 'Hide passphrase' : 'Show passphrase'}>
              {showPass ? 'Hide' : 'Show'}
            </Text>
          }
        />
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={passphrase.length === 0}
          onPress={unlockAndPair}>
          Contact station
        </Button>
      </ScrollView>
    );
  }

  // Step: confirm the code ---------------------------------------------------
  if (step === 'confirm') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <ScreenHeader title="Check the code" />
        <Text variant="body" color={theme.colors.textSecondary}>
          On the station, the operator runs{' '}
          <Text variant="mono" color={theme.colors.text}>
            station pair-mobile
          </Text>{' '}
          and reads out a code. It should match this one exactly:
        </Text>
        <Card style={styles.sasCard}>
          <Text
            variant="mono"
            color={theme.colors.text}
            style={styles.sas}
            accessibilityLabel={`Confirmation code ${sas.split('').join(' ')}`}>
            {sas}
          </Text>
        </Card>
        {error !== null ? (
          <Banner variant="warning" title="Couldn’t save">
            {error}
          </Banner>
        ) : null}
        <Banner variant="info" title="Only pair if they match">
          If the codes are different, someone else may be answering. Don’t pair —
          go back and try again on a network you trust.
        </Banner>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={confirmPairing}>
          Codes match — pair
        </Button>
        <Button
          variant="ghost"
          size="lg"
          fullWidth
          disabled={busy}
          onPress={() => navigation.goBack()}>
          They don’t match
        </Button>
      </ScrollView>
    );
  }

  // Step: paired -------------------------------------------------------------
  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <View style={{alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.lg}}>
        <Heading level="headingLarge">{onboarding ? 'You’re all set' : 'Paired'}</Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.centered}>
          {onboarding
            ? `You’re connected to ${station.name}. Your community is ready — you can send, vouch, and take part from here.`
            : `You’re paired with ${station.name}. Your phone and this station now recognise each other.`}
        </Text>
      </View>
      <Button variant="primary" size="lg" fullWidth onPress={finish}>
        {onboarding ? 'Enter Railroad' : 'Done'}
      </Button>
    </ScrollView>
  );
}


const styles = StyleSheet.create({
  stationHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  stationText: {flex: 1, minWidth: 0, gap: 2},
  sasCard: {alignItems: 'center', paddingVertical: 28},
  sas: {fontSize: 40, letterSpacing: 8, fontWeight: '600'},
  centered: {textAlign: 'center'},
});
