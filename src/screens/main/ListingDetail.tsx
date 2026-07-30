/**
 * The listing detail screen (T1.7.1) — a listing in full, reached by tapping a
 * browse card. Where the card showed only enough to choose, this shows the whole
 * offer: the description, the price and how it is set, the provider's stated
 * requirements, and the provider themselves — band, composite, and how many
 * members have vouched for them, the vouching context a buyer weighs before
 * committing.
 *
 * Two things it must get right, both about *honesty*:
 *
 * 1. **It reads state from the log, not the search index** (T1.7.0), so a card
 *    the member tapped may come back `closed` or `expired`. The screen says so
 *    plainly and withholds the Inquire action — presenting an off-offer listing
 *    as buyable would be the one place browse's active-only view could mislead.
 * 2. **Requirements are provider intent, not yet enforcement.** M1.6 records
 *    `min_reputation` / `community_member_only` on the log; the check against a
 *    specific buyer lands in T1.7.4. So they are shown as what the provider is
 *    looking for, and the Inquire CTA is a forward reference to that flow — the
 *    inquiry record type does not exist to sign against yet.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Badge,
  Banner,
  Button,
  Card,
  CommonMark,
  Heading,
  Identicon,
  ScreenHeader,
  Text,
} from '../../components';
import {dayLabel, shortAddress} from '../../ledger';
import {bandVariant, categoryLabel, useListingDetail} from '../../marketplace';
import {StationClientError, type StationListingDetail} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function ListingDetail({navigation, route}: MainStackScreenProps<'ListingDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {listingId} = route.params;
  const {data, isLoading, isError, error} = useListingDetail(listingId);

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <ScreenHeader title="Listing" onBack={() => navigation.goBack()} />

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading this listing from the station…
          </Text>
        </Card>
      )}

      {isError && <DetailError theme={theme} error={error} />}

      {data !== undefined && <DetailBody theme={theme} listing={data} />}
    </ScrollView>
  );
}

/** The full listing. Non-active listings keep every detail but lose the CTA. */
function DetailBody({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  const active = listing.state === 'active';
  const [inquireNoticeShown, setInquireNoticeShown] = useState(false);

  return (
    <>
      {!active && <StateBanner theme={theme} listing={listing} />}

      {/* Header: title, category/surface, price */}
      <View style={{gap: theme.spacing.sm}}>
        <Heading level="headingLarge">{listing.title}</Heading>
        <View style={styles.metaRow}>
          <Badge variant="neutral" size="sm">
            {capitalize(listing.surface)}
          </Badge>
          <Text variant="caption" color={theme.colors.textSecondary}>
            {categoryLabel(listing.category)}
          </Text>
        </View>
        <PriceLine theme={theme} listing={listing} />
      </View>

      {listing.description.trim().length > 0 && (
        <View style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.textSecondary}>
            Details
          </Text>
          <Card>
            <Text variant="body" color={theme.colors.text}>
              {listing.description}
            </Text>
          </Card>
        </View>
      )}

      <AvailabilityCard theme={theme} listing={listing} />
      <ProviderCard theme={theme} listing={listing} />
      <RequirementsCard theme={theme} listing={listing} />

      {/* Inquire — the CTA that opens a buyer↔seller thread (T1.7.4). The inquiry
          record does not exist to sign against yet, so for now the button
          explains where the flow lands rather than starting it. */}
      {active ? (
        <View style={{gap: theme.spacing.sm}}>
          <Button fullWidth onPress={() => setInquireNoticeShown(true)}>
            Inquire
          </Button>
          {inquireNoticeShown && (
            <Banner variant="info" title="Inquiries are coming next">
              Reaching out to a provider — messaging them and agreeing a price —
              arrives in the next update. This listing will be here when it does.
            </Banner>
          )}
        </View>
      ) : (
        <Text variant="caption" color={theme.colors.textMuted} style={styles.footer}>
          This listing is no longer on offer, so it can’t be inquired about.
        </Text>
      )}
    </>
  );
}

