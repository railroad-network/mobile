/**
 * Governance (T1.9.8) — the community's constitutional layer on the phone,
 * reached from a row on Community. It reads three things from the station and
 * renders them; the two write actions (co-sign, vote) live on the proposal
 * detail screen this hub pushes into.
 *
 * The three sections mirror the station's read surface:
 *
 * 1. **The Charter.** A community that has not ratified its genesis Charter yet
 *    comes back as a placeholder (`published: false`) — governance has not really
 *    begun — so the card says so plainly rather than drawing an empty charter.
 *    When published it shows the founding principles, the rights floor, and the
 *    rules that actually decide a vote (quorum, approval, the deliberation window,
 *    and how many co-signers publish a proposal), because those are what a member
 *    needs to read a proposal's tally honestly.
 * 2. **Proposals.** Each row carries what tells a member whether it is theirs to
 *    act on: what it would do (the kind), where it is in its lifecycle (the
 *    phase), the live count, and a countdown to the window closing.
 * 3. **In force.** The statutes that passed and were enacted.
 *
 * Composing a new proposal is deliberately not here in Phase 1 — that stays on
 * the CLI. The phone reads, co-signs, and votes.
 */
import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Banner, Button, Card, Countdown, ScreenHeader, Text} from '../../components';
import {
  relativeTime,
  useCharter,
  useIdentity,
  usePendingCharter,
  useProposals,
  useReputation,
  useStatutes,
} from '../../ledger';
import {
  kindLabel,
  memberIsEligibleVoter,
  phaseBadge,
  proposalIsActionable,
  TallyBar,
} from './governanceDisplay';
import {useTheme, type Theme} from '../../theme';
import type {
  StationCharter,
  StationProposalSummary,
  StationStatuteSummary,
} from '../../network/StationClient';
import type {MainStackScreenProps} from '../../navigation/types';

