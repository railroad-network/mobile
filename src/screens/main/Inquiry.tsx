/**
 * The inquiry thread (T1.7.4) — the signed conversation between a buyer and a
 * provider, where a price is negotiated and terms are agreed.
 *
 * It shows three things at once: the **offers on the table** as a stepped bar
 * (opening → counter → counter → …), so a member can see where the negotiation
 * stands at a glance; the **messages** as a chat, aligned by side; and, while the
 * inquiry is open, the ways to move it forward — send a message or a counter,
 * accept the offer on the table, or decline.
 *
 * Accepting closes the inquiry as `Agreed` at the current offer (T1.7.5's
 * negotiation, folded in): on a negotiable listing that is the latest counter, on
 * a non-negotiable one only the listed price. The station enforces the same rule,
 * so the button and the server cannot disagree. What accepting *leads to* — a
 * transaction proposed from the agreement — is T1.7.6; here, agreement is where
 * this screen's job ends.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Amount,
  BackLink,
  Banner,
  Button,
  Card,
  CommonMark,
  Field,
  Heading,
  Text,
} from '../../components';
import {formatCommons, relativeTime} from '../../ledger';
import {
  useCloseInquiry,
  useInquiryThread,
  useSendInquiryMessage,
  type InquiryCloseOutcome,
} from '../../marketplace';
import {StationClientError, type StationInquiryThread} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import type {MainStackScreenProps} from '../../navigation/types';

export function Inquiry({navigation, route}: MainStackScreenProps<'Inquiry'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {inquiryId} = route.params;
  const {data, isLoading, isError, error} = useInquiryThread(inquiryId);

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <View style={styles.header}>
        <BackLink onPress={() => navigation.goBack()} />
        {data !== undefined && <ThreadHeader theme={theme} thread={data} />}
      </View>

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading this conversation from the station…
          </Text>
        </Card>
      )}

      {isError && <ThreadError theme={theme} error={error} />}

      {data !== undefined && <ThreadBody theme={theme} thread={data} />}
    </ScrollView>
  );
}

/** The listing title and a one-line context, under the back link. */
function ThreadHeader({theme, thread}: {theme: Theme; thread: StationInquiryThread}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Heading level="headingLarge">{thread.listing_title}</Heading>
      <Text variant="caption" color={theme.colors.textSecondary}>
        Listed at {formatCommons(thread.listed_amount_centi)}
        {thread.negotiable ? ' · open to offers' : ' · fixed price'}
      </Text>
    </View>
  );
}

function ThreadBody({theme, thread}: {theme: Theme; thread: StationInquiryThread}) {
  const {wallet} = useWalletSession();
  const mineRole: Party | null =
    wallet === null
      ? null
      : wallet.address === thread.buyer
        ? 'buyer'
        : wallet.address === thread.provider
          ? 'provider'
          : null;
  const entries = threadEntries(thread);
  const offers = offerSteps(thread);
  const open = thread.state === 'open';

  return (
    <>
      {thread.state !== 'open' && <OutcomeBanner thread={thread} />}

      {offers.length > 0 && <OfferBar theme={theme} steps={offers} />}

      <View style={{gap: theme.spacing.sm}}>
        {entries.map(entry => (
          <MessageBubble
            key={entry.key}
            theme={theme}
            entry={entry}
            mine={mineRole !== null && entry.who === mineRole}
          />
        ))}
      </View>

      {open && mineRole !== null && (
        <Composer theme={theme} thread={thread} mineRole={mineRole} />
      )}
    </>
  );
}

// --- offer bar --------------------------------------------------------------

interface OfferStep {
  who: Party;
  centi: number;
}

