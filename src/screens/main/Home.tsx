/**
 * Wallet home (T1.2.4) — the screen the member sees on every app open: who they
 * are, their balance, the two things they do most (send / request), and their
 * recent activity.
 *
 * Data comes from the ledger hooks (`ledger/useLedger`), which read from the
 * paired station over the authenticated channel (T1.3.4). When no station is
 * paired the screen prompts the member to pair one; pull-to-refresh, offline,
 * and empty states are all wired.
 * Marketplace, reputation, vouching, governance, and the confirmations inbox
 * that the design system's Home also shows are out of scope here (later
 * milestones / T1.2.6).
 */
import {useCallback, useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Badge,
  Banner,
  Button,
  ConnectivityStatus,
  Heading,
  Identicon,
  Text,
} from '../../components';
import {
  isExpired,
  relativeTime,
  shortAddress,
  stateBadge,
  useActivity,
  useBalance,
  useConnectivity,
  useIdentity,
  useInbox,
  useRefreshLedger,
  type Transaction,
} from '../../ledger';
import {useActiveStation} from '../../network/useStation';
import {useTheme, type Theme} from '../../theme';
import type {MainTabScreenProps} from '../../navigation/types';

/** How many recent transactions the home shows before "See all". */
const RECENT_LIMIT = 5;

