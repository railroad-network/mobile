/**
 * Your standing (T1.5.9) — the member's own reputation, reached from Community.
 *
 * M1.5 built the scoring engine station-side but showed a member nothing, so
 * this screen is the first time anyone can see their own score. Two things make
 * it more than a number readout, and both come from ADR-0009's requirement that
 * the presentation be truthful:
 *
 * 1. **The scale is not fully reachable yet.** Three of the five dimensions have
 *    no data source in Phase 1, so the composite tops out at `max_composite_now`
 *    (2.75 today) against a nominal 5.00, and the Trusted/Senior bands cannot be
 *    earned. The bar is drawn against the real 5.00 scale — the number is never
 *    inflated to look better — with the reachable ceiling marked on it and said
 *    in words. Both figures come from the station, so they cannot go stale here
 *    when a later milestone lights a dimension up.
 * 2. **An unanchored member is capped at 1.0 per dimension** however much history
 *    they have (T1.5.8). Someone with a dozen settled trades reading 1.0 with no
 *    explanation is the single most confusing state in the app, so the anchoring
 *    card is unconditional: it either names who anchored them or says plainly
 *    what lifts the cap.
 *
 * The score is deliberately not tunable — one formula on every station — and the
 * copy says so rather than implying a setting exists somewhere.
 */
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Card, ScreenHeader, Text} from '../../components';
import {relativeTime, shortAddress, useReputation} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {
  StationReputation,
  StationReputationBandName,
  StationReputationDimension,
} from '../../network/StationClient';
import type {MainStackScreenProps} from '../../navigation/types';

/** Human labels for the station's stable dimension names. */
const DIMENSION_LABELS: Record<string, string> = {
  trade_reliability: 'Trade reliability',
  attestation_accuracy: 'Attestation accuracy',
  governance_participation: 'Governance participation',
  community_contribution: 'Community contribution',
  domain_competence: 'Domain competence',
};

/** What a member does to move each live dimension. */
const DIMENSION_HINTS: Record<string, string> = {
  trade_reliability: 'Settled transactions, with both sides following through',
  attestation_accuracy: 'Vouches and confirmations you have signed',
};

export function Standing({navigation}: MainStackScreenProps<'Standing'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data, isLoading, isError} = useReputation();

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <ScreenHeader
        title="Your standing"
        onBack={() => navigation.goBack()}
      />

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading your standing from the station…
          </Text>
        </Card>
      )}

      {isError && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Can’t reach your station
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your standing is computed by your station from the shared record, so
            it needs a connection to read. Pull down on Community to retry.
          </Text>
        </Card>
      )}

      {/* Unpaired (or locked): the query never runs, so it neither loads nor
          errors — without this the screen would simply be empty. */}
      {data === undefined && !isLoading && !isError && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            No standing yet
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reputation is worked out by a station from the community’s shared
            record. Pair with one to see where you stand.
          </Text>
        </Card>
      )}

      {data !== undefined && <StandingBody theme={theme} standing={data} />}
    </ScrollView>
  );
}

function StandingBody({theme, standing}: {theme: Theme; standing: StationReputation}) {
  const capped = !standing.anchored;
  return (
    <>
      <CompositeCard theme={theme} standing={standing} />
      <AnchorCard theme={theme} standing={standing} />

      <View style={styles.group}>
        <Text variant="label" color={theme.colors.textSecondary}>
          The five dimensions
        </Text>
        <Card style={{gap: theme.spacing.md}}>
          {standing.dimensions.map(dimension => (
            <DimensionRow
              key={dimension.name}
              theme={theme}
              dimension={dimension}
              scaleMax={standing.scale_max}
              capAt={capped ? standing.anchor_dimension_cap : undefined}
            />
          ))}
        </Card>
      </View>

      <Text variant="caption" color={theme.colors.textMuted} style={styles.footer}>
        Worked out by your station as of {relativeTime(standing.computed_at)}. The
        same formula runs on every station and no community can change it.
      </Text>
    </>
  );
}

/** The headline: band, composite against the true 5.00 scale, and the ceiling. */
function CompositeCard({theme, standing}: {theme: Theme; standing: StationReputation}) {
  const dormant = standing.dimensions.filter(d => !d.live);
  return (
    <Card style={{gap: theme.spacing.sm}}>
      <View style={styles.heroTop}>
        <Badge variant={bandVariant(standing.band)}>{standing.band}</Badge>
        <Text variant="body" color={theme.colors.textSecondary}>
          {score(standing.composite)} / {score(standing.scale_max)}
        </Text>
      </View>

      <Meter
        theme={theme}
        value={standing.composite}
        max={standing.scale_max}
        markAt={standing.max_composite_now}
      />

      {dormant.length > 0 && (
        <Text variant="caption" color={theme.colors.textSecondary}>
          The most anyone can reach today is {score(standing.max_composite_now)}.{' '}
          {joinLabels(dormant)} {dormant.length === 1 ? 'has' : 'have'} nothing
          feeding {dormant.length === 1 ? 'it' : 'them'} yet, so “Trusted” and
          “Senior” aren’t within anyone’s reach — including yours.
        </Text>
      )}
    </Card>
  );
}

