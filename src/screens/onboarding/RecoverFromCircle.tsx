/**
 * Rebuild a key from the recovery circle (ADR-0016), on the member's own new
 * device — never the station (ADR-0006).
 *
 * Three in-screen steps drive the {@link RecoverySession} (the requester side of
 * the ceremony; the crypto lives in Rust):
 *   1. `address` — the member enters (or scans) the identity they are recovering.
 *      That mints an ephemeral recovery key and opens a session.
 *   2. `request` — this device shows a `rrnrecover-req:` QR and, in large type,
 *      the ceremony fingerprint. Every holder must see this *same* fingerprint
 *      before they contribute — it is how two holders notice they were shown
 *      different ceremonies. Progress tracks the pieces gathered so far (the
 *      requester cannot know the circle's real threshold, so the count is a hint,
 *      not a hard target).
 *   3. `scan` — the member scans each holder's `rrnrecover-resp:` QR. A response
 *      for a different ceremony is refused, not mixed in. When enough shares
 *      rebuild the target address, the recovered identity is carried into the
 *      shared onboarding tail (set a device passphrase → biometrics → join).
 *
 * A reconstruction with too few (or wrong) shares reports "keep scanning" — never
 * a wrong key. The ephemeral secret stays in Rust and is zeroized when the
 * session is dropped.
 */
