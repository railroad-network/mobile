/**
 * Transaction detail (T1.2.7) — every field of one transaction, opened from Home
 * or History. Reads the transaction from the already-fetched activity cache.
 *
 * Signatures are shown as verified checkmarks derived from the transaction's
 * state (a proposal is always sender-signed; the receiver's signature exists once
 * it is confirmed) — the raw signature bytes are never displayed. Real on-device
 * verification against the station's signed records arrives with the transport
 * layer (M1.3); the "View on station log" link is a placeholder until a paired
 * station can serve it.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Badge,
  Banner,
  Button,
  Card,
  Countdown,
  Field,
  Identicon,
  ScreenHeader,
  Text,
} from '../../components';
import {
  relativeTime,
  settlementAt,
  stateBadge,
  tierBadge,
  tierLabel,
  useActivity,
  useRaiseDispute,
} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${hour12}:${min} ${ampm}`;
}

/** A short content-address handle, e.g. `b3:9f2c4a7b…`. */
function shortHash(id: string): string {
  return `b3:${id.slice(0, 8)}…`;
}

/** The longest a dispute reason may be, matching the station's byte bound. */
const MAX_REASON = 2048;

/**
 * The "For" line's value. When the station resolved the listing this paid for
 * (T1.7.6 Stage B), show that title — it names what was bought for *any*
 * marketplace payment, including ones whose memo predates the current format.
 *
 * Falling back to the memo when there's no resolved title: a marketplace memo is
 * `"<listing title> · #<inquiry id>"` (see `inquiryMemo`), so show just the
 * listing; a bare legacy `Inquiry <hex>` reads as a plain "Marketplace payment"
 * rather than a wall of hash; any other memo (a normal send) shows as-is.
 */