/** The offer history: the opening offer, then each message's counter, in order. */
function offerSteps(thread: StationInquiryThread): OfferStep[] {
  const steps: OfferStep[] = [];
  if (thread.initial_offer_centi !== undefined) {
    steps.push({who: 'buyer', centi: thread.initial_offer_centi});
  }
  for (const m of thread.messages) {
    if (m.counter_offer_centi !== undefined) {
      steps.push({who: m.sender === thread.buyer ? 'buyer' : 'provider', centi: m.counter_offer_centi});
    }
  }
  return steps;
}

/** The stepped bar: where the negotiation stands, last offer highlighted. */
function OfferBar({theme, steps}: {theme: Theme; steps: OfferStep[]}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Text variant="label" color={theme.colors.textSecondary}>
        Offers
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.offerRow}>
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <View key={i} style={styles.offerStep}>
                {i > 0 && (
                  <Text variant="caption" color={theme.colors.textMuted}>
                    →
                  </Text>
                )}
                <View
                  style={[
                    styles.offerChip,
                    {
                      backgroundColor: last ? theme.colors.accentTint : theme.colors.surfaceSunken,
                      borderColor: last ? theme.colors.accent : theme.colors.border,
                    },
                  ]}>
                  <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                    {step.who === 'buyer' ? 'Buyer' : 'Provider'}
                  </Text>
                  <Amount centi={step.centi} signed={step.centi < 0} colored={false} size="sm" />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// --- messages ---------------------------------------------------------------

type Party = 'buyer' | 'provider';

interface ThreadEntry {
  key: string;
  who: Party;
  body: string;
  offerCenti?: number;
  at: number;
}

/** The opening plus every message, in one list for the chat to render. */
function threadEntries(thread: StationInquiryThread): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    {
      key: 'opening',
      who: 'buyer',
      body: thread.initial_message,
      offerCenti: thread.initial_offer_centi,
      at: thread.opened_at,
    },
  ];
  thread.messages.forEach((m, i) => {
    entries.push({
      key: `m${i}`,
      who: m.sender === thread.buyer ? 'buyer' : 'provider',
      body: m.body,
      offerCenti: m.counter_offer_centi,
      at: m.sent_at,
    });
  });
  return entries;
}

/** One chat bubble, aligned right for the viewer's own messages. */
function MessageBubble({theme, entry, mine}: {theme: Theme; entry: ThreadEntry; mine: boolean}) {
  const hasBody = entry.body.trim().length > 0;
  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? theme.colors.accentTint : theme.colors.surfaceRaised,
            borderColor: mine ? theme.colors.accent : theme.colors.border,
          },
        ]}>
        {entry.offerCenti !== undefined && (
          <View style={styles.bubbleOffer}>
            <Text variant="caption" color={theme.colors.textMuted}>
              Offer
            </Text>
            <Amount centi={entry.offerCenti} signed={entry.offerCenti < 0} colored={false} size="sm" />
          </View>
        )}
        {hasBody ? (
          <Text variant="body" color={theme.colors.text}>
            {entry.body}
          </Text>
        ) : (
          entry.offerCenti === undefined && (
            <Text variant="body" color={theme.colors.textMuted}>
              Started the conversation.
            </Text>
          )
        )}
      </View>
      <Text variant="caption" color={theme.colors.textMuted}>
        {entry.who === 'buyer' ? 'Buyer' : 'Provider'} · {relativeTime(entry.at)}
      </Text>
    </View>
  );
}

// --- composer + actions -----------------------------------------------------

