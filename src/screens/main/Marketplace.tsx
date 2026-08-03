/**
 * The marketplace browse screen (T1.7.1) — where a member finds what the
 * community is offering. M1.6 built the listing data model and T1.7.0 put it on
 * the wire; this is the first screen that reads it.
 *
 * The shape follows the surfaces the log records: a segmented control picks one
 * of Goods / Services / Commons (the station's `surface` filter — a listing is
 * always in exactly one), and the search text and chips refine within it. Every
 * change to any of those restarts a fresh ranked search from the first page,
 * because ranking is per query; scrolling to the end pages the *current* one.
 *
 * A browse row shows only what a member needs to choose to tap: title, price,
 * the lister's identicon and reputation band, and the fulfillment indicator its
 * surface calls for. The rest — description, requirements, vouching context —
 * lives behind the tap, on {@link ListingDetail}. The list only ever holds
 * *active* listings: the station's index carries nothing else, so there is no
 * "show closed" toggle to offer here (a listing that closes after browse is
 * caught on the detail screen instead).
 */
import {useMemo, useState} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Card, Field, Heading, Identicon, ScreenHeader, Text} from '../../components';
import {dayLabel, formatCommons, shortAddress} from '../../ledger';
import {
  SURFACES,
  CATEGORIES,
  PRICE_CEILINGS,
  REPUTATION_FLOORS,
  bandVariant,
  categoryLabel,
  useDebouncedValue,
  useMarketplaceSearch,
  useRefreshMarketplace,
  type MarketplaceFilters,
} from '../../marketplace';
import type {StationListingCard, StationSurface} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import type {MainStackScreenProps} from '../../navigation/types';

/** How long typing must settle before a search fires (see {@link useDebouncedValue}). */
const SEARCH_DEBOUNCE_MS = 350;

