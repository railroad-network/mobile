/**
 * One governance proposal in full (T1.9.8), pushed from the {@link Governance}
 * hub. It shows the proposal's body and live tally, and — this is the point of
 * the screen — it is where the member acts, gated by the phase→action matrix
 * (shared with the hub via {@link proposalAction} so the two never disagree):
 *
 * - **Deliberation, not yet published →** co-sign, endorsing it toward the
 *   co-sign threshold that opens voting.
 * - **Voting, published →** cast one ballot (yes / no / abstain). A ballot is
 *   final in Phase 1 — there is no vote-change — so the choice is selected first
 *   and cast on a second, deliberate tap.
 * - **Concluded (or otherwise not open) →** read-only, showing the outcome.
 *
 * The read surface can't say whether *this* member has already co-signed or
 * voted, so the screen offers the action optimistically and lets the station be
 * the authority: a duplicate comes back as a typed rejection, surfaced plainly
 * ("You’ve already voted on this") rather than as a raw error.
 *
 * The body is authored as markdown on the station; Phase-1 mobile renders it as
 * readable plain text (line breaks preserved). A markdown renderer is a noted
 * follow-up, not a blocker for reading a proposal.
 */
import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Badge,
  Banner,
  Button,
  Card,
  Countdown,
  ScreenHeader,
  Text,
} from '../../components';
import {
  relativeTime,
  shortAddress,
  useCastVote,
  useCharter,
  useCosignProposal,
  useProposal,
} from '../../ledger';
import type {VoteChoice} from '../../wallet/governance';
import {kindLabel, phaseBadge, proposalAction, TallyBar} from './governanceDisplay';
import {useTheme, type Theme} from '../../theme';
import type {StationProposalDetail} from '../../network/StationClient';
import type {MainStackScreenProps} from '../../navigation/types';

/** Local step after a successful write, so the screen reflects it before refetch. */
type Acted = 'none' | 'cosigned' | 'voted';

export function GovProposalDetail({
  route,
  navigation,
}: MainStackScreenProps<'GovProposalDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {proposalId} = route.params;
  const {data, isLoading, isError, refetch} = useProposal(proposalId);
  const charter = useCharter();

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <ScreenHeader title="Proposal" onBack={() => navigation.goBack()} />

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading the proposal from the station…
          </Text>
        </Card>
      )}

      {isError && !isLoading && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Couldn’t load this proposal
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your station either can’t be reached or doesn’t know this proposal.
          </Text>
        </Card>
      )}

      {data !== undefined && (
        <ProposalBody
          theme={theme}
          proposal={data}
          cosignThreshold={charter.data?.cosign_threshold}
          onActed={() => refetch()}
        />
      )}
    </ScrollView>
  );
}