/** Why an off-offer listing is off offer, at the top where it can't be missed. */
function StateBanner({theme: _theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  if (listing.state === 'expired') {
    return (
      <Banner variant="warning" title="This listing has expired">
        The provider’s offer window has passed. It stays visible for reference but
        is no longer on offer.
      </Banner>
    );
  }
  // closed (or the unreachable draft)
  const reason = closeReasonText(listing);
  return (
    <Banner variant="warning" title="This listing is closed">
      {reason}
    </Banner>
  );
}

/** The price line under the header, worded for its kind. */
function PriceLine({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  if (listing.amount_centi === 0 && listing.surface === 'commons') {
    return (
      <View style={styles.priceLine}>
        <Text variant="headingSmall" color={theme.colors.credit}>
          Free
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          A community offering
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.priceLine}>
      {listing.amount_centi < 0 && (
        <Text variant="caption" color={theme.colors.textMuted}>
          Subsidy
        </Text>
      )}
      <Amount centi={listing.amount_centi} signed={listing.amount_centi < 0} colored={false} size="lg" />
      <Text variant="caption" color={theme.colors.textMuted}>
        {listing.pricing_model === 'negotiable' || listing.negotiable
          ? 'Negotiable'
          : 'Fixed price'}
      </Text>
    </View>
  );
}

/** Availability, drawn for the surface it belongs to. */
function AvailabilityCard({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  const {availability: a} = listing;
  let line: string;
  if (listing.surface === 'goods') {
    line =
      a.capacity === null
        ? statusWord(a.status)
        : a.capacity === 0
          ? 'Out of stock'
          : `${a.capacity} in stock`;
  } else if (listing.surface === 'services') {
    // Always a future time, so show the calendar day rather than a past-relative one.
    line = a.next_slot === null ? statusWord(a.status) : `Next slot ${dayLabel(a.next_slot)}`;
  } else {
    line = statusWord(a.status);
  }
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Text variant="label" color={theme.colors.textSecondary}>
        Availability
      </Text>
      <Card>
        <Text variant="body" color={theme.colors.text}>
          {line}
        </Text>
      </Card>
    </View>
  );
}

/** The provider snippet: identicon, address, band, composite, vouching context. */
function ProviderCard({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Text variant="label" color={theme.colors.textSecondary}>
        Offered by
      </Text>
      <Card style={{gap: theme.spacing.sm}}>
        <View style={styles.providerRow}>
          <Identicon seed={listing.provider} size={40} radius={11} />
          <View style={styles.providerText}>
            <Text variant="mono" color={theme.colors.text} numberOfLines={1}>
              {shortAddress(listing.provider)}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              in {listing.community}
            </Text>
          </View>
          <Badge variant={bandVariant(listing.provider_band)}>{listing.provider_band}</Badge>
        </View>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {vouchingContext(listing)}
        </Text>
      </Card>
    </View>
  );
}

/** What the provider is looking for. Stated intent, not a gate you have passed. */
function RequirementsCard({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  const hasReputation = listing.min_reputation > 0;
  if (!hasReputation && !listing.community_member_only) {
    return null;
  }
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Text variant="label" color={theme.colors.textSecondary}>
        The provider is looking for
      </Text>
      <Card style={{gap: theme.spacing.xs}}>
        {hasReputation && (
          <Text variant="body" color={theme.colors.text}>
            • A standing of at least {listing.min_reputation.toFixed(2)}
          </Text>
        )}
        {listing.community_member_only && (
          <Text variant="body" color={theme.colors.text}>
            • A member of {listing.community}
          </Text>
        )}
        <Text variant="caption" color={theme.colors.textMuted}>
          Checked when you inquire.
        </Text>
      </Card>
    </View>
  );
}

/** Loading failure: a missing listing reads differently from an unreachable station. */
function DetailError({theme, error}: {theme: Theme; error: Error | null}) {
  const notFound = error instanceof StationClientError && error.kind === 'method-error';
  return (
    <Card style={{gap: theme.spacing.xs}}>
      <View style={styles.errorHead}>
        <CommonMark size={18} color={theme.colors.textMuted} />
        <Text variant="label" color={theme.colors.text}>
          {notFound ? 'This listing isn’t on your station' : 'Can’t reach your station'}
        </Text>
      </View>
      <Text variant="body" color={theme.colors.textSecondary}>
        {notFound
          ? 'It may have been removed, or it lives on a community your station hasn’t seen. Go back and browse what’s on offer.'
          : 'The listing is served by your station from the shared record, so it needs a connection to read. Go back and try again.'}
      </Text>
    </Card>
  );
}

/** "3 members have vouched for them" / "No one has vouched for them yet". */
function vouchingContext(listing: StationListingDetail): string {
  const n = listing.provider_vouches_received;
  if (n === 0) {
    return 'No one has vouched for them yet.';
  }
  const noun = n === 1 ? 'member has' : 'members have';
  return `${n} ${noun} vouched for them.`;
}

/** The reason line for a closed listing. */
function closeReasonText(listing: StationListingDetail): string {
  switch (listing.close_reason) {
    case 'sold_out':
      return 'Everything on offer has been taken.';
    case 'provider_closed':
      return 'The provider took it down.';
    case 'expiration_reached':
      return 'The provider’s offer window passed.';
    default:
      return 'It’s no longer on offer.';
  }
}

function statusWord(status: StationListingDetail['availability']['status']): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'limited_stock':
      return 'Limited availability';
    case 'unavailable':
      return 'Currently unavailable';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  priceLine: {flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'},
  providerRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  providerText: {flex: 1, minWidth: 0, gap: 2},
  errorHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  footer: {textAlign: 'center'},
});
