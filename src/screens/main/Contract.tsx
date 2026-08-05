/**
 * The contract status screen (T1.7.7) — one recurring service contract in full.
 *
 * A contract is a standing order: the buyer's one signature authorizes the station
 * to charge each period directly (no per-period confirmation). This screen shows
 * where it stands — its cadence and price, how many periods have been charged and
 * how many remain, when the next charge falls — and lets either party end it early,
 * which takes effect after the notice window and levies the penalty if it was
 * early. The charge sweep is the station's; this screen reads its progress (polled)
 * and offers the one write a party has: termination.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Badge,
  BackLink,
  Banner,
  Button,
  Card,
  CommonMark,
  Heading,
  Text,
} from '../../components';
import {dayLabel, formatCommons, relativeTime, shortAddress} from '../../ledger';
import {cadenceLabel, perPeriodLabel, useContractDetail, useTerminateContract} from '../../marketplace';
import {StationClientError, type StationContractDetail} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import type {MainStackScreenProps} from '../../navigation/types';

type Role = 'buyer' | 'provider';

export function Contract({navigation, route}: MainStackScreenProps<'Contract'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {contractId} = route.params;
  const {data, isLoading, isError, error} = useContractDetail(contractId);
  const {wallet} = useWalletSession();

  const mineRole: Role | null =
    data === undefined || wallet === null
      ? null
      : wallet.address === data.buyer
        ? 'buyer'
        : wallet.address === data.provider
          ? 'provider'
          : null;

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
        {data !== undefined && <ContractHeader theme={theme} contract={data} mineRole={mineRole} />}
      </View>

      {isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading this contract from the station…
          </Text>
        </Card>
      )}

      {isError && <ContractErrorCard theme={theme} error={error} />}

      {data !== undefined && (
        <ContractBody theme={theme} contract={data} mineRole={mineRole} />
      )}
    </ScrollView>
  );
}

function ContractHeader({
  theme,
  contract,
  mineRole,
}: {
  theme: Theme;
  contract: StationContractDetail;
  mineRole: Role | null;
}) {
  const counterparty = mineRole === 'buyer' ? contract.provider : contract.buyer;
  const line =
    mineRole === 'buyer'
      ? `You subscribe · ${shortAddress(counterparty)}`
      : mineRole === 'provider'
        ? `You provide · ${shortAddress(counterparty)}`
        : `${shortAddress(contract.buyer)} → ${shortAddress(contract.provider)}`;
  return (
    <View style={{gap: theme.spacing.xs}}>
      <Heading level="headingLarge">{contract.listing_title}</Heading>
      <Text variant="caption" color={theme.colors.textSecondary}>
        {line}
      </Text>
    </View>
  );
}

function ContractBody({
  theme,
  contract,
  mineRole,
}: {
  theme: Theme;
  contract: StationContractDetail;
  mineRole: Role | null;
}) {
  const metrics = Object.entries(contract.performance_metrics);
  const totalPeriods = contract.periods_charged + contract.periods_remaining;

  return (
    <>
      <StateBanner contract={contract} />

      <Card style={{gap: theme.spacing.sm}}>
        <View style={styles.termsHead}>
          <Text variant="label" color={theme.colors.text}>
            {cadenceLabel(contract.frequency, contract.period_secs)} service
          </Text>
          <Badge variant={stateVariant(contract.state)} size="sm" dot={contract.state === 'active'}>
            {stateBadgeLabel(contract.state)}
          </Badge>
        </View>
        <DetailRow theme={theme} label="Charge">
          {`${formatCommons(contract.commons_per_period_centi)} ${perPeriodLabel(contract.frequency)}`}
        </DetailRow>
        <DetailRow theme={theme} label="Periods charged">
          {`${contract.periods_charged} of ${totalPeriods}`}
        </DetailRow>
        {contract.state === 'active' && contract.next_charge_due !== undefined && (
          <DetailRow theme={theme} label="Next charge">
            {dayLabel(contract.next_charge_due)}
          </DetailRow>
        )}
        {contract.state === 'terminating' && contract.terminating_effective_at !== undefined && (
          <DetailRow theme={theme} label="Ends">
            {dayLabel(contract.terminating_effective_at)}
          </DetailRow>
        )}
        {contract.state === 'ended' && contract.ended_at !== undefined && (
          <DetailRow theme={theme} label="Ended">
            {relativeTime(contract.ended_at)}
          </DetailRow>
        )}
        <DetailRow theme={theme} label="Notice to end">
          {contract.notice_period_days > 0
            ? `${contract.notice_period_days} ${contract.notice_period_days === 1 ? 'day' : 'days'}`
            : 'None'}
        </DetailRow>
        {contract.early_termination_penalty_centi > 0 && (
          <DetailRow theme={theme} label="Early-exit fee">
            {formatCommons(contract.early_termination_penalty_centi)}
          </DetailRow>
        )}
      </Card>

      {metrics.length > 0 && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Performance notes
          </Text>
          {metrics.map(([key, value]) => (
            <DetailRow key={key} theme={theme} label={key}>
              {value}
            </DetailRow>
          ))}
        </Card>
      )}

      {/* Only an active contract can be ended: one already terminating is winding
          down (a second termination would just be refused), and an ended one is
          done. */}
      {contract.state === 'active' && mineRole !== null && (
        <TerminateAction theme={theme} contract={contract} mineRole={mineRole} />
      )}
    </>
  );
}