function ProposalBody({
  theme,
  proposal,
  cosignThreshold,
  onActed,
}: {
  theme: Theme;
  proposal: StationProposalDetail;
  cosignThreshold: number | undefined;
  onActed: () => void;
}) {
  const cosign = useCosignProposal();
  const castVote = useCastVote();

  const [acted, setActed] = useState<Acted>('none');
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase = phaseBadge(proposal);
  const action = proposalAction(proposal);

  async function doCosign() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await cosign(proposal.proposal_id);
    setBusy(false);
    if (result.ok) {
      setActed('cosigned');
      onActed();
      return;
    }
    setError(cosignErrorMessage(result.error, result.message));
  }

  async function doVote() {
    if (busy || choice === null) return;
    setBusy(true);
    setError(null);
    const result = await castVote(proposal.proposal_id, choice);
    setBusy(false);
    if (result.ok) {
      setActed('voted');
      onActed();
      return;
    }
    setError(voteErrorMessage(result.error, result.message));
  }

  return (
    <>
      <View style={{gap: theme.spacing.sm}}>
        <View style={styles.badges}>
          <Badge variant="neutral" size="sm">
            {kindLabel(proposal.kind)}
          </Badge>
          <Badge variant={phase.variant} size="sm">
            {phase.label}
          </Badge>
        </View>
        <Text variant="headingMedium" color={theme.colors.text}>
          {proposal.title}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          Proposed by {shortAddress(proposal.author)} ·{' '}
          {relativeTime(proposal.created_at)}
          {proposal.scope !== undefined ? ` · scope: ${proposal.scope}` : ''}
        </Text>
      </View>

      <Card>
        <Text variant="body" color={theme.colors.text}>
          {proposal.body.trim().length > 0 ? proposal.body.trim() : 'No description.'}
        </Text>
      </Card>

      {/* Tally + thresholds. */}
      <Card style={{gap: theme.spacing.sm}}>
        <Text variant="label" color={theme.colors.text}>
          {proposal.phase === 'concluded' ? 'Result' : 'Where the vote stands'}
        </Text>
        <TallyBar theme={theme} tally={proposal.tally} />
        <Text variant="caption" color={theme.colors.textSecondary}>
          {proposal.tally.quorum_met ? '✓ Quorum met' : '· Quorum not met yet'}
          {'   '}
          {proposal.tally.approval_met ? '✓ Approval met' : '· Approval not met yet'}
        </Text>
        {proposal.phase === 'concluded' && proposal.tally.outcome !== undefined && (
          <Text
            variant="body"
            color={
              proposal.tally.outcome === 'passed'
                ? theme.colors.success
                : theme.colors.danger
            }>
            {proposal.tally.outcome === 'passed'
              ? proposal.enacted
                ? 'Passed and now in force.'
                : `Passed. Takes effect ${relativeTime(proposal.implementation_at)}.`
              : 'Did not pass.'}
          </Text>
        )}
      </Card>

      {/* Timing + co-signers. */}
      <Card style={{gap: theme.spacing.sm}}>
        {proposal.phase !== 'concluded' && (
          <View style={styles.metaRow}>
            <Text variant="body" color={theme.colors.textSecondary}>
              {proposal.phase === 'voting' ? 'Voting closes in' : 'Window closes in'}
            </Text>
            <Countdown
              until={proposal.voting_ends_at}
              color={theme.colors.text}
              expiredLabel="closing"
            />
          </View>
        )}
        <View style={styles.metaRow}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Co-signers
          </Text>
          <Text variant="body" color={theme.colors.text}>
            {cosignThreshold !== undefined
              ? `${proposal.cosigner_count} of ${cosignThreshold}`
              : `${proposal.cosigner_count}`}
          </Text>
        </View>
      </Card>

      {error !== null && (
        <Banner variant="danger" title="That didn’t go through">
          {error}
        </Banner>
      )}

      {renderAction()}
    </>
  );

  function renderAction() {
    // A cast ballot is terminal for this member: the read surface can't tell us
    // they voted, so we hold the confirmation locally and never re-offer a vote.
    if (acted === 'voted') {
      return (
        <Banner variant="success" title="Vote cast">
          Your ballot is recorded. It can’t be changed.
        </Banner>
      );
    }
    // A co-sign shows its confirmation only until polling reveals voting has
    // opened — then we fall through to the ballot, so the member can vote
    // without leaving and re-opening the screen.
    if (acted === 'cosigned' && action !== 'vote') {
      return (
        <Banner variant="success" title="Co-signed">
          Your endorsement is recorded. Once{' '}
          {cosignThreshold !== undefined ? cosignThreshold : 'enough'} members
          co-sign, voting opens.
        </Banner>
      );
    }

    if (action === 'cosign') {
      return (
        <>
          <Banner variant="info" title="This proposal needs co-signers">
            Co-signing endorses it toward the threshold that opens voting. Co-sign
            only proposals you want the community to consider.
          </Banner>
          <Button variant="primary" size="lg" fullWidth loading={busy} onPress={doCosign}>
            Co-sign this proposal
          </Button>
        </>
      );
    }

    if (action === 'vote') {
      return (
        <View style={{gap: theme.spacing.sm}}>
          <Text variant="label" color={theme.colors.text}>
            Cast your vote
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            A vote is final — it can’t be changed once cast.
          </Text>
          <View style={styles.choices}>
            {(['yes', 'no', 'abstain'] as const).map(c => (
              <ChoiceChip
                key={c}
                theme={theme}
                label={choiceLabel(c)}
                selected={choice === c}
                onPress={() => setChoice(c)}
              />
            ))}
          </View>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={choice === null}
            onPress={doVote}>
            {choice === null ? 'Pick a choice' : `Cast “${choiceLabel(choice)}”`}
          </Button>
        </View>
      );
    }

    // No action available: deliberation-but-published-and-waiting, or concluded.
    if (proposal.phase === 'deliberation' && proposal.published) {
      return (
        <Banner variant="info" title="Ready for voting">
          This proposal has its co-signers and will open for voting shortly.
        </Banner>
      );
    }
    return null;
  }
}

/** A selectable vote-choice chip. */
function ChoiceChip({
  theme,
  label,
  selected,
  onPress,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.accentTint : 'transparent',
        },
      ]}>
      <Text
        variant="label"
        color={selected ? theme.colors.accentStrong : theme.colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Sentence-case label for a choice. */
function choiceLabel(choice: VoteChoice): string {
  switch (choice) {
    case 'yes':
      return 'Yes';
    case 'no':
      return 'No';
    case 'abstain':
      return 'Abstain';
  }
}

/** Friendly copy for a co-sign failure, special-casing the common rejections. */
function cosignErrorMessage(error: string, message: string): string {
  if (error === 'unreachable') {
    return 'Couldn’t reach your station. Connect to it and try again.';
  }
  if (/already/i.test(message)) {
    return 'You’ve already co-signed this proposal.';
  }
  if (/established|composite|2\.0/i.test(message)) {
    return 'Only established members can co-sign. Build your standing first.';
  }
  return `Couldn’t co-sign: ${message}`;
}

/** Friendly copy for a vote failure, special-casing the common rejections. */
function voteErrorMessage(error: string, message: string): string {
  if (error === 'unreachable') {
    return 'Couldn’t reach your station. Connect to it and try again.';
  }
  if (/already/i.test(message)) {
    return 'You’ve already voted on this proposal.';
  }
  if (/window|closed|outside/i.test(message)) {
    return 'Voting on this proposal has closed.';
  }
  if (/established|composite|2\.0/i.test(message)) {
    return 'Only established members can vote. Build your standing first.';
  }
  return `Couldn’t vote: ${message}`;
}

const styles = StyleSheet.create({
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center'},
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  choices: {flexDirection: 'row', gap: 8},
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
});