function Composer({
  theme,
  thread,
  mineRole,
}: {
  theme: Theme;
  thread: StationInquiryThread;
  mineRole: Party;
}) {
  const send = useSendInquiryMessage();
  const close = useCloseInquiry();
  const [body, setBody] = useState('');
  const [offerText, setOfferText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const offerParsed = parseOffer(offerText);
  const offerInvalid = offerParsed === 'invalid';
  const offerCenti = offerParsed === 'invalid' || offerParsed === null ? null : offerParsed;
  // The station refuses a message with neither words nor an offer.
  const canSend = !busy && !offerInvalid && (body.trim().length > 0 || offerCenti !== null);

  // Only the provider grants an inquiry, and only the buyer's standing offer:
  // accepting is offered to the provider exactly when the buyer's offer is the
  // one on the table. If the provider has countered, they wait for the buyer to
  // take it (re-offer) — matching the station, which refuses anything else.
  const offerBy = currentOfferBy(thread);
  const buyersOfferOnTable = offerBy === 'buyer';
  const canAccept = mineRole === 'provider' && buyersOfferOnTable;
  // The buyer's standing offer, which is what the provider grants.
  const acceptCenti = currentOfferCenti(thread);
  const waitingHint = composerHint(mineRole, buyersOfferOnTable);

  const run = async (
    label: string,
    action: () => Promise<{ok: boolean; message?: string}>,
  ) => {
    setBusy(true);
    setError(undefined);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? `Could not ${label}.`);
    }
  };

  const onSend = () =>
    run('send that', async () => {
      const result = await send({inquiryId: thread.inquiry_id, body: body.trim(), counterOfferCenti: offerCenti});
      if (result.ok) {
        setBody('');
        setOfferText('');
      }
      return result;
    });

  const onAccept = () =>
    run('accept', () =>
      close({
        inquiryId: thread.inquiry_id,
        outcome: {kind: 'agreed', finalPriceCenti: acceptCenti},
      }),
    );

  const onDecline = () => {
    const outcome: InquiryCloseOutcome =
      mineRole === 'buyer' ? {kind: 'declined_by_buyer'} : {kind: 'declined_by_seller'};
    return run('decline', () => close({inquiryId: thread.inquiry_id, outcome}));
  };

  return (
    <View style={{gap: theme.spacing.sm}}>
      <Field
        label="Message"
        placeholder="Write a reply…"
        value={body}
        onChangeText={setBody}
        multiline
        editable={!busy}
      />
      <Field
        label="Counter-offer (optional)"
        placeholder={`e.g. ${formatCommons(thread.listed_amount_centi)}`}
        value={offerText}
        onChangeText={setOfferText}
        keyboardType="numbers-and-punctuation"
        editable={!busy && thread.negotiable}
        hint={
          thread.negotiable
            ? 'In Commons — leave blank to just send a message'
            : 'This listing’s price is fixed, so offers aren’t invited'
        }
        error={offerInvalid ? 'Enter an amount in Commons, like 4 or 4.50' : undefined}
      />

      <Button fullWidth onPress={onSend} disabled={!canSend} loading={busy}>
        Send
      </Button>

      {/* Ending the conversation. Only the provider accepts, and only the
          buyer's standing offer; either party can step away — the provider
          declines, the buyer withdraws their own inquiry. */}
      {canAccept ? (
        <View style={styles.actionsRow}>
          <Button
            variant="secondary"
            onPress={onAccept}
            disabled={busy}
            style={styles.actionButton}>
            {`Accept ${formatCommons(acceptCenti)}`}
          </Button>
          <Button
            variant="danger"
            onPress={onDecline}
            disabled={busy}
            style={styles.actionButton}>
            Decline
          </Button>
        </View>
      ) : (
        <Button
          fullWidth
          variant={mineRole === 'provider' ? 'danger' : 'secondary'}
          onPress={onDecline}
          disabled={busy}>
          {mineRole === 'provider' ? 'Decline' : 'Withdraw'}
        </Button>
      )}

      {waitingHint !== undefined && (
        <Text variant="caption" color={theme.colors.textMuted}>
          {waitingHint}
        </Text>
      )}

      {error !== undefined && (
        <Text variant="caption" color={theme.colors.danger}>
          {error}
        </Text>
      )}
    </View>
  );
}

/** The offer currently on the table: the last counter, the opening offer, or the
 * listed price if no one has named a number. */
