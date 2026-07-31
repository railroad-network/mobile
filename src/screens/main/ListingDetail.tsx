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
 * 2. **Requirements are enforced at inquiry time (T1.7.4).** The station reports
 *    `viewer_eligible` for the authenticated member, so when they don't meet the
 *    provider's `min_reputation` / `community_member_only`, the Inquire CTA is
 *    disabled with the reason. That is a courtesy — the station enforces the same
 *    check on submit — not the enforcement point.
 *
 * When the viewer is the listing's own provider, the CTA is not Inquire (you do
 * not inquire on your own offer) but Close listing — the same signed
 * `ProviderClosed` as My Listings, so a member can take an offer down from the
 * screen where they were looking at it.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  Badge,
  BackLink,
  Banner,
  Button,
  Card,
  CommonMark,
  Field,
  Heading,
  Identicon,
  Text,
} from '../../components';
import {dayLabel, formatCommons, shortAddress} from '../../ledger';
import {
  bandVariant,
  categoryLabel,
  useCloseListing,
  useListingDetail,
  useOpenInquiry,
} from '../../marketplace';
import {StationClientError, type StationListingDetail} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
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
      {/* Back sits tight above the listing's own title (there is no "Listing"
          heading) — the same grouping ScreenHeader gives a back link and title,
          rather than a full section gap between them. */}
      <View style={styles.header}>
        <BackLink onPress={() => navigation.goBack()} />
        {data !== undefined && <ListingTitleHeader theme={theme} listing={data} />}
      </View>

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading this listing from the station…
          </Text>
        </Card>
      )}

      {isError && <DetailError theme={theme} error={error} />}

      {data !== undefined && (
        <DetailBody theme={theme} listing={data} navigation={navigation} />
      )}
    </ScrollView>
  );
}

/** Title, surface/category, and price — the listing's own header, under the back link. */
function ListingTitleHeader({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  return (
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
  );
}

/** The full listing. Non-active listings keep every detail but lose the CTA. */
function DetailBody({
  theme,
  listing,
  navigation,
}: {
  theme: Theme;
  listing: StationListingDetail;
  navigation: MainStackScreenProps<'ListingDetail'>['navigation'];
}) {
  const active = listing.state === 'active';
  const {wallet} = useWalletSession();
  // A listing's signer *is* its provider, and a wallet's address is that same
  // bech32m form — so this is the viewer's own offer when they match.
  const isOwn = wallet !== null && wallet.address === listing.provider;

  return (
    <>
      {!active && <StateBanner theme={theme} listing={listing} />}

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

      {active ? (
        isOwn ? (
          <OwnerCloseAction theme={theme} listing={listing} />
        ) : (
          <InquireAction theme={theme} listing={listing} navigation={navigation} />
        )
      ) : (
        // The buyer-worded "can't be inquired about" line makes no sense for the
        // provider's own listing — the state banner already explains it there.
        !isOwn && (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.footer}>
            This listing is no longer on offer, so it can’t be inquired about.
          </Text>
        )
      )}
    </>
  );
}

/**
 * Inquire — opens the buyer↔provider thread (T1.7.4). The member writes an
 * opening message and, on a negotiable listing, an opening offer; sending signs
 * an `InquiryOpened` and drops them into the conversation ({@link Inquiry}).
 *
 * When the station says the member doesn't meet the listing's requirements
 * (`viewer_eligible`), the CTA is disabled with the reason. That is a courtesy —
 * the station enforces the same check on submit — so a client that missed the
 * hint still can't open an inquiry it shouldn't.
 */
