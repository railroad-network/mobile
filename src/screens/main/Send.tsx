/**
 * Send payment flow (T1.2.5).
 *
 * A four-step flow inside the Send tab: pick a recipient (paste or scan a
 * `rrn1…` address) → enter an amount + optional memo → review → unlock and
 * propose. The proposal is a real sender-signed {@link SignedSendProposal}
 * created on-device via the Rust FFI ({@link createSendProposal}); signing needs
 * the wallet secret, so — as with recovery — the wallet is re-opened here with a
 * passphrase (the OS biometric prompt fires on the keychain read). The signed
 * proposal is queued in the local outbox and shows as **Pending** in Home /
 * History. Transmitting it to the station is M1.3.
 *
 * Sign convention: the amount the user types is what they *pay*, so the proposal
 * carries a positive `amountCenti` (station convention: positive = sender pays
 * receiver), while the outbox's display transaction is a debit (negative).
 *
 * Edge cases (per the acceptance): an invalid address blocks; sending to your
 * own address blocks; an amount above the balance is allowed but warns (the
 * mutual-credit ledger permits going into debt).
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Identicon,
  QRScanner,
  Text,
} from '../../components';
import {isValidAddress} from '../../crypto/address';
import {
  amountSign,
  formatCommons,
  outboxCount,
  parseCommons,
  shortAddress,
  useBalance,
  useConnectivity,
  useEnqueueTransaction,
  useIdentity,
  type Transaction,
} from '../../ledger';
import {createSendProposal} from '../../wallet/proposal';
import {loadWallet} from '../../wallet/Wallet';
import {useTheme, type Theme} from '../../theme';
import type {MainTabScreenProps} from '../../navigation/types';

/** Memo length cap (plain text). */
const MEMO_MAX = 200;

/**
 * ⚠️ MOCK expiry window — the real settlement/expiry window comes from station
 * config in M1.3 / T1.2.6. Until then a proposal auto-cancels after a week.
 */
const EXPIRY_SECS = 7 * 86400;

type Step = 'recipient' | 'amount' | 'review' | 'unlock' | 'success';

