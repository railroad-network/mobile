/**
 * Transaction detail (opened from Home / History). This is the **minimal**
 * version T1.2.4 needs so tapping an activity row lands somewhere real; T1.2.7
 * expands it with the full field set (nonce, signatures, copyable address + QR,
 * "View on station log"). It reads the transaction from the already-fetched
 * activity cache.
 */
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Card, Heading, Identicon, Text} from '../../components';
import {relativeTime, shortAddress, stateBadge, useActivity} from '../../ledger';
import {useTheme} from '../../theme';
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

export function TransactionDetail({route, navigation}: MainStackScreenProps<'TransactionDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data} = useActivity();
  const tx = data?.find(t => t.id === route.params.id);

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <View style={{gap: theme.spacing.xs}}>
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
        <Heading level="headingLarge">Transaction</Heading>
      </View>

      {tx === undefined ? (
        <Text variant="body" color={theme.colors.textSecondary}>
          This transaction isn’t available.
        </Text>
      ) : (
        <>
          <Card style={styles.hero}>
            <Identicon seed={tx.counterpartyAddress} size={52} />
            <Amount centi={tx.amountCenti} size="lg" />
            <Badge variant={stateBadge(tx.state).variant} dot>
              {stateBadge(tx.state).label}
            </Badge>
          </Card>

          <View style={{gap: theme.spacing.md}}>
            <DetailField label={tx.direction === 'in' ? 'From' : 'To'} value={tx.counterparty} />
            <DetailField label="Address" value={shortAddress(tx.counterpartyAddress)} mono />
            {tx.memo !== undefined && tx.memo.length > 0 && (
              <DetailField label="Memo" value={tx.memo} />
            )}
            <DetailField label="When" value={`${formatDateTime(tx.timestamp)} · ${relativeTime(tx.timestamp)}`} />
            <DetailField label="Transaction ID" value={tx.id} mono />
          </View>

          <Text variant="caption" color={theme.colors.textMuted}>
            Full details, signatures, and the station log link arrive in a later update.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function DetailField({label, value, mono = false}: {label: string; value: string; mono?: boolean}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="caption" color={theme.colors.textMuted}>
        {label}
      </Text>
      <Text variant={mono ? 'mono' : 'body'} color={theme.colors.text}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {alignItems: 'center', gap: 12, paddingVertical: 24},
  field: {gap: 2},
});