import {useEffect, useRef, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';

import {Banner, Button, Card, Field, Heading, QRScanner, Text} from '../../components';
import {isValidAddress} from '../../crypto/address';
import {parseAddressQr} from '../../ledger/addressQr';
import {useTheme} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {RecoverySession} from '../../wallet/recoveryRequester';
import {useOnboarding} from './OnboardingContext';
import {RECOVERY_THRESHOLD} from '../recovery/RecoveryContext';
import {OnboardingScaffold} from './OnboardingScaffold';

const QR_SIZE = 200;

type Step = 'address' | 'request' | 'scan';

interface Notice {
  variant: 'warning' | 'info';
  title: string;
  body: string;
}

export function RecoverFromCircle({
  navigation,
}: OnboardingScreenProps<'RecoverFromCircle'>) {
  const theme = useTheme();
  const {setRecoveredWallet} = useOnboarding();
  // Pauses the camera when this screen is not the focused route — the onboarding
  // stack keeps it mounted underneath the passphrase → ready tail after a
  // successful rebuild, and a still-live scanner there would keep the camera on
  // and could fire a stale scan into an unmounted flow.
  const isFocused = useIsFocused();

  const [step, setStep] = useState<Step>('address');
  const [session, setSession] = useState<RecoverySession | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [scanningAddress, setScanningAddress] = useState(false);
  const [responses, setResponses] = useState(0);
  // A synchronous mirror of the gathered count, so two camera events in the same
  // React batch dedupe against the true running total rather than a stale render.
  const responsesRef = useRef(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set once a rebuild has been carried into the shared tail, so leaving after a
  // successful recovery never prompts — there is nothing left to lose then.
  const [committed, setCommitted] = useState(false);

  // Guard against silently losing a partly-gathered circle. Once at least one
  // holder's piece is in, any exit from the ceremony — the Cancel button, the
  // system back gesture, anything that pops this screen — confirms first, so an
  // accidental back doesn't discard shares the holders would have to re-scan.
  // `addListener` is optional-chained so the screen still renders outside a
  // navigator (tests, storybook).
  useEffect(() => {
    if (responses === 0 || committed) return;
    return navigation.addListener?.('beforeRemove', e => {
      e.preventDefault();
      Alert.alert(
        'Cancel recovery?',
        "You've gathered pieces from your circle. Leaving now discards them, and your holders would have to scan a fresh request.",
        [
          {text: 'Keep going', style: 'cancel'},
          {
            text: 'Discard and leave',
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ],
      );
    });
  }, [navigation, responses, committed]);

  function begin() {
    const address = addressInput.trim();
    if (!isValidAddress(address)) {
      setAddressError('That is not a valid address.');
      return;
    }
    try {
      setSession(RecoverySession.begin(address));
      responsesRef.current = 0;
      setResponses(0);
      setNotice(null);
      setStep('request');
    } catch {
      setAddressError('That is not a valid address.');
    }
  }

  // Mint a fresh ceremony (new ephemeral key ⇒ new fingerprint) and discard the
  // responses gathered so far — the remedy when a mixed/poisoned set won't
  // rebuild, or the member simply wants to restart. Holders must re-scan the new
  // request.
  function startOver() {
    if (session === null) return;
    setSession(RecoverySession.begin(addressInput.trim()));
    responsesRef.current = 0;
    setResponses(0);
    setNotice(null);
    setStep('request');
  }

  function onScanAddress(value: string) {
    // Accept the plain `rrn1…` a credential card shows and the `rrn:…?addr=` QR
    // envelope alike (the same parser the vouch flow uses); anything else is
    // called out, not silently dropped.
    const scanned = parseAddressQr(value);
    if (scanned === null) {
      setNotice({
        variant: 'warning',
        title: "That isn't an address",
        body: 'Scan the address QR from a credential card or a friend’s saved contact.',
      });
      return;
    }
    setAddressInput(scanned.address);
    setAddressError(null);
    setNotice(null);
    setScanningAddress(false);
  }

  function onScanResponse(value: string) {
    if (session === null) return;
    const result = session.addResponseQr(value);
    if (result.kind === 'not-a-response') {
      setNotice({
        variant: 'warning',
        title: "That isn't a recovery response",
        body: 'Scan the response your holder is showing — a request or address QR won’t work here.',
      });
      return;
    }
    if (result.kind === 'wrong-ceremony') {
      setNotice({
        variant: 'warning',
        title: 'That response is for a different recovery',
        body: 'It was made for another ceremony and can’t be used here. Ask the holder to scan your current request.',
      });
      return;
    }

    // Accepted. If the count didn't advance, it was a re-scan of a share already
    // held — say so gently and keep going. Compare against the synchronous mirror
    // so a rapid double-scan can't be misjudged against a stale render.
    if (result.responses === responsesRef.current) {
      setNotice({
        variant: 'info',
        title: 'Already have that one',
        body: 'That holder’s piece is already counted. Scan a different holder next.',
      });
      return;
    }
    responsesRef.current = result.responses;
    setResponses(result.responses);
    setNotice(null);

    const rebuilt = session.reconstruct();
    if (rebuilt.kind === 'recovered') {
      // Carry the rebuilt identity into the shared tail; it is sealed under a new
      // device passphrase there (D3: a recovered wallet starts unanchored and
      // re-syncs its nonce before its first spend). Leave the scan step first so
      // the camera pauses and no stale scan fires into the tail (see isFocused).
      setStep('request');
      setCommitted(true);
      setRecoveredWallet(rebuilt.wallet);
      navigation.navigate('Passphrase');
      return;
    }
    // Not enough shares yet — the requester cannot know the circle's real
    // threshold (K is set at split time and can exceed the mobile default), so we
    // do NOT declare the set bad. Once the member has plausibly gathered a full
    // circle, offer the remedy for a poisoned/mixed set without asserting it.
    if (result.responses >= RECOVERY_THRESHOLD) {
      setNotice({
        variant: 'info',
        title: 'Still rebuilding',
        body: "If you've gathered a piece from everyone in your circle and it still won't rebuild, one may be from a different circle — start over with a fresh request.",
      });
    }
    // Back to the request so the next holder can scan it, with progress updated.
    setStep('request');
  }

  // --- step: enter the address being recovered ------------------------------
  if (step === 'address') {
    if (scanningAddress) {
      return (
        <OnboardingScaffold
          footer={
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onPress={() => setScanningAddress(false)}>
              Enter it by hand
            </Button>
          }>
          <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
            Scan your address
          </Heading>
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={{marginBottom: theme.spacing.lg}}>
            Point the camera at your address QR — from your credential card, or a
            contact a friend saved for you.
          </Text>
          {notice !== null && (
            <View style={{marginBottom: theme.spacing.md}}>
              <Banner variant={notice.variant} title={notice.title}>
                {notice.body}
              </Banner>
            </View>
          )}
          <Card padded={false} style={styles.scanner}>
            <QRScanner onScan={onScanAddress} isActive={isFocused} />
          </Card>
        </OnboardingScaffold>
      );
    }
    return (
      <OnboardingScaffold
        footer={
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={addressInput.trim().length === 0}
              onPress={begin}>
              Start recovery
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onPress={() => navigation.goBack()}>
              Back
            </Button>
          </>
        }>
        <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
          Which identity are you recovering?
        </Heading>
        <Text
          variant="body"
          color={theme.colors.textSecondary}
          style={{marginBottom: theme.spacing.lg}}>
          Enter your rrn1… address — the one on your credential card, or that a
          friend has saved for you.
        </Text>
        <View style={{gap: theme.spacing.md}}>
          <Field
            label="Your address"
            value={addressInput}
            onChangeText={t => {
              setAddressInput(t);
              if (addressError !== null) setAddressError(null);
            }}
            placeholder="rrn1…"
            error={addressError ?? undefined}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
          />
          <Button
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => setScanningAddress(true)}>
            Scan your address instead
          </Button>
        </View>
      </OnboardingScaffold>
    );
  }

  // The requester doesn't know the circle's real threshold, so state the count
  // and give the common case as a hint rather than a hard target.
  const progress = `${responses} ${responses === 1 ? 'piece' : 'pieces'} gathered · usually ${RECOVERY_THRESHOLD} needed`;

  // --- step: show the request + fingerprint ---------------------------------
  if (step === 'request' && session !== null) {
    return (
      <OnboardingScaffold
        footer={
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => {
                setNotice(null);
                setStep('scan');
              }}>
              Scan a holder's response
            </Button>
            {responses > 0 && (
              <Button variant="ghost" size="lg" fullWidth onPress={startOver}>
                Start over with a new request
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onPress={() => navigation.goBack()}>
              Cancel recovery
            </Button>
          </>
        }>
        {notice !== null && (
          <Banner variant={notice.variant} title={notice.title}>
            {notice.body}
          </Banner>
        )}

        <View style={styles.centerCol}>
          <Heading level="headingSmall" style={styles.centerText}>
            Show this to your holders
          </Heading>
          <Card style={styles.qrCard}>
            <View style={styles.qrFrame}>
              <QRCode
                value={session.requestQr()}
                size={QR_SIZE}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            </View>
          </Card>

          <Text
            variant="caption"
            color={theme.colors.textSecondary}
            style={styles.centerText}>
            Ceremony fingerprint
          </Text>
          <Text
            variant="mono"
            color={theme.colors.text}
            selectable
            style={styles.fingerprint}
            accessibilityLabel={`Ceremony fingerprint: ${session.fingerprint()}`}>
            {session.fingerprint()}
          </Text>
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={[styles.centerText, {marginBottom: theme.spacing.md}]}>
            Every holder must see this exact code on their own screen. Read it
            aloud together — if it doesn't match, stop.
          </Text>

          <View
            style={[
              styles.progress,
              {
                backgroundColor: theme.colors.surfaceRaised,
                borderColor: theme.colors.border,
              },
            ]}>
            <Text variant="label" color={theme.colors.text}>
              {progress}
            </Text>
          </View>
        </View>
      </OnboardingScaffold>
    );
  }

  // --- step: scan holder responses ------------------------------------------
  return (
    <OnboardingScaffold
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => setStep('request')}>
            Done scanning for now
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => navigation.goBack()}>
            Cancel recovery
          </Button>
        </>
      }>
      {notice !== null && (
        <Banner variant={notice.variant} title={notice.title}>
          {notice.body}
        </Banner>
      )}
      <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
        Scan a holder's response
      </Heading>
      <Text
        variant="body"
        color={theme.colors.textSecondary}
        style={{marginBottom: theme.spacing.md}}>
        Point the camera at the response each holder shows you. {progress}.
      </Text>
      <Card padded={false} style={styles.scanner}>
        <QRScanner onScan={onScanResponse} isActive={step === 'scan' && isFocused} />
      </Card>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  scanner: {height: 320, overflow: 'hidden'},
  centerCol: {alignItems: 'center'},
  centerText: {textAlign: 'center'},
  qrCard: {padding: 14, marginTop: 12, marginBottom: 16},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12},
  fingerprint: {
    fontSize: 28,
    letterSpacing: 2,
    marginTop: 2,
    marginBottom: 12,
    textAlign: 'center',
  },
  progress: {
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
