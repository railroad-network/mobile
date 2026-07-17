/**
 * Confirm received payment (T1.2.6).
 *
 * Opened from the Home inbox for one incoming proposal. The receiver reviews who
 * is paying, how much, the memo, and how long until the proposal expires, then
 * either **confirms** — which signs a real `TransactionConfirmation` with the
 * unlocked session wallet and transmits it to the station over the authenticated
 * channel ({@link useConfirmProposal}), moving the transaction into its
 * settlement window — or **rejects** it (a local state change to `cancelled` with
 * reason `rejected_by_receiver`; nothing is signed or sent, and the proposal
 * simply expires on the station). An expired proposal can no longer be confirmed.
 *
 * The confirmed/rejected state shows immediately via the local overlay; the
 * balance change follows when the settlement window elapses on the station.
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
  Heading,
  Identicon,
  Text,
} from '../../components';
import {
  isExpired,
  settlementAt,
  shortAddress,
  useActivity,
  useConfirmProposal,
  useRecordDecision,
} from '../../ledger';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

type Step = 'detail' | 'confirmed' | 'rejected';

export function ConfirmReceived({route, navigation}: MainStackScreenProps<'ConfirmReceived'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data} = useActivity();
  const recordDecision = useRecordDecision();
  const confirmProposal = useConfirmProposal();
  const tx = data?.find(t => t.id === route.params.id);

  const [step, setStep] = useState<Step>('detail');
  const [confirmedAt, setConfirmedAt] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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

  async function confirmReceipt() {
    if (tx === undefined || busy) {
      return;
    }
    setBusy(true);
    setConfirmError(null);
    // The wallet is already unlocked for the session (lock screen), so this signs
    // and transmits the confirmation with no further prompt. The hook records the
    // local `confirmed` overlay on success.
    const when = Math.floor(Date.now() / 1000);
    const result = await confirmProposal(tx.id);
    setBusy(false);
    if (result.ok) {
      setConfirmedAt(when);
      setStep('confirmed');
      return;
    }
    setConfirmError(
      result.error === 'unreachable'
        ? 'Couldn’t reach your station. Connect to it and try again.'
        : `Couldn’t confirm: ${result.message}`,
    );
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
          {confirmError !== null && (
            <Banner variant="danger" title="Not confirmed">
              {confirmError}
            </Banner>
          )}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            onPress={confirmReceipt}>
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
  settleClock: {fontSize: 36, lineHeight: 44, fontWeight: '700'},
});