function currentOfferCenti(thread: StationInquiryThread): number {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const c = thread.messages[i].counter_offer_centi;
    if (c !== undefined) {
      return c;
    }
  }
  return thread.initial_offer_centi ?? thread.listed_amount_centi;
}

/** Who made the offer on the table: the last counter's sender, else the buyer —
 * who, by inquiring, is asking at their opening offer or the listed price. The
 * provider may grant only a buyer's offer, so this decides whose turn it is. */
function currentOfferBy(thread: StationInquiryThread): Party {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i].counter_offer_centi !== undefined) {
      return thread.messages[i].sender === thread.buyer ? 'buyer' : 'provider';
    }
  }
  return 'buyer';
}

/** The line under the composer naming whose move it is — shown only in the
 * waiting states, where the member has no accept to reach for. The provider,
 * when the buyer's offer stands, has the Accept button instead of a hint. */
function composerHint(mineRole: Party, buyersOfferOnTable: boolean): string | undefined {
  if (mineRole === 'provider') {
    return buyersOfferOnTable ? undefined : 'Waiting for the buyer to take your counter or reply.';
  }
  return buyersOfferOnTable
    ? 'The provider will accept or decline your inquiry.'
    : 'The provider countered. Send a matching offer to agree, or withdraw.';
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

// --- outcome + error --------------------------------------------------------

/** Why a closed inquiry is closed, at the top of the thread. */
function OutcomeBanner({thread}: {thread: StationInquiryThread}) {
  if (thread.state === 'expired_pending') {
    return (
      <Banner variant="warning" title="This inquiry has gone quiet">
        There’s been no activity for a while, so the station will close it. Open a
        fresh inquiry from the listing if you still want to talk.
      </Banner>
    );
  }
  switch (thread.outcome) {
    case 'agreed':
      return (
        <Banner variant="success" title="You agreed on a price">
          Both sides agreed at{' '}
          {thread.final_price_centi !== undefined ? formatCommons(thread.final_price_centi) : 'the offer'}
          . Settling it as a payment arrives in the next update.
        </Banner>
      );
    case 'declined_by_buyer':
      return (
        <Banner variant="info" title="Inquiry declined">
          The buyer decided not to go ahead. Nothing was charged.
        </Banner>
      );
    case 'declined_by_seller':
      return (
        <Banner variant="info" title="Inquiry declined">
          The provider decided not to go ahead. Nothing was charged.
        </Banner>
      );
    default:
      return (
        <Banner variant="info" title="Inquiry closed">
          This conversation is closed.
        </Banner>
      );
  }
}

/** Loading failure: a thread you’re not part of reads the same as a missing one. */
function ThreadError({theme, error}: {theme: Theme; error: Error | null}) {
  const notFound = error instanceof StationClientError && error.kind === 'method-error';
  return (
    <Card style={{gap: theme.spacing.xs}}>
      <View style={styles.errorHead}>
        <CommonMark size={18} color={theme.colors.textMuted} />
        <Text variant="label" color={theme.colors.text}>
          {notFound ? 'This inquiry isn’t yours to see' : 'Can’t reach your station'}
        </Text>
      </View>
      <Text variant="body" color={theme.colors.textSecondary}>
        {notFound
          ? 'It may have been removed, or it belongs to two other members. Go back to your inquiries.'
          : 'The conversation is served by your station from the shared record, so it needs a connection. Go back and try again.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {gap: 4},
  offerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  offerStep: {flexDirection: 'row', alignItems: 'center', gap: 8},
  offerChip: {
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  bubbleWrap: {gap: 4, maxWidth: '100%'},
  bubbleMine: {alignItems: 'flex-end'},
  bubbleTheirs: {alignItems: 'flex-start'},
  bubble: {
    maxWidth: '86%',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleOffer: {flexDirection: 'row', alignItems: 'center', gap: 8},
  actionsRow: {flexDirection: 'row', gap: 10},
  actionButton: {flex: 1},
  errorHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
});
