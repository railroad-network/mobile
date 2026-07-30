/**
 * My Listings (T1.7.2) — the member's own offers, in whatever state. Unlike
 * browse, this shows closed and expired listings too: a provider's own list has
 * to, or a listing that went off offer looks deleted.
 *
 * Each card opens the listing's detail ({@link ListingDetail}), which is where a
 * provider takes an offer down — closing lives in that one place rather than
 * being duplicated on the card here.
 */
import {useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Button, Card, Heading, ScreenHeader, Text} from '../../components';
import {relativeTime} from '../../ledger';
import {categoryLabel, useMyListings, useRefreshMarketplace} from '../../marketplace';
import type {StationListingState, StationMyListingRow} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function MyListings({navigation}: MainStackScreenProps<'MyListings'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading, isError} = useMyListings();
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
      <ScreenHeader title="My listings" onBack={() => navigation.goBack()} />

      <Button fullWidth variant="secondary" onPress={() => navigation.navigate('CreateListing')}>
        + New listing
      </Button>

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading your listings from the station…
          </Text>
        </Card>
      )}

      {isError && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Can’t reach your station
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your listings live on your station. Pull down to retry.
          </Text>
        </Card>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <View style={styles.empty}>
          <Heading level="headingSmall" style={styles.emptyTitle}>
            Nothing listed yet
          </Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
            Offer goods, services, or a community resource — it shows up here and
            in the marketplace for the whole community.
          </Text>
        </View>
      )}

      {rows.map(row => (
        <MyListingCard key={row.listing_id} theme={theme} navigation={navigation} row={row} />
      ))}
    </ScrollView>
  );
}

function MyListingCard({
  theme,
  navigation,
  row,
}: {
  theme: Theme;
  navigation: MainStackScreenProps<'MyListings'>['navigation'];
  row: StationMyListingRow;
}) {
  const [pressed, setPressed] = useState(false);

  // The whole card opens the listing's detail (matching browse), which is where
  // the provider closes it.
  return (
    <Pressable
      onPress={() => navigation.navigate('ListingDetail', {listingId: row.listing_id})}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${stateLabel(row)}`}>
      <Card style={{backgroundColor: pressed ? theme.colors.surfaceSunken : undefined}}>
        <View style={styles.cardTop}>
          <View style={styles.cardHead}>
            <Text variant="label" color={theme.colors.text} numberOfLines={2} style={styles.cardTitle}>
              {row.title}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              {categoryLabel(row.category)} · {stateLabel(row)}
            </Text>
          </View>
          <View style={styles.cardRight}>
            {row.amount_centi === 0 && row.surface === 'commons' ? (
              <Text variant="label" color={theme.colors.credit}>
                Free
              </Text>
            ) : (
              <Amount centi={row.amount_centi} signed={row.amount_centi < 0} colored={false} size="sm" />
            )}
            <StateBadge theme={theme} state={row.state} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function StateBadge({theme: _theme, state}: {theme: Theme; state: StationListingState}) {
  switch (state) {
    case 'active':
      return (
        <Badge variant="success" size="sm" dot>
          Active
        </Badge>
      );
    case 'closed':
      return (
        <Badge variant="neutral" size="sm">
          Closed
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="warning" size="sm">
          Expired
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" size="sm">
          Draft
        </Badge>
      );
  }
}

/** "Active" / "Closed 2h ago" / "Expired". */
function stateLabel(row: StationMyListingRow): string {
  if (row.state === 'closed' && row.closed_at !== null) {
    return `closed ${relativeTime(row.closed_at)}`;
  }
  return row.state;
}

const styles = StyleSheet.create({
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  cardHead: {flex: 1, minWidth: 0, gap: 3},
  cardTitle: {fontWeight: '700'},
  cardRight: {alignItems: 'flex-end', gap: 4},
  empty: {alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24},
  emptyTitle: {marginBottom: 6, textAlign: 'center'},
  emptyText: {textAlign: 'center'},
});
