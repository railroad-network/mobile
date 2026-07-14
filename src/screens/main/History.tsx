/**
 * Transaction history (T1.2.7) — the full, reverse-chronological ledger of this
 * member's transactions, grouped by day, with filter chips and a tap-through to
 * the detail view. Data comes from the same `useActivity` hook as Home (outbox +
 * mock/station activity with local decisions folded in), so a just-sent payment
 * or a just-confirmed proposal appears here immediately.
 *
 * The list is a `FlashList` for smooth scrolling at large history sizes. Day
 * grouping is done by flattening the sections into a single list of header and
 * row entries; `getItemType` keeps the two recycled separately and the header
 * positions are passed as `stickyHeaderIndices` so the day sticks while scrolling.
 */
import {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Heading, Identicon, Text} from '../../components';
import {
  dayLabel,
  relativeTime,
  stateBadge,
  useActivity,
  type Transaction,
  type TransactionDirection,
  type TransactionState,
} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {MainTabScreenProps} from '../../navigation/types';

/** A history filter: everything, by direction, or by a specific state. */
type Filter =
  | {kind: 'all'}
  | {kind: 'direction'; direction: TransactionDirection}
  | {kind: 'state'; state: TransactionState};

const FILTERS: {key: string; label: string; filter: Filter}[] = [
  {key: 'all', label: 'All', filter: {kind: 'all'}},
  {key: 'out', label: 'Sent', filter: {kind: 'direction', direction: 'out'}},
  {key: 'in', label: 'Received', filter: {kind: 'direction', direction: 'in'}},
  {key: 'pending', label: 'Pending', filter: {kind: 'state', state: 'pending'}},
  {key: 'settled', label: 'Settled', filter: {kind: 'state', state: 'settled'}},
  {key: 'cancelled', label: 'Cancelled', filter: {kind: 'state', state: 'cancelled'}},
];

function matches(tx: Transaction, filter: Filter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'direction':
      return tx.direction === filter.direction;
    case 'state':
      return tx.state === filter.state;
  }
}

/** A flattened history entry: a day header or a transaction row. */
type ListEntry = {type: 'header'; title: string} | {type: 'row'; tx: Transaction};

/**
 * Flattens a newest-first list into day headers followed by their rows — the
 * single-array shape FlashList wants. Returns the entries plus the indices of
 * the headers (for `stickyHeaderIndices`).
 */
function groupByDay(txs: Transaction[]): {entries: ListEntry[]; headerIndices: number[]} {
  const entries: ListEntry[] = [];
  const headerIndices: number[] = [];
  let lastTitle: string | undefined;
  for (const tx of txs) {
    const title = dayLabel(tx.timestamp);
    if (title !== lastTitle) {
      headerIndices.push(entries.length);
      entries.push({type: 'header', title});
      lastTitle = title;
    }
    entries.push({type: 'row', tx});
  }
  return {entries, headerIndices};
}

export function History({navigation}: MainTabScreenProps<'History'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading} = useActivity();
  const [activeKey, setActiveKey] = useState('all');

  const active = FILTERS.find(f => f.key === activeKey) ?? FILTERS[0];
  const {entries, headerIndices} = useMemo(
    () => groupByDay((data ?? []).filter(tx => matches(tx, active.filter))),
    [data, active.filter],
  );

  return (
    <View style={[styles.fill, {backgroundColor: theme.colors.bg}]}>
      <View style={{paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg}}>
        <Heading level="headingLarge">Activity</Heading>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chips, {paddingHorizontal: theme.spacing.lg}]}>
        {FILTERS.map(f => (
          <FilterChip
            key={f.key}
            theme={theme}
            label={f.label}
            active={f.key === activeKey}
            onPress={() => setActiveKey(f.key)}
          />
        ))}
      </ScrollView>

      {isLoading ? (
        <HistorySkeleton theme={theme} />
      ) : (
        <FlashList
          data={entries}
          keyExtractor={(item, index) =>
            item.type === 'header' ? `h:${item.title}` : item.tx.id + index
          }
          getItemType={item => item.type}
          stickyHeaderIndices={headerIndices}
          contentContainerStyle={{paddingBottom: insets.bottom + theme.spacing.xl}}
          ListEmptyComponent={<EmptyHistory theme={theme} filtered={activeKey !== 'all'} />}
          renderItem={({item}) =>
            item.type === 'header' ? (
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                style={[
                  styles.dayHeader,
                  {backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.lg},
                ]}>
                {item.title.toUpperCase()}
              </Text>
            ) : (
              <HistoryRow
                theme={theme}
                tx={item.tx}
                onPress={() => navigation.navigate('TransactionDetail', {id: item.tx.id})}
              />
            )
          }
        />
      )}
    </View>
  );
}

