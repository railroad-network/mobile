/**
 * Contracts (T1.7.7) — the member's own recurring service contracts, as buyer or
 * provider.
 *
 * The inbox for standing orders: every contract the member is a party to, newest
 * first, each opening its status ({@link Contract}). Mirrors {@link Inquiries} in
 * shape — a plain list of tappable cards with a state badge — because it is the
 * same kind of "your own things across every state" view.
 */
import {useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Card, Heading, ScreenHeader, Text} from '../../components';
import {formatCommons, shortAddress} from '../../ledger';
import {useMyContracts, useRefreshMarketplace} from '../../marketplace';
import type {StationContractRow} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function Contracts({navigation}: MainStackScreenProps<'Contracts'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading, isError} = useMyContracts();
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
      <ScreenHeader title="Contracts" onBack={() => navigation.goBack()} />

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading your contracts from the station…
          </Text>
        </Card>
      )}

      {isError && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Can’t reach your station
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your contracts live on your station. Pull down to retry.
          </Text>
        </Card>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <View style={styles.empty}>
          <Heading level="headingSmall" style={styles.emptyTitle}>
            No contracts yet
          </Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
            When you agree to a recurring service — or someone signs up for one of
            yours — the standing contract shows up here.
          </Text>
        </View>
      )}

      {rows.length > 0 && (
        <View style={{gap: theme.spacing.sm}}>
          {rows.map(row => (
            <ContractRowCard key={row.contract_id} theme={theme} navigation={navigation} row={row} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ContractRowCard({
  theme,
  navigation,
  row,
}: {
  theme: Theme;
  navigation: MainStackScreenProps<'Contracts'>['navigation'];
  row: StationContractRow;
}) {
  const [pressed, setPressed] = useState(false);
  const roleLine =
    row.role === 'buyer'
      ? `You subscribe · ${shortAddress(row.counterparty)}`
      : `You provide · ${shortAddress(row.counterparty)}`;

  return (
    <Pressable
      onPress={() => navigation.navigate('Contract', {contractId: row.contract_id})}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${row.listing_title}, ${stateLabel(row.state)}`}>
      <Card style={{backgroundColor: pressed ? theme.colors.surfaceSunken : undefined}}>
        <View style={styles.cardTop}>
          <View style={styles.cardHead}>
            <Text variant="label" color={theme.colors.text} numberOfLines={2} style={styles.cardTitle}>
              {row.listing_title}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
              {roleLine}
            </Text>
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {`${formatCommons(row.commons_per_period_centi)} per period · ${row.periods_charged} of ${
                row.periods_charged + row.periods_remaining
              } charged`}
            </Text>
          </View>
          <View style={styles.cardRight}>
            <StateBadge state={row.state} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/** The row's status pill: active (billing), terminating (winding down), ended. */
function StateBadge({state}: {state: StationContractRow['state']}) {
  const {variant, label, dot} = badgeStyle(state);
  return (
    <Badge variant={variant} size="sm" dot={dot}>
      {label}
    </Badge>
  );
}

function badgeStyle(state: StationContractRow['state']): {
  variant: 'success' | 'warning' | 'neutral';
  label: string;
  dot: boolean;
} {
  switch (state) {
    case 'active':
      return {variant: 'success', label: 'Active', dot: true};
    case 'terminating':
      return {variant: 'warning', label: 'Ending', dot: false};
    case 'ended':
    default:
      return {variant: 'neutral', label: 'Ended', dot: false};
  }
}

/** The a11y state word for a contract row. */
function stateLabel(state: StationContractRow['state']): string {
  switch (state) {
    case 'active':
      return 'active';
    case 'terminating':
      return 'ending';
    case 'ended':
    default:
      return 'ended';
  }
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