export function Send({navigation}: MainTabScreenProps<'Send'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const {data: identity} = useIdentity();
  const {data: balance} = useBalance();
  const {isOffline} = useConnectivity();
  const enqueue = useEnqueueTransaction();

  const [step, setStep] = useState<Step>('recipient');
  const [recipient, setRecipient] = useState('');
  const [scanning, setScanning] = useState(false);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Unlock step.
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Result of a completed send, for the success screen.
  const [sentId, setSentId] = useState('');

  const parsed = parseCommons(amount);
  const amountCenti = 'centi' in parsed ? parsed.centi : 0;
  const availableAfter = (balance?.centi ?? 0) - amountCenti;
  const insufficient = balance !== undefined && amountCenti > balance.centi;
  const recipientLabel = recipient.trim().length > 0 ? shortAddress(recipient.trim()) : 'this neighbour';

  function resetFlow() {
    setStep('recipient');
    setRecipient('');
    setScanning(false);
    setAmount('');
    setMemo('');
    setRecipientError(null);
    setAmountError(null);
    setPassphrase('');
    setUnlockError(null);
    setSentId('');
  }

  // --- Step transitions -----------------------------------------------------

  function confirmRecipient() {
    const addr = recipient.trim();
    if (!isValidAddress(addr)) {
      setRecipientError('That doesn’t look like a valid rrn1… address.');
      return;
    }
    if (identity?.address !== undefined && addr === identity.address) {
      setRecipientError('That’s your own address — you can’t pay yourself.');
      return;
    }
    setRecipientError(null);
    setStep('amount');
  }

  function confirmAmount() {
    if ('error' in parsed) {
      setAmountError(parsed.error);
      return;
    }
    if (parsed.centi === 0) {
      setAmountError('Enter an amount greater than zero.');
      return;
    }
    setAmountError(null);
    setStep('review');
  }

  async function unlockAndSend() {
    if (passphrase.length === 0 || busy) {
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
      const addr = recipient.trim();
      // Authoritative self-send guard against the *real* wallet address (the
      // recipient step only knows the displayed identity).
      if (wallet.address === addr) {
        setUnlockError('That’s your own address — you can’t pay yourself.');
        return;
      }
      const proposal = await createSendProposal(wallet, addr, amountCenti, memo, {
        nonce: outboxCount(),
        proposedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + EXPIRY_SECS,
      });
      const tx: Transaction = {
        id: proposal.id,
        counterparty: shortAddress(addr),
        counterpartyAddress: addr,
        direction: 'out',
        // Display model: an outgoing payment is a debit (negative).
        amountCenti: -amountCenti,
        memo: proposal.memo,
        state: 'pending',
        timestamp: proposal.proposedAt,
        expiresAt: proposal.expiresAt,
        nonce: proposal.nonce,
      };
      await enqueue(tx);
      setSentId(proposal.id);
      setPassphrase('');
      setStep('success');
    } catch {
      // A wrong passphrase, a cancelled biometric prompt, or a bad receiver all
      // surface as one message — we never say which part failed.
      setUnlockError('Could not unlock. Check your passphrase and try again.');
    } finally {
      setBusy(false);
    }
  }

  // --- Rendering ------------------------------------------------------------

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  // Step: recipient ----------------------------------------------------------
  if (step === 'recipient') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header
          theme={theme}
          title="Send Commons"
          subtitle="Pay a neighbour. They confirm, then it settles."
        />
        {scanning ? (
          <View style={{gap: theme.spacing.md}}>
            <QRScanner
              onScan={value => {
                setRecipient(value.trim());
                setScanning(false);
                setRecipientError(null);
              }}
              style={styles.scanner}
            />
            <Button variant="secondary" size="lg" fullWidth onPress={() => setScanning(false)}>
              Cancel scan
            </Button>
          </View>
        ) : (
          <View style={{gap: theme.spacing.md}}>
            <Field
              label="Pay to"
              value={recipient}
              onChangeText={t => {
                setRecipient(t);
                if (recipientError !== null) setRecipientError(null);
              }}
              error={recipientError ?? undefined}
              placeholder="rrn1…"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
            />
            <Button variant="secondary" size="lg" fullWidth onPress={() => setScanning(true)}>
              Scan a QR code
            </Button>
          </View>
        )}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={recipient.trim().length === 0}
          onPress={confirmRecipient}>
          Continue
        </Button>
      </ScrollView>
    );
  }

  // Step: amount + memo ------------------------------------------------------
  if (step === 'amount') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header theme={theme} title={`Pay ${recipientLabel}`} onBack={() => setStep('recipient')} />
        <Card style={styles.amountPreview}>
          <Amount centi={amountCenti} size="xl" signed={false} colored={false} />
          <Text variant="caption" color={theme.colors.textSecondary}>
            Available after: {formatSigned(availableAfter)} Commons
          </Text>
        </Card>
        <Field
          label="Amount"
          value={amount}
          onChangeText={t => {
            setAmount(t);
            if (amountError !== null) setAmountError(null);
          }}
          error={amountError ?? undefined}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoCorrect={false}
        />
        {insufficient && (
          <Banner variant="warning" title="This puts you in debt">
            That’s allowed — the Common nets to zero across the community. You’ll owe until you’re
            paid back.
          </Banner>
        )}
        <Field
          label="What’s this for?"
          value={memo}
          onChangeText={setMemo}
          placeholder="e.g. Grain — 2 sacks"
          maxLength={MEMO_MAX}
          hint="Optional"
        />
        <Button variant="primary" size="lg" fullWidth onPress={confirmAmount}>
          Review payment
        </Button>
      </ScrollView>
    );
  }

  // Step: review -------------------------------------------------------------
  if (step === 'review') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header theme={theme} title="Review payment" onBack={() => setStep('amount')} />
        <View style={styles.centerX}>
          <Amount centi={-amountCenti} size="xl" />
        </View>
        <Card style={{gap: theme.spacing.md}}>
          <Row theme={theme} label="To">
            <Identicon seed={recipient.trim()} size={28} />
            <Text variant="mono" color={theme.colors.text}>
              {recipientLabel}
            </Text>
          </Row>
          <Row theme={theme} label="For">
            <Text variant="body" color={theme.colors.text}>
              {memo.trim().length > 0 ? memo.trim() : '—'}
            </Text>
          </Row>
        </Card>
        {insufficient && (
          <Banner variant="warning" title="This puts you in debt">
            You’ll owe until you’re paid back — the Common nets to zero across the community.
          </Banner>
        )}
        {isOffline && (
          <Banner variant="info" title="You’re offline">
            This sends when your station next syncs. Nothing is lost in the meantime.
          </Banner>
        )}
        <Button variant="primary" size="lg" fullWidth onPress={() => setStep('unlock')}>
          Propose payment
        </Button>
      </ScrollView>
    );
  }

  // Step: unlock -------------------------------------------------------------
  if (step === 'unlock') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header
          theme={theme}
          title="Confirm it’s you"
          subtitle="Unlock your wallet to sign this payment."
          onBack={() => {
            setPassphrase('');
            setUnlockError(null);
            setStep('review');
          }}
        />
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
          onSubmitEditing={unlockAndSend}
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
          onPress={unlockAndSend}>
          Sign &amp; propose
        </Button>
      </ScrollView>
    );
  }

  // Step: success ------------------------------------------------------------
  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <View style={{alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.lg}}>
        <Heading level="headingLarge">Payment proposed</Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.centered}>
          Waiting for {recipientLabel} to confirm. Once they do, a dispute window opens before it
          settles.
        </Text>
        <Card style={styles.qrCard}>
          {sentId.length > 0 && (
            <View style={styles.qrFrame}>
              <QRCode value={sentId} size={150} color="#000000" backgroundColor="#FFFFFF" />
            </View>
          )}
          <Text variant="caption" color={theme.colors.textMuted} style={styles.centered}>
            Transaction {shortId(sentId)}
          </Text>
        </Card>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.centered}>
          Show this to {recipientLabel} so they can confirm in person, or wait for it to reach their
          phone.
        </Text>
      </View>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => {
          resetFlow();
          navigation.navigate('Home');
        }}>
        Done
      </Button>
      <Button variant="ghost" size="lg" fullWidth onPress={resetFlow}>
        Send another
      </Button>
    </ScrollView>
  );
}

/** Shared step header: an optional back link, a title, and an optional subtitle. */
function Header({
  theme,
  title,
  subtitle,
  onBack,
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      {onBack !== undefined && (
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
      )}
      <Heading level="headingLarge">{title}</Heading>
      {subtitle !== undefined && (
        <Text variant="body" color={theme.colors.textSecondary}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/** A label / value row inside a review card. */
function Row({theme, label, children}: {theme: Theme; label: string; children: React.ReactNode}) {
  return (
    <View style={styles.row}>
      <Text variant="body" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

/** Formats a signed centi value with its sign, for the "available after" line. */
function formatSigned(centi: number): string {
  return `${amountSign(centi)}${formatCommons(centi)}`;
}

/** A short, human handle for a transaction id (hex) on the success screen. */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

const styles = StyleSheet.create({
  scanner: {height: 280, borderRadius: 16, overflow: 'hidden'},
  amountPreview: {alignItems: 'center', gap: 8, paddingVertical: 24},
  centerX: {alignItems: 'center'},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12},
  rowValue: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  centered: {textAlign: 'center'},
  qrCard: {alignItems: 'center', gap: 12, paddingVertical: 20},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16},
});