export function Governance({navigation}: MainStackScreenProps<'Governance'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const charter = useCharter();
  const proposals = useProposals();
  const statutes = useStatutes();
  const identity = useIdentity();
  const reputation = useReputation();
  const pendingCharter = usePendingCharter();
  const bootstrap = identity.data?.bootstrap;

  // A founding ceremony is under way, it hasn't published, and *this* phone is a
  // declared founder who hasn't signed yet — the one case where the member has an
  // action to take on the charter itself (the distributed founding ceremony).
  const ownAddress = identity.data?.address;
  const needsToSignCharter =
    pendingCharter.data?.exists === true &&
    !pendingCharter.data.published &&
    ownAddress !== undefined &&
    pendingCharter.data.founders.includes(ownAddress) &&
    !pendingCharter.data.signed_founders.includes(ownAddress);

  // Whether *this* member may co-sign / vote at all, so the "needs you" hint
  // never fires for someone the electorate excludes (ADR-0015): New non-founders
  // during grace, or any non-established member once grace ends.
  const eligible = memberIsEligibleVoter({
    ownAddress: identity.data?.address,
    established: reputation.data !== undefined && reputation.data.band !== 'New',
    inGrace: bootstrap?.inGrace === true,
    founders: charter.data?.founders ?? [],
  });

  const isLoading = charter.isLoading || proposals.isLoading;
  const isError = charter.isError || proposals.isError;
  // Unpaired / locked: the queries never run, so they neither load nor error.
  const idle =
    charter.data === undefined &&
    !charter.isLoading &&
    !charter.isError &&
    proposals.data === undefined;

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <ScreenHeader title="Governance" onBack={() => navigation.goBack()} />

      {needsToSignCharter && (
        <Card style={{gap: theme.spacing.sm}}>
          <Text variant="label" color={theme.colors.text}>
            Sign the founding charter
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            You’re a founder of this community. It publishes its charter once{' '}
            {pendingCharter.data?.threshold} founders sign — add your signature to
            help found it.
          </Text>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => navigation.navigate('SignCharter')}>
            Review &amp; sign
          </Button>
        </Card>
      )}

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading the community’s governance from the station…
          </Text>
        </Card>
      )}

      {isError && !isLoading && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Can’t reach your station
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Governance is kept by your station from the community’s shared record,
            so it needs a connection to read. Pull down on Community to retry.
          </Text>
        </Card>
      )}

      {idle && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            No governance yet
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            A community’s Charter and proposals are kept by a station. Pair with
            one to take part.
          </Text>
        </Card>
      )}

      {charter.data !== undefined && (
        <CharterCard theme={theme} charter={charter.data} />
      )}

      {/* While the community is bootstrapping, its founders stand in as the
          electorate (ADR-0015) — say so where votes and co-signs actually happen,
          not just on Home. Only meaningful once a Charter is published. */}
      {bootstrap?.inGrace === true && charter.data?.published === true && (
        <Banner variant="info" title="Founders decide for now">
          This community is still bootstrapping. Until {bootstrap.threshold} members build up
          standing, its founders stand in as the voters and jurors for proposals and disputes. Once
          {' '}{bootstrap.threshold} members are established, every established member takes part.
        </Banner>
      )}

      {proposals.data !== undefined && (
        <View style={styles.group}>
          <Text variant="label" color={theme.colors.textSecondary}>
            Proposals
          </Text>
          {proposals.data.length === 0 ? (
            <Card>
              <Text variant="body" color={theme.colors.textSecondary}>
                No proposals yet. New proposals are authored from the station
                command line for now.
              </Text>
            </Card>
          ) : (
            <Card padded={false} style={styles.listCard}>
              {proposals.data.map((p, i) => (
                <ProposalRow
                  key={p.proposal_id}
                  theme={theme}
                  proposal={p}
                  eligible={eligible}
                  first={i === 0}
                  onPress={() =>
                    navigation.navigate('GovProposalDetail', {
                      proposalId: p.proposal_id,
                    })
                  }
                />
              ))}
            </Card>
          )}
        </View>
      )}

      {statutes.data !== undefined && statutes.data.length > 0 && (
        <View style={styles.group}>
          <Text variant="label" color={theme.colors.textSecondary}>
            In force
          </Text>
          <Card style={{gap: theme.spacing.md}}>
            {statutes.data.map(s => (
              <StatuteRow key={s.proposal_id} theme={theme} statute={s} />
            ))}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

/** The Charter card, or the bootstrapping empty state when none is published. */
function CharterCard({theme, charter}: {theme: Theme; charter: StationCharter}) {
  if (!charter.published) {
    return (
      <Card style={{gap: theme.spacing.xs}}>
        <Text variant="label" color={theme.colors.text}>
          No Charter yet
        </Text>
        <Text variant="body" color={theme.colors.textSecondary}>
          This community hasn’t ratified a Charter, so formal governance hasn’t
          begun. A Charter is founded from the station command line by its
          founders together.
        </Text>
      </Card>
    );
  }
  return (
    <View style={styles.group}>
      <Text variant="label" color={theme.colors.textSecondary}>
        Charter
      </Text>
      <Card style={{gap: theme.spacing.md}}>
        <View style={styles.charterTop}>
          <Text variant="label" color={theme.colors.text}>
            {charter.community_id}
          </Text>
          <Badge variant="info" size="sm">{`v${charter.version}`}</Badge>
        </View>

        {charter.founding_principles.length > 0 && (
          <CharterList
            theme={theme}
            title="Founding principles"
            items={charter.founding_principles}
          />
        )}
        {charter.rights_floor.length > 0 && (
          <CharterList
            theme={theme}
            title="Rights floor"
            items={charter.rights_floor}
          />
        )}

        <View style={{gap: theme.spacing.xs}}>
          <Text variant="caption" color={theme.colors.textSecondary}>
            How decisions are made
          </Text>
          <Text variant="body" color={theme.colors.text}>
            A statute needs {charter.statute_quorum_pct}% to take part and{' '}
            {charter.statute_approval_pct}% of the decisive votes in favour.
          </Text>
          <Text variant="body" color={theme.colors.text}>
            A charter amendment needs {charter.charter_quorum_pct}% and{' '}
            {charter.charter_approval_pct}%.
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            Proposals deliberate and vote for {charter.deliberation_window_days}{' '}
            {charter.deliberation_window_days === 1 ? 'day' : 'days'}, and need{' '}
            {charter.cosign_threshold} co-signers to open. Founded by{' '}
            {charter.founders.length}{' '}
            {charter.founders.length === 1 ? 'member' : 'members'}.
          </Text>
        </View>
      </Card>
    </View>
  );
}

/** A labelled bulleted list of Charter lines (principles / rights). */
function CharterList({
  theme,
  title,
  items,
}: {
  theme: Theme;
  title: string;
  items: string[];
}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Text variant="caption" color={theme.colors.textSecondary}>
        {title}
      </Text>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text variant="body" color={theme.colors.textMuted}>
            •
          </Text>
          <Text variant="body" color={theme.colors.text} style={styles.bulletText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** One proposal in the hub list: kind + phase badges, title, tally, countdown. */
function ProposalRow({
  theme,
  proposal,
  eligible,
  first,
  onPress,
}: {
  theme: Theme;
  proposal: StationProposalSummary;
  eligible: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const phase = phaseBadge(proposal);
  const actionable = proposalIsActionable(proposal, eligible);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={proposal.title}
      style={[
        styles.proposalRow,
        !first && {borderTopWidth: 1, borderTopColor: theme.colors.border},
        {backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent'},
      ]}>
      <View style={styles.rowText}>
        <View style={styles.rowBadges}>
          <Badge variant="neutral" size="sm">
            {kindLabel(proposal.kind)}
          </Badge>
          <Badge variant={phase.variant} size="sm">
            {phase.label}
          </Badge>
          {actionable && (
            <Badge variant="accent" size="sm" dot>
              Needs you
            </Badge>
          )}
        </View>
        <Text variant="label" color={theme.colors.text}>
          {proposal.title}
        </Text>
        <TallyBar theme={theme} tally={proposal.tally} />
        {proposal.phase !== 'concluded' && (
          <View style={styles.countdownRow}>
            <Text variant="caption" color={theme.colors.textMuted}>
              Closes in
            </Text>
            <Countdown
              until={proposal.voting_ends_at}
              color={theme.colors.textSecondary}
              expiredLabel="closing"
            />
          </View>
        )}
      </View>
      <Text variant="body" color={theme.colors.textMuted}>
        ›
      </Text>
    </Pressable>
  );
}

/** One enacted statute in the "in force" section. */
function StatuteRow({theme, statute}: {theme: Theme; statute: StationStatuteSummary}) {
  return (
    <View style={styles.statuteRow}>
      <Text variant="body" color={theme.colors.text}>
        {statute.title}
      </Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        {kindLabel(statute.kind)} · in force since {relativeTime(statute.implemented_at)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {gap: 8},
  listCard: {overflow: 'hidden'},
  charterTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bulletRow: {flexDirection: 'row', gap: 8},
  bulletText: {flex: 1, minWidth: 0},
  proposalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowText: {flex: 1, minWidth: 0, gap: 6},
  rowBadges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center'},
  countdownRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  statuteRow: {gap: 2},
});