export function Marketplace({navigation}: MainStackScreenProps<'Marketplace'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [surface, setSurface] = useState<StationSurface>('goods');
  const [rawSearch, setRawSearch] = useState('');
  const [categoryKey, setCategoryKey] = useState('any');
  const [priceKey, setPriceKey] = useState('any');
  const [reputationKey, setReputationKey] = useState('any');

  // The query fires on the settled text, not each keystroke, so a fast typist
  // does not queue a ranked search per character.
  const search = useDebouncedValue(rawSearch, SEARCH_DEBOUNCE_MS);

  const filters: MarketplaceFilters = useMemo(
    () => ({
      surface,
      text: search,
      category: categoryKey === 'any' ? undefined : categoryKey,
      maxPriceCenti: PRICE_CEILINGS.find(p => p.key === priceKey)?.maxPriceCenti,
      minProviderReputation: REPUTATION_FLOORS.find(r => r.key === reputationKey)?.minComposite,
    }),
    [surface, search, categoryKey, priceKey, reputationKey],
  );

  const query = useMarketplaceSearch(filters);
  const refresh = useRefreshMarketplace();
  const [refreshing, setRefreshing] = useState(false);
  // A listing's signer is its provider, in the same bech32m form as the wallet's
  // address — so a card is the viewer's own when they match.
  const {wallet} = useWalletSession();
  const myAddress = wallet?.address ?? null;

  const listings = useMemo(
    () => query.data?.pages.flatMap(page => page.listings) ?? [],
    [query.data],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = categoryKey !== 'any' || priceKey !== 'any' || reputationKey !== 'any' || search.trim().length > 0;

  return (
    <View style={[styles.fill, {backgroundColor: theme.colors.bg}]}>
      <View style={{paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md}}>
        <ScreenHeader title="Marketplace" onBack={() => navigation.goBack()} />

        {/* Surface segment — the one filter a listing always has exactly one of. */}
        <View style={[styles.segment, {borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md}]}>
          {SURFACES.map(s => (
            <Segment
              key={s.tag}
              theme={theme}
              label={s.label}
              active={s.tag === surface}
              onPress={() => setSurface(s.tag)}
            />
          ))}
        </View>

        <Field
          placeholder={`Search ${surfaceNoun(surface)}`}
          value={rawSearch}
          onChangeText={setRawSearch}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search the marketplace"
        />
      </View>

      {/* Category chips */}
      <ChipStrip theme={theme}>
        <Chip theme={theme} label="Any category" active={categoryKey === 'any'} onPress={() => setCategoryKey('any')} />
        {CATEGORIES.map(c => (
          <Chip key={c} theme={theme} label={categoryLabel(c)} active={categoryKey === c} onPress={() => setCategoryKey(c)} />
        ))}
      </ChipStrip>

      {/* Price chips */}
      <ChipStrip theme={theme}>
        {PRICE_CEILINGS.map(p => (
          <Chip key={p.key} theme={theme} label={p.label} active={priceKey === p.key} onPress={() => setPriceKey(p.key)} />
        ))}
      </ChipStrip>

      {/* Provider-reputation chips — their own row (a fuller filter surface is
          planned; one row per dimension keeps it legible until then). */}
      <ChipStrip theme={theme}>
        {REPUTATION_FLOORS.map(r => (
          <Chip key={r.key} theme={theme} label={r.label} active={reputationKey === r.key} onPress={() => setReputationKey(r.key)} />
        ))}
      </ChipStrip>

      {query.isLoading ? (
        <BrowseSkeleton theme={theme} />
      ) : (
        <FlashList
          data={listings}
          keyExtractor={item => item.listing_id}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            paddingBottom: insets.bottom + theme.spacing.xl,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textMuted} />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          ListEmptyComponent={
            <BrowseEmpty theme={theme} surface={surface} filtered={filtered} isError={query.isError} />
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <Text variant="caption" color={theme.colors.textMuted} style={styles.footer}>
                Loading more…
              </Text>
            ) : null
          }
          ItemSeparatorComponent={CardSeparator}
          renderItem={({item}) => (
            <ListingCardRow
              theme={theme}
              card={item}
              mine={myAddress !== null && item.provider === myAddress}
              onPress={() => navigation.navigate('ListingDetail', {listingId: item.listing_id})}
            />
          )}
        />
      )}
    </View>
  );
}

/** The gap between two browse cards. Module-level so FlashList sees a stable type. */
function CardSeparator() {
  const theme = useTheme();
  return <View style={{height: theme.spacing.sm}} />;
}

/** One segment of the surface control: fills with the ink color when active. */
function Segment({theme, label, active, onPress}: {theme: Theme; label: string; active: boolean; onPress: () => void}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{selected: active}}
      accessibilityLabel={label}
      style={[styles.segmentItem, {backgroundColor: active ? theme.colors.text : 'transparent'}]}>
      <Text variant="label" color={active ? theme.colors.textInverse : theme.colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A horizontally-scrolling strip of filter chips (mirrors History's chip row). */
function ChipStrip({theme, children}: {theme: Theme; children: React.ReactNode}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsScroll}
      contentContainerStyle={[styles.chips, {paddingHorizontal: theme.spacing.lg}]}>
      {children}
    </ScrollView>
  );
}

