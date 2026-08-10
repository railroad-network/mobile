/**
 * Shared governance display helpers (T1.9.8), used by both the {@link Governance}
 * hub and the {@link GovProposalDetail} screen so the two describe a proposal in
 * exactly the same words and colours.
 *
 * The phase→action logic lives here too: whether a proposal is one the member can
 * act on right now, and what that action is, is a single source of truth so the
 * hub's "needs you" hint and the detail screen's action buttons can never
 * disagree about a proposal's state.
 */
import {StyleSheet, View} from 'react-native';

import {Text} from '../../components';
import type {BadgeVariant} from '../../components';
import type {
  StationProposalKind,
  StationProposalSummary,
  StationTally,
} from '../../network/StationClient';
import type {Theme} from '../../theme';

/** A short human label for what a proposal would do. */
export function kindLabel(kind: StationProposalKind): string {
  switch (kind) {
    case 'statute':
      return 'Statute';
    case 'administrative_rule':
      return 'Admin rule';
    case 'charter_amendment':
      return 'Charter amendment';
    case 'emergency':
      return 'Emergency';
    default:
      return kind;
  }
}

/** The badge label + colour for a proposal's lifecycle phase (and outcome). */
export function phaseBadge(proposal: StationProposalSummary): {
  label: string;
  variant: BadgeVariant;
} {
  switch (proposal.phase) {
    case 'deliberation':
      // Deliberation splits: still gathering co-signers vs. published-and-waiting.
      return proposal.published
        ? {label: 'Opening', variant: 'info'}
        : {label: 'Gathering co-signers', variant: 'neutral'};
    case 'voting':
      return {label: 'Voting open', variant: 'accent'};
    case 'concluded':
      if (proposal.tally.outcome === 'passed') {
        return {label: 'Passed', variant: 'success'};
      }
      if (proposal.tally.outcome === 'failed') {
        return {label: 'Failed', variant: 'danger'};
      }
      return {label: 'Concluded', variant: 'neutral'};
    default:
      return {label: proposal.phase, variant: 'neutral'};
  }
}

/**
 * Whether the member can act on this proposal right now — used for the hub's
 * "needs you" hint. Note this cannot tell whether *this* member has already
 * co-signed or voted (that needs the detail read), so it is a hint, not a
 * promise: the detail screen makes the final call and the station is the
 * authority that rejects a duplicate.
 */
export function proposalIsActionable(proposal: StationProposalSummary): boolean {
  return proposalAction(proposal) !== 'none';
}

/** What action, if any, the proposal's phase currently allows. */
export function proposalAction(
  proposal: StationProposalSummary,
): 'cosign' | 'vote' | 'none' {
  // Co-signing endorses a proposal toward publication; only meaningful while it
  // is deliberating and has not yet crossed the threshold.
  if (proposal.phase === 'deliberation' && !proposal.published) {
    return 'cosign';
  }
  // Voting is only open on a published proposal within its window.
  if (proposal.phase === 'voting' && proposal.published) {
    return 'vote';
  }
  return 'none';
}

/**
 * A compact three-segment bar of yes / no / abstain, with the counts beneath.
 * Renders nothing but the counts line when no ballots have been cast, so an
 * empty bar never reads as "all no".
 */
export function TallyBar({theme, tally}: {theme: Theme; tally: StationTally}) {
  const total = tally.yes + tally.no + tally.abstain;
  return (
    <View style={styles.wrap}>
      {total > 0 && (
        <View style={[styles.track, {backgroundColor: theme.colors.surfaceSunken}]}>
          <View
            style={{
              flex: tally.yes,
              backgroundColor: theme.colors.success,
            }}
          />
          <View
            style={{
              flex: tally.no,
              backgroundColor: theme.colors.danger,
            }}
          />
          <View
            style={{
              flex: tally.abstain,
              backgroundColor: theme.colors.border,
            }}
          />
        </View>
      )}
      <Text variant="caption" color={theme.colors.textSecondary}>
        {tally.yes} yes · {tally.no} no · {tally.abstain} abstain ·{' '}
        {tally.eligible_voters} eligible
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 4},
  track: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
});
