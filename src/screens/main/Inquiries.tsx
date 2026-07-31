/**
 * Inquiries (T1.7.4) — the member's own conversations, as buyer or provider.
 *
 * The inbox for the marketplace: every inquiry the member is a party to, newest
 * activity first, each opening its thread ({@link Inquiry}). Mirrors My Listings
 * in shape — a plain list of tappable cards with a state badge — because it is
 * the same kind of "your own things across every state" view.
 */
import {useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Card, Heading, ScreenHeader, Text} from '../../components';
import {relativeTime, shortAddress} from '../../ledger';
import {useMyInquiries, useRefreshMarketplace} from '../../marketplace';
import type {StationInquiryState, StationMyInquiryRow} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function Inquiries({navigation}: MainStackScreenProps<'Inquiries'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading, isError} = useMyInquiries();
  const refresh = useRefreshMarketplace();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const rows = data ?? [];

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textMuted} />
      }>
      <ScreenHeader title="Inquiries" onBack={() => navigation.goBack()} />

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading your inquiries from the station…
          </Text>
        </Card>
      )}

      {isError && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Can’t reach your station
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your inquiries live on your station. Pull down to retry.
          </Text>
        </Card>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <View style={styles.empty}>
          <Heading level="headingSmall" style={styles.emptyTitle}>
            No inquiries yet
          </Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
            When you reach out about a listing — or someone reaches out about one
            of yours — the conversation shows up here.
          </Text>
        </View>
      )}

      {rows.length > 0 && (
        <View style={{gap: theme.spacing.sm}}>
          {rows.map(row => (
            <InquiryRow key={row.inquiry_id} theme={theme} navigation={navigation} row={row} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function InquiryRow({
  theme,
  navigation,
  row,
}: {
  theme: Theme;
  navigation: MainStackScreenProps<'Inquiries'>['navigation'];
  row: StationMyInquiryRow;
}) {
  const [pressed, setPressed] = useState(false);
  const roleLine =
    row.role === 'buyer'
      ? `You asked · ${shortAddress(row.counterparty)}`
      : `From ${shortAddress(row.counterparty)}`;

  return (
    <Pressable
      onPress={() => navigation.navigate('Inquiry', {inquiryId: row.inquiry_id})}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${row.listing_title}, ${stateLabel(row)}`}>
      <Card style={{backgroundColor: pressed ? theme.colors.surfaceSunken : undefined}}>
        <View style={styles.cardTop}>
          <View style={styles.cardHead}>
            <Text variant="label" color={theme.colors.text} numberOfLines={2} style={styles.cardTitle}>
              {row.listing_title}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
              {roleLine}
            </Text>
          </View>
          <View style={styles.cardRight}>
            {row.latest_offer_centi !== undefined && (
              <Amount
                centi={row.latest_offer_centi}
                signed={row.latest_offer_centi < 0}
                colored={false}
                size="sm"
              />
            )}
            <StateBadge state={row.state} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function StateBadge({state}: {state: StationInquiryState}) {
  switch (state) {
    case 'open':
      return (
        <Badge variant="success" size="sm" dot>
          Open
        </Badge>
      );
    case 'expired_pending':
      return (
        <Badge variant="warning" size="sm">
          Expired
        </Badge>
      );
    case 'closed':
      return (
        <Badge variant="neutral" size="sm">
          Closed
        </Badge>
      );
  }
}

/** "open" / "closed 2h ago" / "expired". */
function stateLabel(row: StationMyInquiryRow): string {
  if (row.state === 'open') {
    return `open · ${relativeTime(row.last_activity_at)}`;
  }
  return row.state === 'expired_pending' ? 'expired' : 'closed';
}

const styles = StyleSheet.create({
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  cardHead: {flex: 1, minWidth: 0, gap: 3},
  cardTitle: {fontWeight: '700'},
  cardRight: {alignItems: 'flex-end', gap: 4, flexShrink: 0},
  empty: {alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24},
  emptyTitle: {marginBottom: 6, textAlign: 'center'},
  emptyText: {textAlign: 'center'},
});