export function Home({navigation}: MainTabScreenProps<'Home'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const identity = useIdentity();
  const balance = useBalance();
  const activity = useActivity();
  const inbox = useInbox();
  const connectivity = useConnectivity();
  const refreshLedger = useRefreshLedger();
  const {station, isLoading: stationLoading} = useActiveStation();
  // No station paired yet: the reads have nothing to talk to. Prompt to pair
  // rather than leave the balance an unexplained dash.
  const noStation = !stationLoading && station === null;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshLedger();
    } finally {
      setRefreshing(false);
    }
  }, [refreshLedger]);

  const name =
    identity.data?.nickname ??
    (identity.data ? shortAddress(identity.data.address) : '…');
  const items = activity.data ?? [];
  const recent = items.slice(0, RECENT_LIMIT);
  const inboxItems = inbox.data ?? [];

  const hero = heroColors(theme);

  return (
    <View style={[styles.fill, {backgroundColor: theme.colors.bg}]}>
      {/* Header — identity + connectivity */}
      <View
        style={[
          styles.header,
          {paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg},
        ]}>
        <Identicon seed={identity.data?.address ?? name} size={44} />
        <View style={styles.headerText}>
          <Text variant="mono" color={theme.colors.text} numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {identity.data?.community !== undefined && (
            <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
              {identity.data.community}
            </Text>
          )}
        </View>
        <ConnectivityStatus
          level={connectivity.isOffline ? 'offline' : connectivity.level}
          showLabel={connectivity.isOffline}
        />
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={{
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.textMuted}
          />
        }>
        {noStation ? (
          <View style={{paddingHorizontal: theme.spacing.lg}}>
            <Banner
              variant="info"
              title="Connect to a station"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onPress={() => navigation.navigate('Discovery')}>
                  Find a station
                </Button>
              }>
              Pair with a Railroad station on your network to see your balance and send Commons.
            </Banner>
          </View>
        ) : (
          connectivity.isOffline && (
            <View style={{paddingHorizontal: theme.spacing.lg}}>
              <Banner variant="warning" title="You’re offline">
                Showing your last synced balance. New payments will send when you reconnect.
              </Banner>
            </View>
          )
        )}

        {/* Balance hero */}
        <View style={{paddingHorizontal: theme.spacing.lg}}>
          <View style={[styles.balCard, {backgroundColor: hero.bg}]}>
            <Text variant="label" color={theme.colors.accent} style={styles.balLabel}>
              YOUR BALANCE
            </Text>
            <View style={styles.balAmount}>
              {balance.data ? (
                <Amount
                  centi={balance.data.centi}
                  size="xl"
                  colored={false}
                  color={hero.fg}
                  signed={balance.data.centi < 0}
                />
              ) : (
                <Text variant="displayLarge" color={hero.fg}>
                  —
                </Text>
              )}
            </View>
            <Text variant="caption" color={hero.fgMuted} style={styles.balSub}>
              What you hold in the Common. The ledger always nets to zero.
            </Text>
          </View>
        </View>

        {/* Quick actions */}
        <View style={[styles.actions, {paddingHorizontal: theme.spacing.lg}]}>
          <View style={styles.actionItem}>
            <Button variant="primary" size="lg" fullWidth onPress={() => navigation.navigate('Send')}>
              Send
            </Button>
          </View>
          <View style={styles.actionItem}>
            <Button variant="secondary" size="lg" fullWidth onPress={() => navigation.navigate('Receive')}>
              Request
            </Button>
          </View>
        </View>

        {/* Inbox — incoming proposals awaiting confirmation (T1.2.6) */}
        {inboxItems.length > 0 && (
          <View>
            <View style={[styles.sectionHead, {paddingHorizontal: theme.spacing.lg}]}>
              <Heading level="headingSmall">To confirm</Heading>
              <Badge variant="warning" size="sm">
                {`${inboxItems.length} waiting`}
              </Badge>
            </View>
            {inboxItems.map(tx => (
              <InboxRow
                key={tx.id}
                tx={tx}
                onPress={() => navigation.navigate('ConfirmReceived', {id: tx.id})}
              />
            ))}
          </View>
        )}

        {/* Recent activity */}
        <View style={[styles.sectionHead, {paddingHorizontal: theme.spacing.lg}]}>
          <Heading level="headingSmall">Recent activity</Heading>
          {items.length > 0 && (
            <Text
              variant="label"
              color={theme.colors.textLink}
              onPress={() => navigation.navigate('History')}
              accessibilityRole="button"
              accessibilityLabel="See all activity">
              See all
            </Text>
          )}
        </View>

        {activity.isLoading ? (
          <View style={{paddingHorizontal: theme.spacing.lg}}>
            <Text variant="body" color={theme.colors.textMuted}>
              Loading your activity…
            </Text>
          </View>
        ) : recent.length === 0 ? (
          <EmptyActivity />
        ) : (
          <View>
            {recent.map(tx => (
              <ActivityRow
                key={tx.id}
                tx={tx}
                onPress={() => navigation.navigate('TransactionDetail', {id: tx.id})}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ActivityRow({tx, onPress}: {tx: Transaction; onPress: () => void}) {
  const theme = useTheme();
  const badge = stateBadge(tx.state);
  // NativeWind drops a function-form `style` on Pressable, so track the pressed
  // state ourselves and pass a plain array style (see the Button primitive).
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

function InboxRow({tx, onPress}: {tx: Transaction; onPress: () => void}) {
  const theme = useTheme();
  const expired = isExpired(tx);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${tx.memo ?? tx.counterparty}, ${expired ? 'expired' : 'confirm'}`}
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
          from {tx.counterparty} · {relativeTime(tx.timestamp)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Amount centi={tx.amountCenti} size="sm" />
        <Badge variant={expired ? 'neutral' : 'warning'} size="sm" dot>
          {expired ? 'Expired' : 'Confirm'}
        </Badge>
      </View>
    </Pressable>
  );
}

function EmptyActivity() {
  const theme = useTheme();
  return (
    <View style={[styles.empty, {paddingHorizontal: theme.spacing.xl}]}>
      <Heading level="headingSmall" style={styles.emptyTitle}>
        No transactions yet
      </Heading>
      <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
        Send or receive Commons to get started.
      </Text>
    </View>
  );
}

/** The balance hero is a dark "ink" card in light mode, a raised card in dark. */
function heroColors(theme: Theme): {bg: string; fg: string; fgMuted: string} {
  if (theme.scheme === 'light') {
    return {bg: theme.colors.text, fg: theme.colors.textInverse, fgMuted: 'rgba(251, 248, 242, 0.66)'};
  }
  return {bg: theme.colors.surfaceRaised, fg: theme.colors.text, fgMuted: theme.colors.textSecondary};
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 16},
  headerText: {flex: 1, minWidth: 0},
  name: {fontWeight: '600', fontSize: 16},
  balCard: {borderRadius: 20, padding: 22},
  balLabel: {letterSpacing: 1, fontWeight: '700'},
  balAmount: {marginTop: 10, marginBottom: 6},
  balSub: {lineHeight: 17},
  actions: {flexDirection: 'row', gap: 12},
  actionItem: {flex: 1},
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1},
  rowMain: {flex: 1, minWidth: 0},
  rowLabel: {fontWeight: '700'},
  rowRight: {alignItems: 'flex-end', gap: 4},
  empty: {alignItems: 'center', paddingVertical: 40},
  emptyTitle: {marginBottom: 6},
  emptyText: {textAlign: 'center'},
});