/** One label/value line in a card. */
function DetailRow({
  theme,
  label,
  children,
}: {
  theme: Theme;
  label: string;
  children: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text variant="caption" color={theme.colors.textSecondary} style={styles.detailLabel}>
        {label}
      </Text>
      <Text variant="body" color={theme.colors.text} style={styles.detailValue}>
        {children}
      </Text>
    </View>
  );
}

/** Why the contract stands where it does, at the top of the body. */
function StateBanner({contract}: {contract: StationContractDetail}) {
  if (contract.state === 'terminating') {
    return (
      <Banner variant="warning" title="Ending soon">
        This contract is winding down. It stops charging after its notice window,
        and no further period is billed past then.
      </Banner>
    );
  }
  if (contract.state === 'ended') {
    if (contract.ended_reason === 'completed') {
      return (
        <Banner variant="info" title="Contract complete">
          Every period has been charged. Nothing further is due.
        </Banner>
      );
    }
    const who = contract.terminated_by === 'buyer' ? 'The subscriber' : 'The provider';
    return (
      <Banner variant="info" title="Contract ended">
        {`${who} ended this contract${contract.ended_early ? ', early' : ''}. Nothing further is due.`}
      </Banner>
    );
  }
  return null;
}

/**
 * The party's early-end control (T1.7.7). Either side may end a contract; it takes
 * effect after the notice window, and the early-exit fee applies if periods remain.
 * A two-step confirm, since a mistap here starts a wind-down with a fee.
 */
function TerminateAction({
  theme,
  contract,
  mineRole,
}: {
  theme: Theme;
  contract: StationContractDetail;
  mineRole: Role;
}) {
  const terminate = useTerminateContract();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const hasFee = contract.early_termination_penalty_centi > 0;
  const noticeLine =
    contract.notice_period_days > 0
      ? `It keeps charging through ${contract.notice_period_days} ${
          contract.notice_period_days === 1 ? 'day' : 'days'
        } of notice, then stops.`
      : 'It stops charging right away.';
  const feeLine = hasFee
    ? ` A ${formatCommons(contract.early_termination_penalty_centi)} early-exit fee applies${
        mineRole === 'provider' ? ' to you' : ''
      }.`
    : '';

  const onConfirm = async () => {
    setBusy(true);
    setError(undefined);
    const result = await terminate({contractId: contract.contract_id, terminatedBy: mineRole});
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      // The detail query refetches (and polls), so the state banner and CTA
      // update themselves once the termination is on the log.
    } else {
      setError(result.message ?? 'Could not end the contract.');
    }
  };

  if (!confirming) {
    return (
      <View style={{gap: theme.spacing.sm}}>
        <Button fullWidth variant="secondary" onPress={() => setConfirming(true)}>
          End this contract
        </Button>
        {error !== undefined && (
          <Text variant="caption" color={theme.colors.danger}>
            {error}
          </Text>
        )}
      </View>
    );
  }

  return (
    <Card style={{gap: theme.spacing.sm}}>
      <Text variant="label" color={theme.colors.text}>
        End this contract?
      </Text>
      <Text variant="caption" color={theme.colors.textSecondary}>
        {`${noticeLine}${feeLine}`}
      </Text>
      <Button fullWidth variant="danger" onPress={onConfirm} loading={busy} disabled={busy}>
        Confirm end
      </Button>
      <Button fullWidth variant="secondary" onPress={() => setConfirming(false)} disabled={busy}>
        Keep it
      </Button>
      {error !== undefined && (
        <Text variant="caption" color={theme.colors.danger}>
          {error}
        </Text>
      )}
    </Card>
  );
}

/** Loading failure: a contract you’re not part of reads the same as a missing one. */
function ContractErrorCard({theme, error}: {theme: Theme; error: Error | null}) {
  const notFound = error instanceof StationClientError && error.kind === 'method-error';
  return (
    <Card style={{gap: theme.spacing.xs}}>
      <View style={styles.errorHead}>
        <CommonMark size={18} color={theme.colors.textMuted} />
        <Text variant="label" color={theme.colors.text}>
          {notFound ? 'This contract isn’t yours to see' : 'Can’t reach your station'}
        </Text>
      </View>
      <Text variant="body" color={theme.colors.textSecondary}>
        {notFound
          ? 'It may have been removed, or it belongs to two other members. Go back to your contracts.'
          : 'The contract is served by your station from the shared record, so it needs a connection. Go back and try again.'}
      </Text>
    </Card>
  );
}

function stateVariant(state: StationContractDetail['state']): 'success' | 'warning' | 'neutral' {
  switch (state) {
    case 'active':
      return 'success';
    case 'terminating':
      return 'warning';
    case 'ended':
    default:
      return 'neutral';
  }
}

function stateBadgeLabel(state: StationContractDetail['state']): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'terminating':
      return 'Ending';
    case 'ended':
    default:
      return 'Ended';
  }
}

const styles = StyleSheet.create({
  header: {gap: 4},
  termsHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  detailRow: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12},
  detailLabel: {flexShrink: 0},
  detailValue: {flex: 1, textAlign: 'right'},
  errorHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
});