export function forLabel(listingTitle: string | undefined, memo: string | undefined): string {
  if (listingTitle !== undefined && listingTitle.length > 0) {
    return listingTitle;
  }
  if (memo === undefined || memo.length === 0) {
    return '—';
  }
  const listing = memo.match(/^(.+) · #[0-9a-f]+$/);
  if (listing) {
    return listing[1];
  }
  if (/^Inquiry [0-9a-f]{16,}$/.test(memo)) {
    return 'Marketplace payment';
  }
  return memo;
}

export function TransactionDetail({route, navigation}: MainStackScreenProps<'TransactionDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data} = useActivity();
  const tx = data?.find(t => t.id === route.params.id);

  const [copied, setCopied] = useState(false);
  const [showLogNote, setShowLogNote] = useState(false);

  const raiseDispute = useRaiseDispute();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [raising, setRaising] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  // A confirmed-but-not-yet-settled transaction can still be contested: raising
  // a dispute freezes settlement while a jury weighs it.
  const canRaise = tx !== undefined && (tx.state === 'confirmed' || tx.state === 'window');

  async function submitDispute() {
    if (tx === undefined || raising || reason.trim().length === 0) return;
    setRaising(true);
    setDisputeError(null);
    const result = await raiseDispute(tx.id, reason.trim());
    setRaising(false);
    if (result.ok) {
      setDisputing(false);
      setReason('');
      navigation.navigate('DisputeDetail', {txId: tx.id});
      return;
    }
    setDisputeError(raiseErrorMessage(result.error, result.message));
  }

  const settleAt = tx !== undefined ? settlementAt(tx) : undefined;
  const receiverSigned =
    tx !== undefined && ['confirmed', 'window', 'settled', 'disputed'].includes(tx.state);

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <ScreenHeader
        title="Transaction"
        onBack={() => navigation.goBack()}
      />

      {tx === undefined ? (
        <Text variant="body" color={theme.colors.textSecondary}>
          This transaction isn’t available.
        </Text>
      ) : (
        <>
          <Card style={styles.hero}>
            <Identicon seed={tx.counterpartyAddress} size={52} />
            <Text variant="body" color={theme.colors.textSecondary}>
              {tx.direction === 'in' ? 'Received from' : 'Sent to'} {tx.counterparty}
            </Text>
            <Amount centi={tx.amountCenti} size="xl" />
            {/* Badge sets its own `alignSelf: flex-start`; wrap it so it centers
                with the rest of the hero instead of hugging the left edge. */}
            <View style={styles.heroBadge}>
              <Badge variant={stateBadge(tx.state).variant} dot>
                {stateBadge(tx.state).label}
              </Badge>
              {tierBadge(tx.oracleTier) !== null && (
                <Badge variant={tierBadge(tx.oracleTier)!.variant}>
                  {tierBadge(tx.oracleTier)!.label}
                </Badge>
              )}
            </View>
          </Card>

          {settleAt !== undefined && (tx.state === 'confirmed' || tx.state === 'window') && (
            <Card style={styles.settleRow}>
              <Text variant="label" color={theme.colors.accent}>
                SETTLES IN
              </Text>
              <Countdown until={settleAt} color={theme.colors.text} style={styles.settleClock} />
            </Card>
          )}

          {/* This transaction is under dispute — jump to the dispute. */}
          {tx.state === 'disputed' && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => navigation.navigate('DisputeDetail', {txId: tx.id})}>
              View dispute
            </Button>
          )}

          {/* Raise a dispute while the transaction is still settling. */}
          {canRaise && (
            <View style={{gap: theme.spacing.sm}}>
              {disputeError !== null && (
                <Banner variant="danger" title="Couldn’t raise the dispute">
                  {disputeError}
                </Banner>
              )}
              {disputing ? (
                <Card style={{gap: theme.spacing.sm}}>
                  <Text variant="label" color={theme.colors.text}>
                    Raise a dispute
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    This freezes settlement while a jury of three weighs it. Only
                    dispute a transaction you believe is genuinely wrong.
                  </Text>
                  <Field
                    label="What’s wrong?"
                    placeholder="Describe the problem…"
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    maxLength={MAX_REASON}
                  />
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    loading={raising}
                    disabled={reason.trim().length === 0}
                    onPress={submitDispute}>
                    Raise dispute
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onPress={() => {
                      setDisputing(false);
                      setDisputeError(null);
                    }}>
                    Cancel
                  </Button>
                </Card>
              ) : (
                <Button variant="ghost" size="md" onPress={() => setDisputing(true)}>
                  Something wrong? Raise a dispute
                </Button>
              )}
            </View>
          )}

          <Card style={styles.fields}>
            <DetailRow theme={theme} label="For" value={forLabel(tx.listingTitle, tx.memo)} />
            <DetailRow
              theme={theme}
              label="Direction"
              value={tx.direction === 'in' ? 'Incoming credit' : 'Outgoing debit'}
            />
            <DetailRow theme={theme} label="Oracle tier" value={tierLabel(tx.oracleTier)} />
            {tx.nonce !== undefined && (
              <DetailRow theme={theme} label="Nonce" value={String(tx.nonce)} mono />
            )}
            <DetailRow
              theme={theme}
              label="Proposed"
              value={`${formatDateTime(tx.timestamp)} · ${relativeTime(tx.timestamp)}`}
            />
            {tx.expiresAt !== undefined && (
              <DetailRow theme={theme} label="Expires" value={formatDateTime(tx.expiresAt)} />
            )}
            {tx.confirmedAt !== undefined && (
              <DetailRow theme={theme} label="Confirmed" value={formatDateTime(tx.confirmedAt)} />
            )}
            {tx.settledAt !== undefined && (
              <DetailRow theme={theme} label="Settled" value={formatDateTime(tx.settledAt)} />
            )}
          </Card>

          {/* Counterparty address — full, copyable, plus QR */}
          <Card style={styles.addrCard}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {tx.direction === 'in' ? 'FROM' : 'TO'}
            </Text>
            <Text variant="mono" color={theme.colors.text} selectable style={styles.addr}>
              {tx.counterpartyAddress}
            </Text>
            <View style={styles.qrFrame}>
              <QRCode value={tx.counterpartyAddress} size={140} color="#000000" backgroundColor="#FFFFFF" />
            </View>
            <Button
              variant="secondary"
              size="md"
              onPress={() => {
                Clipboard.setString(tx.counterpartyAddress);
                setCopied(true);
              }}>
              {copied ? 'Copied ✓' : 'Copy address'}
            </Button>
          </Card>

          {/* Signatures — verified checkmarks, no raw bytes */}
          <View style={{gap: theme.spacing.sm}}>
            <Text variant="label" color={theme.colors.text}>
              Signatures
            </Text>
            <SignatureRow
              theme={theme}
              who={tx.direction === 'in' ? tx.counterparty : 'You'}
              role="Sender"
              verified
            />
            <SignatureRow
              theme={theme}
              who={tx.direction === 'in' ? 'You' : tx.counterparty}
              role="Receiver"
              verified={receiverSigned}
            />
            <Text variant="caption" color={theme.colors.textMuted}>
              {shortHash(tx.id)} · entry in the signed log
            </Text>
          </View>

          <Button variant="ghost" size="md" onPress={() => setShowLogNote(true)}>
            View on station log
          </Button>
          {showLogNote && (
            <Banner variant="info" title="Not available yet">
              The station log opens here once this device is paired with a station (M1.3).
            </Banner>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Friendly copy for a failed raise, special-casing the common rejections. */
function raiseErrorMessage(error: string, message: string): string {
  if (error === 'unreachable') {
    return 'Couldn’t reach your station. Connect to it and try again.';
  }
  if (/window|closed/i.test(message)) {
    return 'The window to dispute this transaction has closed.';
  }
  if (/confirmed|not.*disputed|state/i.test(message)) {
    return 'This transaction can’t be disputed in its current state.';
  }
  if (/party/i.test(message)) {
    return 'Only a party to this transaction can dispute it.';
  }
  return `Couldn’t raise the dispute: ${message}`;
}

function DetailRow({
  theme,
  label,
  value,
  mono = false,
}: {
  theme: Theme;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text variant="body" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <Text variant={mono ? 'mono' : 'body'} color={theme.colors.text} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

function SignatureRow({
  theme,
  who,
  role,
  verified,
}: {
  theme: Theme;
  who: string;
  role: string;
  verified: boolean;
}) {
  return (
    <View style={[styles.sigRow, {backgroundColor: theme.colors.surfaceSunken}]}>
      <Text variant="body" color={verified ? theme.colors.success : theme.colors.textMuted}>
        {verified ? '✓' : '…'}
      </Text>
      <View style={styles.sigMain}>
        <Text variant="mono" color={theme.colors.text}>
          {who}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {role}
        </Text>
      </View>
      <Text
        variant="label"
        color={verified ? theme.colors.success : theme.colors.textMuted}>
        {verified ? 'Verified' : 'Awaiting'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', gap: 10, paddingVertical: 24},
  heroBadge: {alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8},
  settleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16},
  settleClock: {fontSize: 22, lineHeight: 28, fontWeight: '700'},
  fields: {gap: 14},
  detailRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
  detailValue: {flexShrink: 1, textAlign: 'right'},
  addrCard: {alignItems: 'center', gap: 12, paddingVertical: 20},
  addr: {textAlign: 'center'},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14},
  sigRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10},
  sigMain: {flex: 1, minWidth: 0},
});
