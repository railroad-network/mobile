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
  Identicon,
  ScreenHeader,
  Text,
} from '../../components';
import {relativeTime, settlementAt, stateBadge, useActivity} from '../../ledger';
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

/**
 * The "For" line's value. A marketplace payment's memo is
 * `"<listing title> · #<inquiry id>"` (see `inquiryMemo`); show just the listing,
 * since the id tail is only there to keep the memo unique. Payments made before
 * that format carried a bare `Inquiry <hex>` — read those as a plain "Marketplace
 * payment" rather than a wall of hash. Any other memo (a normal send) shows as-is.
 */
export function forLabel(memo: string | undefined): string {
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

          <Card style={styles.fields}>
            <DetailRow theme={theme} label="For" value={forLabel(tx.memo)} />
            <DetailRow
              theme={theme}
              label="Direction"
              value={tx.direction === 'in' ? 'Incoming credit' : 'Outgoing debit'}
            />
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
  heroBadge: {alignSelf: 'center'},
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