function Chip({theme, label, active, onPress}: {theme: Theme; label: string; active: boolean; onPress: () => void}) {
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
      {/* One line: a two-word label like "Any provider" must not wrap and get its
          second word clipped by the chip's fixed height. */}
      <Text
        variant="label"
        numberOfLines={1}
        color={active ? theme.colors.textInverse : theme.colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One browse row. Everything the card draws; the rest is behind the tap.
 * The viewer's own listing shows a "Your listing" line in place of the lister's
 * address — your own address is noise to you. */
function ListingCardRow({
  theme,
  card,
  mine,
  onPress,
}: {
  theme: Theme;
  card: StationListingCard;
  mine: boolean;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${mine ? 'Your listing, ' : ''}${card.title}, ${priceLabel(card)}`}>
      {/* A later `backgroundColor` overrides Card's default; `undefined` is
          skipped in flattening, so the card keeps its raised fill when idle. */}
      <Card style={{backgroundColor: pressed ? theme.colors.surfaceSunken : undefined, gap: theme.spacing.sm}}>

        <View style={styles.cardTop}>
          <View style={styles.cardHead}>
            <Text variant="label" color={theme.colors.text} numberOfLines={2} style={styles.cardTitle}>
              {card.title}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              {categoryLabel(card.category)}
            </Text>
          </View>
          <PriceTag theme={theme} card={card} />
        </View>

        <View style={[styles.cardFoot, {borderTopColor: theme.colors.border}]}>
          <View style={styles.provider}>
            <Identicon seed={card.provider} size={24} radius={7} />
            {mine ? (
              <Text variant="caption" color={theme.colors.accentStrong} numberOfLines={1} style={[styles.providerName, styles.mineLabel]}>
                Your listing
              </Text>
            ) : (
              <>
                <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1} style={styles.providerName}>
                  {shortAddress(card.provider)}
                </Text>
                <Badge variant={bandVariant(card.provider_band)} size="sm">
                  {card.provider_band}
                </Badge>
              </>
            )}
          </View>
          <Fulfillment theme={theme} card={card} />
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * The price, worded for its kind. Free and a Commons subsidy get words, since a
 * bare "−3.00" reads as a loss rather than the taker being paid; everything else
 * renders through {@link Amount} so it carries the Common mark like the rest of
 * the app. Never signed for a normal price (a "+" on a price makes no sense),
 * and never colored (a price is not a ledger credit or debit).
 */
function PriceTag({theme, card}: {theme: Theme; card: StationListingCard}) {
  if (card.amount_centi === 0 && card.surface === 'commons') {
    return (
      <Text variant="label" color={theme.colors.credit}>
        Free
      </Text>
    );
  }
  return (
    <View style={styles.cardPrice}>
      {card.amount_centi < 0 && (
        <Text variant="caption" color={theme.colors.textMuted}>
          Subsidy
        </Text>
      )}
      <Amount centi={card.amount_centi} signed={card.amount_centi < 0} colored={false} size="sm" />
      {card.negotiable && (
        <Text variant="caption" color={theme.colors.textMuted}>
          Negotiable
        </Text>
      )}
    </View>
  );
}

/** The fulfillment indicator, per surface: stock for Goods, next slot for
 * Services, availability alone for Commons. */
function Fulfillment({theme, card}: {theme: Theme; card: StationListingCard}) {
  const {availability: a} = card;
  let label: string | undefined;
  if (card.surface === 'goods' && a.capacity !== null) {
    label = a.capacity === 0 ? 'Out of stock' : `${a.capacity} left`;
  } else if (card.surface === 'services' && a.next_slot !== null) {
    // A next slot is always in the future, so a past-relative time ("just now")
    // would be wrong — show the calendar day it opens.
    label = `Next ${dayLabel(a.next_slot)}`;
  } else if (a.status === 'unavailable') {
    label = 'Unavailable';
  } else if (a.status === 'limited_stock') {
    label = 'Limited';
  }
  if (label === undefined) {
    return null;
  }
  const muted = a.status === 'unavailable' || (card.surface === 'goods' && a.capacity === 0);
  return (
    // One line, never shrinks — the provider block yields the width so "6 left"
    // can't wrap its suffix onto a clipped second line.
    <Text
      variant="caption"
      color={muted ? theme.colors.textMuted : theme.colors.textSecondary}
      numberOfLines={1}
      style={styles.fulfillment}>
      {label}
    </Text>
  );
}

/** Empty / error state — never a blank list. Distinguishes offline from "no hits". */
function BrowseEmpty({
  theme,
  surface,
  filtered,
  isError,
}: {
  theme: Theme;
  surface: StationSurface;
  filtered: boolean;
  isError: boolean;
}) {
  if (isError) {
    return (
      <View style={styles.empty}>
        <Heading level="headingSmall" style={styles.emptyTitle}>
          Can’t reach your station
        </Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
          The marketplace is served by your station from the community’s shared
          record, so it needs a connection to read. Pull down to retry.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Heading level="headingSmall" style={styles.emptyTitle}>
        {filtered ? 'Nothing matches those filters' : `No ${surfaceNoun(surface)} on offer yet`}
      </Heading>
      <Text variant="body" color={theme.colors.textSecondary} style={styles.emptyText}>
        {filtered
          ? 'Try widening the search or clearing a chip.'
          : 'When a member lists something here, it shows up for the whole community.'}
      </Text>
    </View>
  );
}

/** Skeleton cards while the first page loads (a calmer wait than a spinner). */
function BrowseSkeleton({theme}: {theme: Theme}) {
  return (
    <View style={{paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs, gap: theme.spacing.sm}}>
      {[0, 1, 2, 3].map(i => (
        <Card key={i} style={{gap: theme.spacing.sm}}>
          <View style={[styles.skelBar, styles.skelWide, {backgroundColor: theme.colors.surfaceSunken}]} />
          <View style={[styles.skelBar, styles.skelNarrow, {backgroundColor: theme.colors.surfaceSunken}]} />
          <View style={[styles.skelFoot, {borderTopColor: theme.colors.border}]}>
            <View style={[styles.skelDot, {backgroundColor: theme.colors.surfaceSunken}]} />
            <View style={[styles.skelBar, styles.skelChip, {backgroundColor: theme.colors.surfaceSunken}]} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/**
 * The listed price as a spoken label (screen readers, the card's a11y name).
 * Words, not glyphs — "Commons" rather than the mark — matching how {@link Amount}
 * labels itself.
 */
export function priceLabel(card: {amount_centi: number; surface: StationSurface}): string {
  if (card.amount_centi === 0) {
    return card.surface === 'commons' ? 'Free' : '0.00 Commons';
  }
  if (card.amount_centi < 0) {
    // A negative Commons price is a subsidy: the provider pays the taker.
    return `Subsidy of ${formatCommons(card.amount_centi)} Commons`;
  }
  return `${formatCommons(card.amount_centi)} Commons`;
}

/** The plural noun for a surface, for prompts and empty states. */
function surfaceNoun(surface: StationSurface): string {
  switch (surface) {
    case 'goods':
      return 'goods';
    case 'services':
      return 'services';
    case 'commons':
      return 'commons offers';
  }
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  segment: {flexDirection: 'row', borderWidth: 1, overflow: 'hidden'},
  segmentItem: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9},
  chipsScroll: {flexGrow: 0, flexShrink: 0},
  chips: {gap: 8, paddingTop: 10, paddingBottom: 2, alignItems: 'center'},
  chip: {height: 34, paddingHorizontal: 14, borderRadius: 9999, borderWidth: 1, justifyContent: 'center'},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  cardHead: {flex: 1, minWidth: 0, gap: 3},
  cardTitle: {fontWeight: '700'},
  cardPrice: {alignItems: 'flex-end', gap: 2},
  priceText: {fontWeight: '600'},
  cardFoot: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, paddingTop: 10},
  provider: {flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0},
  providerName: {flexShrink: 1, minWidth: 0},
  mineLabel: {fontWeight: '700'},
  fulfillment: {flexShrink: 0},
  footer: {textAlign: 'center', paddingVertical: 16},
  empty: {alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32},
  emptyTitle: {marginBottom: 6, textAlign: 'center'},
  emptyText: {textAlign: 'center'},
  skelBar: {height: 12, borderRadius: 6},
  skelWide: {width: '70%'},
  skelNarrow: {width: '40%'},
  skelChip: {width: 64, height: 16},
  skelFoot: {flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 10},
  skelDot: {width: 24, height: 24, borderRadius: 7},
});