function FilterChip({
  theme,
  label,
  active,
  onPress,
}: {
  theme: Theme;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter: ${label}`}
      accessibilityState={{selected: active}}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.colors.text : theme.colors.surfaceRaised,
          borderColor: active ? theme.colors.text : theme.colors.borderStrong,
        },
      ]}>
      <Text variant="label" color={active ? theme.colors.textInverse : theme.colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

function HistoryRow({theme, tx, onPress}: {theme: Theme; tx: Transaction; onPress: () => void}) {
  const badge = stateBadge(tx.state);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${tx.memo ?? tx.counterparty}, ${badge.label}`}
      style={[
        styles.row,
        {
          paddingHorizontal: theme.spacing.lg,
          borderTopColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        },
      ]}>
      <Identicon seed={tx.counterpartyAddress} size={40} radius={11} />
      <View style={styles.rowMain}>
        <Text variant="label" color={theme.colors.text} numberOfLines={1} style={styles.rowLabel}>
          {tx.memo ?? tx.counterparty}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
          {tx.direction === 'in' ? 'from' : 'to'} {tx.counterparty} · {relativeTime(tx.timestamp)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Amount centi={tx.amountCenti} size="sm" />
        <Badge variant={badge.variant} size="sm" dot>
          {badge.label}
        </Badge>
      </View>
    </Pressable>
  );
}

function EmptyHistory({theme, filtered}: {theme: Theme; filtered: boolean}) {
  return (
    <View style={styles.empty}>
      <Heading level="headingSmall" style={styles.emptyTitle}>
        {filtered ? 'Nothing matches this filter' : 'No transactions yet'}
      </Heading>
      <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
        {filtered
          ? 'Try a different filter to see more.'
          : 'Send or receive Commons to get started.'}
      </Text>
    </View>
  );
}

/** Skeleton rows while activity loads (a calmer wait than a spinner). */
function HistorySkeleton({theme}: {theme: Theme}) {
  return (
    <View style={{paddingTop: theme.spacing.md}}>
      {[0, 1, 2, 3, 4].map(i => (
        <View key={i} style={[styles.row, {paddingHorizontal: theme.spacing.lg}]}>
          <View style={[styles.skelDot, {backgroundColor: theme.colors.surfaceSunken}]} />
          <View style={styles.rowMain}>
            <View style={[styles.skelBar, styles.skelWide, {backgroundColor: theme.colors.surfaceSunken}]} />
            <View style={[styles.skelBar, styles.skelNarrow, {backgroundColor: theme.colors.surfaceSunken}]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  chips: {gap: 8, paddingTop: 12, paddingBottom: 12},
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  dayHeader: {paddingTop: 10, paddingBottom: 6, fontWeight: '700', letterSpacing: 0.6},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1},
  rowMain: {flex: 1, minWidth: 0, gap: 4},
  rowLabel: {fontWeight: '700'},
  rowRight: {alignItems: 'flex-end', gap: 4},
  empty: {alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32},
  emptyTitle: {marginBottom: 6},
  emptyText: {textAlign: 'center'},
  skelDot: {width: 40, height: 40, borderRadius: 11},
  skelBar: {height: 11, borderRadius: 6},
  skelWide: {width: '55%'},
  skelNarrow: {width: '35%'},
});
