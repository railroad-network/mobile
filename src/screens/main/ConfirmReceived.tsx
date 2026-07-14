/**
 * Confirm received payment (T1.2.6).
 *
 * Opened from the Home inbox for one incoming proposal. The receiver reviews who
 * is paying, how much, the memo, and how long until the proposal expires, then
 * either **confirms** — which re-unlocks the wallet and signs a real
 * `TransactionConfirmation` via the FFI ({@link createConfirmation}), moving the
 * transaction into its settlement window — or **rejects** it (a local state
 * change to `cancelled` with reason `rejected_by_receiver`; nothing is signed).
 * An expired proposal can no longer be confirmed.
 *
 * The decision is recorded in the local overlay and shows immediately in
 * Home/History; transmitting the signed confirmation to the station is M1.3, as
 * is the balance change when the window elapses.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Banner,
  Button,
  Card,
  Countdown,
  Field,
  Heading,
  Identicon,
  Text,
} from '../../components';
import {
  isExpired,
  settlementAt,
  shortAddress,
  useActivity,
  useRecordDecision,
} from '../../ledger';
import {createConfirmation} from '../../wallet/confirmation';
import {loadWallet} from '../../wallet/Wallet';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

type Step = 'detail' | 'unlock' | 'confirmed' | 'rejected';

export function ConfirmReceived({route, navigation}: MainStackScreenProps<'ConfirmReceived'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data} = useActivity();
  const recordDecision = useRecordDecision();
  const tx = data?.find(t => t.id === route.params.id);

  const [step, setStep] = useState<Step>('detail');
  const [confirmedAt, setConfirmedAt] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  function back(label = 'Back', onPress = () => navigation.goBack()) {
    return (
      <Text
        variant="body"
        color={theme.colors.primary}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}>
        ‹ {label}
      </Text>
    );
  }

  if (tx === undefined) {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        {back()}
        <Text variant="body" color={theme.colors.textSecondary}>
          This proposal isn’t available.
        </Text>
      </ScrollView>
    );
  }

  const expired = isExpired(tx);

  async function reject() {
    if (tx === undefined) return;
    await recordDecision(tx.id, {state: 'cancelled', reason: 'rejected_by_receiver'});
    setStep('rejected');
  }

  async function unlockAndConfirm() {
    if (tx === undefined || passphrase.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setUnlockError(null);
    try {
      const wallet = await loadWallet(passphrase);
      if (wallet === null) {
        setUnlockError('No wallet found on this device.');
        return;
      }
      const when = Math.floor(Date.now() / 1000);
      await createConfirmation(wallet, tx.id, when);
      await recordDecision(tx.id, {state: 'confirmed', confirmedAt: when});
      setConfirmedAt(when);
      setPassphrase('');
      setStep('confirmed');
    } catch {
      setUnlockError('Could not unlock. Check your passphrase and try again.');
    } finally {
      setBusy(false);
    }
  }

  // Step: confirmed (success) ------------------------------------------------
  if (step === 'confirmed') {
    const settleAt = settlementAt({...tx, confirmedAt});
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <View style={styles.center}>
          <Heading level="headingLarge">You confirmed receipt</Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
            You signed for “{tx.memo ?? 'this payment'}” from {tx.counterparty}. It settles unless a
            dispute is raised.
          </Text>
        </View>
        <Card style={styles.settleCard}>
          <Text variant="label" color={theme.colors.accent} style={styles.settleLabel}>
            WILL SETTLE IN
          </Text>
          <Countdown until={settleAt ?? 0} color={theme.colors.text} style={styles.settleClock} />
          <Text variant="caption" color={theme.colors.textSecondary}>
            Dispute window
          </Text>
        </Card>
        <Button variant="primary" size="lg" fullWidth onPress={() => navigation.goBack()}>
          Back to inbox
        </Button>
      </ScrollView>
    );
  }

  // Step: rejected -----------------------------------------------------------
  if (step === 'rejected') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <View style={styles.center}>
          <Heading level="headingLarge">Proposal rejected</Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
            Nothing moved. {tx.counterparty} can propose again, or you can sort it out in person.
          </Text>
        </View>
        <Button variant="primary" size="lg" fullWidth onPress={() => navigation.goBack()}>
          Back to inbox
        </Button>
      </ScrollView>
    );
  }

  // Step: unlock -------------------------------------------------------------
  if (step === 'unlock') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <View style={{gap: theme.spacing.xs}}>
          {back('Back', () => {
            setPassphrase('');
            setUnlockError(null);
            setStep('detail');
          })}
          <Heading level="headingLarge">Confirm it’s you</Heading>
          <Text variant="body" color={theme.colors.textSecondary}>
            Unlock your wallet to sign that you received this.
          </Text>
        </View>
        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={t => {
            setPassphrase(t);
            if (unlockError !== null) setUnlockError(null);
          }}
          error={unlockError ?? undefined}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          onSubmitEditing={unlockAndConfirm}
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
          onPress={unlockAndConfirm}>
          Confirm — I received this
        </Button>
      </ScrollView>
    );
  }

  // Step: detail -------------------------------------------------------------
  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      {back()}
      <View style={styles.center}>
        <Identicon seed={tx.counterpartyAddress} size={56} />
        <Text variant="body" color={theme.colors.textSecondary}>
          {tx.counterparty} is paying you
        </Text>
        <Amount centi={tx.amountCenti} size="xl" />
      </View>
      <Card style={{gap: theme.spacing.md}}>
        <Row theme={theme} label="For">
          <Text variant="body" color={theme.colors.text}>
            {tx.memo !== undefined && tx.memo.length > 0 ? tx.memo : '—'}
          </Text>
        </Row>
        <Row theme={theme} label="From">
          <Text variant="mono" color={theme.colors.text}>
            {shortAddress(tx.counterpartyAddress)}
          </Text>
        </Row>
        <Row theme={theme} label={expired ? 'Expired' : 'Expires in'}>
          {expired ? (
            <Text variant="body" color={theme.colors.danger}>
              Expired
            </Text>
          ) : (
            tx.expiresAt !== undefined && (
              <Countdown until={tx.expiresAt} color={theme.colors.text} />
            )
          )}
        </Row>
      </Card>

      {expired ? (
        <Banner variant="warning" title="This proposal expired">
          It passed its confirmation deadline and can no longer be confirmed. Ask {tx.counterparty}{' '}
          to propose it again.
        </Banner>
      ) : (
        <>
          <Banner variant="info" title="Only confirm what’s true">
            Confirming signs your name to “I received this.” If you didn’t, reject it — your word is
            part of the ledger.
          </Banner>
          <Button variant="primary" size="lg" fullWidth onPress={() => setStep('unlock')}>
            Confirm — I received this
          </Button>
          <Button variant="ghost" size="lg" fullWidth onPress={reject}>
            Reject
          </Button>
        </>
      )}
    </ScrollView>
  );
}

/** A label / value row inside a card. */
function Row({
  theme,
  label,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text variant="body" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', gap: 10},
  centerText: {textAlign: 'center'},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12},
  rowValue: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  settleCard: {alignItems: 'center', gap: 8, paddingVertical: 24},
  settleLabel: {letterSpacing: 1, fontWeight: '700'},
  settleClock: {fontSize: 36, fontWeight: '700'},
});