/**
 * Anchoring, always shown. Unanchored is the state that reads as a bug — real
 * history, every dimension pinned at 1.0 — so it gets the fuller explanation,
 * including that the evidence is still accruing underneath the cap.
 */
function AnchorCard({theme, standing}: {theme: Theme; standing: StationReputation}) {
  if (standing.anchored) {
    const voucher = standing.anchoring_voucher_address;
    return (
      <Card style={{gap: theme.spacing.xs}}>
        <Text variant="label" color={theme.colors.text}>
          ✓ Anchored
        </Text>
        <Text variant="body" color={theme.colors.textSecondary}>
          {voucher === null
            ? 'Someone in your community vouched for you, so your full history counts toward your score.'
            : `${shortAddress(voucher)} vouched for you, so your full history counts toward your score.`}
        </Text>
      </Card>
    );
  }
  return (
    <Card style={{gap: theme.spacing.xs}}>
      <Text variant="label" color={theme.colors.text}>
        Not anchored yet
      </Text>
      <Text variant="body" color={theme.colors.textSecondary}>
        Until an established member vouches for you, every dimension is held at{' '}
        {score(standing.anchor_dimension_cap)} — however much you have traded.
        This is what stops someone spinning up identities to manufacture a
        reputation.
      </Text>
      <Text variant="body" color={theme.colors.textSecondary}>
        Nothing is lost in the meantime: your record keeps building underneath
        the limit, and a single vouch from a Member-band member reveals all of it
        at once.
      </Text>
    </Card>
  );
}

/** One dimension: label, value, bar, and why it reads what it reads. */
function DimensionRow({
  theme,
  dimension,
  scaleMax,
  capAt,
}: {
  theme: Theme;
  dimension: StationReputationDimension;
  scaleMax: number;
  /** The anchoring cap, when it is currently binding this member. */
  capAt?: number;
}) {
  const label = DIMENSION_LABELS[dimension.name] ?? dimension.name;
  // A dormant 0.0 means "nothing measures this yet", not "measured and poor" —
  // the whole reason the station sends a `live` flag.
  const note = !dimension.live
    ? 'Opens in a later release'
    : capAt !== undefined && dimension.value >= capAt
      ? 'At the newcomer limit'
      : DIMENSION_HINTS[dimension.name];

  return (
    <View style={styles.dimension}>
      <View style={styles.dimensionTop}>
        <Text
          variant="body"
          color={dimension.live ? theme.colors.text : theme.colors.textMuted}>
          {label}
        </Text>
        <Text
          variant="mono"
          color={dimension.live ? theme.colors.text : theme.colors.textMuted}>
          {dimension.live ? score(dimension.value) : '—'}
        </Text>
      </View>
      <Meter
        theme={theme}
        value={dimension.live ? dimension.value : 0}
        max={scaleMax}
        muted={!dimension.live}
      />
      {note !== undefined && (
        <Text variant="caption" color={theme.colors.textMuted}>
          {note}
        </Text>
      )}
    </View>
  );
}

/**
 * A horizontal bar. `markAt` draws a tick where a ceiling sits, so the composite
 * meter can show the reachable maximum without the fill ever being rescaled to
 * flatter the number.
 */
function Meter({
  theme,
  value,
  max,
  markAt,
  muted = false,
}: {
  theme: Theme;
  value: number;
  max: number;
  markAt?: number;
  muted?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const markPct = markAt !== undefined && max > 0 ? Math.max(0, Math.min(1, markAt / max)) : undefined;
  return (
    <View
      style={[styles.meterTrack, {backgroundColor: theme.colors.surfaceSunken}]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{min: 0, max: Math.round(max * 100), now: Math.round(value * 100)}}>
      <View
        style={[
          styles.meterFill,
          {
            width: `${pct * 100}%`,
            backgroundColor: muted ? theme.colors.border : theme.colors.primary,
          },
        ]}
      />
      {markPct !== undefined && (
        <View
          style={[
            styles.meterMark,
            {left: `${markPct * 100}%`, backgroundColor: theme.colors.textMuted},
          ]}
        />
      )}
    </View>
  );
}

/** Two decimals, matching how the protocol talks about a score. */
function score(value: number): string {
  return value.toFixed(2);
}

/** "Governance participation, community contribution and domain competence". */
function joinLabels(dimensions: StationReputationDimension[]): string {
  const names = dimensions.map(d => (DIMENSION_LABELS[d.name] ?? d.name).toLowerCase());
  const sentence =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Band colour. New is neutral rather than a warning: being new is a fact about
 * how long you have been here, not a problem with you.
 */
function bandVariant(band: StationReputationBandName) {
  switch (band) {
    case 'Senior':
    case 'Trusted':
      return 'success' as const;
    case 'Member':
      return 'accent' as const;
    case 'New':
    default:
      return 'neutral' as const;
  }
}

const styles = StyleSheet.create({
  group: {gap: 8},
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dimension: {gap: 6},
  dimensionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  meterTrack: {height: 8, borderRadius: 4, overflow: 'hidden', justifyContent: 'center'},
  meterFill: {height: 8, borderRadius: 4},
  meterMark: {position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.7},
  footer: {textAlign: 'center'},
});