function InquireAction({
  theme,
  listing,
  navigation,
}: {
  theme: Theme;
  listing: StationListingDetail;
  navigation: MainStackScreenProps<'ListingDetail'>['navigation'];
}) {
  const openInquiry = useOpenInquiry();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [offerText, setOfferText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const ineligible = listing.viewer_eligible !== undefined && !listing.viewer_eligible.eligible;
  const offerParsed = parseOffer(offerText);
  const offerInvalid = offerParsed === 'invalid';
  const offerCenti = offerParsed === 'invalid' || offerParsed === null ? null : offerParsed;

  const onSend = async () => {
    setSending(true);
    setError(undefined);
    const result = await openInquiry({
      listingId: listing.listing_id,
      message: message.trim(),
      offerCenti,
    });
    setSending(false);
    if (result.ok) {
      // Replace, not push: backing out of the thread returns to the listing, not
      // to a spent compose form.
      navigation.replace('Inquiry', {inquiryId: result.inquiryId});
    } else {
      setError(result.message);
    }
  };

  if (ineligible) {
    return (
      <View style={{gap: theme.spacing.sm}}>
        <Button fullWidth disabled onPress={() => {}}>
          Inquire
        </Button>
        <Banner variant="info" title="You don’t meet what the provider asks">
          {listing.viewer_eligible?.unmet ??
            'This provider has set requirements you don’t currently meet.'}
        </Banner>
      </View>
    );
  }

  if (!composing) {
    return (
      <Button fullWidth onPress={() => setComposing(true)}>
        Inquire
      </Button>
    );
  }

  return (
    <View style={{gap: theme.spacing.sm}}>
      <Field
        label="Your message"
        placeholder="Introduce yourself, ask a question…"
        value={message}
        onChangeText={setMessage}
        multiline
        editable={!sending}
      />
      <Field
        label="Your offer (optional)"
        placeholder={`e.g. ${formatCommons(listing.amount_centi)}`}
        value={offerText}
        onChangeText={setOfferText}
        keyboardType="numbers-and-punctuation"
        editable={!sending && (listing.pricing_model === 'negotiable' || listing.negotiable)}
        hint={
          listing.pricing_model === 'negotiable' || listing.negotiable
            ? 'In Commons — leave blank to accept the listed price'
            : 'This listing’s price is fixed, so offers aren’t invited'
        }
        error={offerInvalid ? 'Enter an amount in Commons, like 4 or 4.50' : undefined}
      />
      <Button fullWidth onPress={onSend} disabled={sending || offerInvalid} loading={sending}>
        Send inquiry
      </Button>
      <Button
        fullWidth
        variant="secondary"
        onPress={() => setComposing(false)}
        disabled={sending}>
        Cancel
      </Button>
      {error !== undefined && (
        <Text variant="caption" color={theme.colors.danger}>
          {error}
        </Text>
      )}
    </View>
  );
}

/** Parses an optional Commons amount to centi. `null` = blank, `'invalid'` = not
 * a number. Negatives are allowed (a Commons subsidy). */
function parseOffer(input: string): number | null | 'invalid' {
  const t = input.trim();
  if (t === '') {
    return null;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return 'invalid';
  }
  return Math.round(n * 100);
}

/**
 * Close listing — the CTA when the viewer is the provider. Signs a
 * `ProviderClosed` behind an inline confirm, exactly as My Listings does; on
 * success the detail query invalidates and refetches as closed, so the CTA falls
 * away for the state banner on its own.
 */
function OwnerCloseAction({theme, listing}: {theme: Theme; listing: StationListingDetail}) {
  const closeListing = useCloseListing();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onClose = async () => {
    setClosing(true);
    setError(undefined);
    const result = await closeListing(listing.listing_id);
    setClosing(false);
    if (result.ok) {
      setConfirming(false);
    } else {
      setError(result.message);
    }
  };

  return (
    <View style={{gap: theme.spacing.sm}}>
      {confirming ? (
        // Full-width and stacked — the destructive action keeps the prominent
        // spot the trigger held, with the way out directly under it. Its label
        // differs from the trigger ("Confirm close" vs "Close listing") so the
        // second, committing tap reads as a distinct step, not a repeat.
        <>
          <Button fullWidth variant="danger" onPress={onClose} loading={closing}>
            Confirm close
          </Button>
          <Button fullWidth variant="secondary" onPress={() => setConfirming(false)} disabled={closing}>
            Keep it
          </Button>
        </>
      ) : (
        <Button fullWidth variant="danger" onPress={() => setConfirming(true)}>
          Close listing
        </Button>
      )}
      {error !== undefined && (
        <Text variant="caption" color={theme.colors.danger}>
          {error}
        </Text>
      )}
    </View>
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
  // Back link tight above the title, matching ScreenHeader's own block spacing.
  header: {gap: 4},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  priceLine: {flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'},
  providerRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  providerText: {flex: 1, minWidth: 0, gap: 2},
  errorHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  footer: {textAlign: 'center'},
});
