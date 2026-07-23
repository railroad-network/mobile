/**
 * The vouching browser (T1.4.5) — the persistent home for a member's vouches,
 * reached from the Community tab. Two tabs: vouches you've *made* (signed) and
 * vouches you've *received* (someone named you). Each is a live read of the
 * station's log via {@link useVouches}; a search box filters the fetched set by
 * name / address / statement, and the list pages in 20 at a time.
 *
 * A "made" row shows the local nickname you gave the person at vouch time (a
 * private, device-only label from {@link wallet/vouchNicknames}); a "received"
 * row shows the voucher's shortened address, since you never labelled them.
 * Tapping a row opens its full detail with a verification line.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Field, Heading, Identicon, Text} from '../../components';
import {formatCommons, relativeTime, shortAddress, useVouches} from '../../ledger';
import {loadVouchNicknames, type VouchNicknames} from '../../wallet/vouchNicknames';
import type {StationVouchListRow} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps, VouchDirection} from '../../navigation/types';

/** How many rows to reveal per page as the list scrolls. */
const PAGE = 20;

export function VouchList({route, navigation}: MainStackScreenProps<'VouchList'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading} = useVouches();
  const [tab, setTab] = useState<VouchDirection>(route.params.initial);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [nicknames, setNicknames] = useState<VouchNicknames>({});

  // Reload the local nickname map whenever the screen refocuses, so a name
  // edited elsewhere (or a vouch just made) is reflected.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadVouchNicknames()
        .then(m => active && setNicknames(m))
        .catch(() => active && setNicknames({}));
      return () => {
        active = false;
      };
    }, []),
  );

  const rows = useMemo(
    () => (tab === 'given' ? data?.given ?? [] : data?.received ?? []),
    [tab, data],
  );

  // The counterparty and its label depend on direction: for a vouch you made,
  // that's the subject (with your nickname for them); for one you received, the
  // voucher (a shortened address — you never labelled them).
  const labelFor = useCallback(
    (row: StationVouchListRow): {address: string; label: string} => {
      if (tab === 'given') {
        const nick = nicknames[row.subject_address];
        return {
          address: row.subject_address,
          label: nick !== undefined && nick.length > 0 ? nick : shortAddress(row.subject_address),
        };
      }
      return {address: row.voucher_address, label: shortAddress(row.voucher_address)};
    },
    [tab, nicknames],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
      return rows;
    }
    return rows.filter(row => {
      const {address, label} = labelFor(row);
      return (
        label.toLowerCase().includes(q) ||
        address.toLowerCase().includes(q) ||
        row.statement.toLowerCase().includes(q)
      );
    });
  }, [rows, query, labelFor]);

  // Reset paging when the tab or search changes so we don't reveal a stale count.
  useEffect(() => {
    setVisible(PAGE);
  }, [tab, query]);

  const shown = filtered.slice(0, visible);

  return (
    <View style={[styles.fill, {backgroundColor: theme.colors.bg}]}>
      <View style={{paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md}}>
        <Heading level="headingLarge">Your vouches</Heading>
        <View style={styles.tabs}>
          <Tab theme={theme} label="I’ve made" active={tab === 'given'} onPress={() => setTab('given')} />
          <Tab theme={theme} label="I’ve received" active={tab === 'received'} onPress={() => setTab('received')} />
        </View>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, address, or statement"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <FlashList
        data={shown}
        keyExtractor={item => item.vouch_id}
        contentContainerStyle={{paddingBottom: insets.bottom + theme.spacing.xl, paddingTop: theme.spacing.sm}}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (visible < filtered.length) {
            setVisible(v => v + PAGE);
          }
        }}
        ListEmptyComponent={
          isLoading ? null : <EmptyVouches theme={theme} tab={tab} filtered={query.trim().length > 0} />
        }
        renderItem={({item}) => {
          const {address, label} = labelFor(item);
          return (
            <VouchRow
              theme={theme}
              row={item}
              address={address}
              label={label}
              onPress={() => navigation.navigate('VouchDetail', {vouch: item, mode: tab})}
            />
          );
        }}
      />
    </View>
  );
}

function Tab({theme, label, active, onPress}: {theme: Theme; label: string; active: boolean; onPress: () => void}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{selected: active}}
      style={[
        styles.tab,
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

function VouchRow({
  theme,
  row,
  address,
  label,
  onPress,
}: {
  theme: Theme;
  row: StationVouchListRow;
  address: string;
  label: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`Vouch with ${label}`}
      style={[
        styles.row,
        {
          paddingHorizontal: theme.spacing.lg,
          borderTopColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        },
      ]}>
      <Identicon seed={address} size={40} radius={11} />
      <View style={styles.rowMain}>
        <Text variant="label" color={theme.colors.text} numberOfLines={1} style={styles.rowLabel}>
          {label}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
          {row.statement.trim().length > 0 ? row.statement.trim() : 'No statement'} · {relativeTime(row.issued_at)}
        </Text>
      </View>
      {row.stake_centi > 0 && (
        <View style={styles.rowRight}>
          <Text variant="caption" color={theme.colors.text}>
            {formatCommons(row.stake_centi)}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            staked
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function EmptyVouches({theme, tab, filtered}: {theme: Theme; tab: VouchDirection; filtered: boolean}) {
  return (
    <View style={styles.empty}>
      <Heading level="headingSmall" style={styles.emptyTitle}>
        {filtered
          ? 'Nothing matches your search'
          : tab === 'given'
            ? 'You haven’t vouched for anyone yet'
            : 'No one has vouched for you yet'}
      </Heading>
      <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
        {filtered
          ? 'Try a different name or address.'
          : tab === 'given'
            ? 'Vouch for someone you know in person to grow the web of trust.'
            : 'When someone vouches for you, it appears here.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  tabs: {flexDirection: 'row', gap: 8},
  tab: {
    flex: 1,
    height: 38,
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1},
  rowMain: {flex: 1, minWidth: 0, gap: 4},
  rowLabel: {fontWeight: '700'},
  rowRight: {alignItems: 'flex-end', gap: 2},
  empty: {alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32},
  emptyTitle: {marginBottom: 6, textAlign: 'center'},
  emptyText: {textAlign: 'center'},
});
