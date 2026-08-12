/**
 * One dispute in full (T1.10.6), pushed from {@link TransactionDetail} when a
 * confirmed transaction has been contested. It shows the grievance, both parties'
 * responses, and the sortition-drawn jury with its live tally — and, this being
 * the point of the screen, it is where the member acts, gated by their role in
 * *this* dispute:
 *
 * - **The counterparty (the party who did not raise it) →** file one response
 *   rebutting the grievance. One response per party is final, so the station
 *   rejects a second; the screen treats a successful one as done.
 * - **A seated juror (drawn onto the panel, verdict still awaited) →** cast one
 *   verdict (uphold / reject). A verdict is final — there is no changing it — so
 *   the ruling is selected first and cast on a second, deliberate tap.
 * - **The raiser, or anyone else →** read-only, watching the panel and window.
 *
 * The read surface tells us who sits on the panel and who has responded, so the
 * screen can offer the right action without guessing; where it can't be sure
 * (a race against another device), it offers the action optimistically and lets
 * the station be the authority, surfacing a typed rejection plainly.
 *
 * Escalation to the electorate (ADR-0014 §5) is shown here read-only when a party
 * has opened one from the CLI; the on-device appeal / escalate / vote actions
 * arrive in Slice B.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Badge,
  Banner,
  Button,
  Card,
  Countdown,
  Field,
  ScreenHeader,
  Text,
  type BadgeVariant,
} from '../../components';
import {
  relativeTime,
  shortAddress,
  useCastVerdict,
  useDispute,
  useIdentity,
  useRespondToDispute,
} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {
  DisputeDetail as DisputeDetailData,
  StationDisputeResolution,
} from '../../network/StationClient';
import type {MainStackScreenProps} from '../../navigation/types';

/** The longest a response statement may be, matching the station's byte bound. */
const MAX_STATEMENT = 2048;

export function DisputeDetail({route, navigation}: MainStackScreenProps<'DisputeDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {txId} = route.params;
  const {data, isLoading, isError, refetch} = useDispute(txId);
  const identity = useIdentity();
  const ownAddress = identity.data?.address;

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <ScreenHeader title="Dispute" onBack={() => navigation.goBack()} />

      {isLoading && data === undefined && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading the dispute from the station…
          </Text>
        </Card>
      )}

      {isError && data === undefined && !isLoading && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            This dispute is no longer open
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            It has been resolved, or your station can’t be reached. A resolved
            transaction shows its outcome back on its transaction detail.
          </Text>
        </Card>
      )}

      {data !== undefined && (
        <DisputeBody
          theme={theme}
          dispute={data}
          ownAddress={ownAddress}
          onActed={() => refetch()}
        />
      )}
    </ScrollView>
  );
}

function DisputeBody({
  theme,
  dispute,
  ownAddress,
  onActed,
}: {
  theme: Theme;
  dispute: DisputeDetailData;
  ownAddress: string | undefined;
  onActed: () => void;
}) {
  const isParty = ownAddress === dispute.sender || ownAddress === dispute.receiver;
  const isRaiser = ownAddress !== undefined && ownAddress === dispute.raiser;
  const isCounterparty = isParty && !isRaiser;
  const hasResponded =
    ownAddress !== undefined && dispute.responses.some(r => r.responder === ownAddress);
  const seat = dispute.panel.find(p => p.juror === ownAddress);
  const terminal = isTerminal(dispute.resolution);

  const res = resolutionDisplay(dispute.resolution);

  return (
    <>
      <View style={{gap: theme.spacing.sm}}>
        <View style={styles.badges}>
          <Badge variant={res.variant} size="sm">
            {res.label}
          </Badge>
          {dispute.escalation !== undefined && (
            <Badge variant="warning" size="sm">
              Escalated
            </Badge>
          )}
        </View>
        <Text variant="headingMedium" color={theme.colors.text}>
          {shortAddress(dispute.sender)} → {shortAddress(dispute.receiver)}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          Raised by {isRaiser ? 'you' : shortAddress(dispute.raiser)} ·{' '}
          {relativeTime(dispute.opened_at)}
        </Text>
      </View>

      {/* The grievance. */}
      <Card style={{gap: theme.spacing.xs}}>
        <Text variant="label" color={theme.colors.text}>
          The grievance
        </Text>
        <Text variant="body" color={theme.colors.text}>
          {dispute.reason.trim().length > 0 ? dispute.reason.trim() : 'No reason given.'}
        </Text>
      </Card>

      {/* Responses filed so far. */}
      {dispute.responses.length > 0 && (
        <Card style={{gap: theme.spacing.sm}}>
          <Text variant="label" color={theme.colors.text}>
            Responses
          </Text>
          {dispute.responses.map(r => (
            <View key={`${r.responder}-${r.responded_at}`} style={styles.responseRow}>
              <Text variant="caption" color={theme.colors.textMuted}>
                {r.responder === ownAddress ? 'You' : shortAddress(r.responder)} ·{' '}
                {relativeTime(r.responded_at)}
              </Text>
              <Text variant="body" color={theme.colors.text}>
                {r.statement.trim().length > 0 ? r.statement.trim() : '—'}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* The jury and its running tally. */}
      <Card style={{gap: theme.spacing.sm}}>
        <View style={styles.metaRow}>
          <Text variant="label" color={theme.colors.text}>
            The jury
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {dispute.tally.uphold} uphold · {dispute.tally.reject} reject ·{' '}
            {dispute.tally.awaiting} awaiting (of {dispute.tally.panel_size})
          </Text>
        </View>
        {dispute.panel.length === 0 ? (
          <Text variant="body" color={theme.colors.textSecondary}>
            No jurors seated yet
            {dispute.eligible_pool_size < dispute.tally.panel_size
              ? ` — the eligible pool (${dispute.eligible_pool_size}) is smaller than a panel.`
              : '.'}
          </Text>
        ) : (
          dispute.panel.map(seatRow => (
            <View key={seatRow.juror} style={styles.metaRow}>
              <Text variant="mono" color={theme.colors.text}>
                {seatRow.juror === ownAddress ? 'You' : shortAddress(seatRow.juror)}
              </Text>
              <Badge variant={verdictVariant(seatRow.verdict)} size="sm">
                {verdictLabel(seatRow.verdict)}
              </Badge>
            </View>
          ))
        )}
      </Card>

      {/* Window countdown, until a terminal outcome is reached. */}
      {!terminal && (
        <Card style={styles.metaRow}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Window closes in
          </Text>
          <Countdown
            until={dispute.window_ends_at}
            color={theme.colors.text}
            expiredLabel="closing"
          />
        </Card>
      )}

      {dispute.escalation !== undefined && (
        <Banner variant="warning" title="Escalated to the community">
          {dispute.escalation.reason === 'appeal'
            ? 'A party has appealed the jury’s ruling. The community is voting on it.'
            : 'The jury couldn’t seat a panel, so the community is voting on it.'}{' '}
          {dispute.escalation.uphold} uphold · {dispute.escalation.reject} reject.
        </Banner>
      )}

      <DisputeAction
        theme={theme}
        dispute={dispute}
        isCounterparty={isCounterparty}
        hasResponded={hasResponded}
        canRule={seat !== undefined && seat.verdict === 'awaiting'}
        hasRuled={seat !== undefined && seat.verdict !== 'awaiting'}
        terminal={terminal}
        onActed={onActed}
      />
    </>
  );
}

/** The role-aware action region: respond, rule, or a read-only note. */
function DisputeAction({
  theme,
  dispute,
  isCounterparty,
  hasResponded,
  canRule,
  hasRuled,
  terminal,
  onActed,
}: {
  theme: Theme;
  dispute: DisputeDetailData;
  isCounterparty: boolean;
  hasResponded: boolean;
  canRule: boolean;
  hasRuled: boolean;
  terminal: boolean;
  onActed: () => void;
}) {
  const respond = useRespondToDispute();
  const castVerdict = useCastVerdict();

  const [statement, setStatement] = useState('');
  const [ruling, setRuling] = useState<'uphold' | 'reject' | null>(null);
  const [acted, setActed] = useState<'none' | 'responded' | 'ruled'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRespond() {
    if (busy || statement.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await respond(dispute.tx_id, statement.trim());
    setBusy(false);
    if (result.ok) {
      setActed('responded');
      onActed();
      return;
    }
    setError(actionErrorMessage('respond', result.error, result.message));
  }

  async function doRule() {
    if (busy || ruling === null) return;
    setBusy(true);
    setError(null);
    const result = await castVerdict(dispute.tx_id, ruling === 'uphold');
    setBusy(false);
    if (result.ok) {
      setActed('ruled');
      onActed();
      return;
    }
    setError(actionErrorMessage('rule', result.error, result.message));
  }

  const banner = error !== null && (
    <Banner variant="danger" title="That didn’t go through">
      {error}
    </Banner>
  );

  // Terminal: no more actions — the outcome is what the summary already shows.
  if (terminal) {
    return (
      <>
        {banner}
        <Banner variant="info" title="This dispute has reached an outcome">
          {terminalNote(dispute.resolution)}
        </Banner>
      </>
    );
  }

  // Juror path.
  if (acted === 'ruled' || hasRuled) {
    return (
      <>
        {banner}
        <Banner variant="success" title="Verdict cast">
          Your ruling is recorded. It can’t be changed.
        </Banner>
      </>
    );
  }
  if (canRule) {
    return (
      <>
        {banner}
        <View style={{gap: theme.spacing.sm}}>
          <Text variant="label" color={theme.colors.text}>
            You’ve been drawn onto the jury
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            Weigh the grievance against the response, then rule. A verdict is
            final — it can’t be changed once cast.
          </Text>
          <View style={styles.choices}>
            <ChoiceChip
              theme={theme}
              label="Uphold"
              hint="the dispute"
              selected={ruling === 'uphold'}
              onPress={() => setRuling('uphold')}
            />
            <ChoiceChip
              theme={theme}
              label="Reject"
              hint="the dispute"
              selected={ruling === 'reject'}
              onPress={() => setRuling('reject')}
            />
          </View>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={ruling === null}
            onPress={doRule}>
            {ruling === null
              ? 'Pick a verdict'
              : ruling === 'uphold'
                ? 'Cast “Uphold”'
                : 'Cast “Reject”'}
          </Button>
        </View>
      </>
    );
  }

  // Counterparty response path.
  if (acted === 'responded' || hasResponded) {
    return (
      <>
        {banner}
        <Banner variant="success" title="Response filed">
          Your side is on the record for the jury to weigh.
        </Banner>
      </>
    );
  }
  if (isCounterparty) {
    return (
      <>
        {banner}
        <View style={{gap: theme.spacing.sm}}>
          <Text variant="label" color={theme.colors.text}>
            Respond to this dispute
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            Give the jury your side. You can file one response.
          </Text>
          <Field
            label="Your response"
            placeholder="What happened, from your side…"
            value={statement}
            onChangeText={setStatement}
            multiline
            maxLength={MAX_STATEMENT}
          />
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={statement.trim().length === 0}
            onPress={doRespond}>
            File response
          </Button>
        </View>
      </>
    );
  }

  // Raiser or observer: read-only.
  return (
    <>
      {banner}
      <Banner variant="info" title="Now with the jury">
        {dispute.responses.length > 0
          ? 'Both sides are on the record. A jury of three is weighing the dispute.'
          : 'A jury of three is being drawn to weigh the dispute. If no majority is reached before the window closes, the transaction stands.'}
      </Banner>
    </>
  );
}

/** A selectable ruling chip. */
function ChoiceChip({
  theme,
  label,
  hint,
  selected,
  onPress,
}: {
  theme: Theme;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.chipWrap}>
      <Button
        variant={selected ? 'primary' : 'secondary'}
        size="md"
        fullWidth
        onPress={onPress}>
        {label}
      </Button>
      <Text
        variant="caption"
        color={theme.colors.textMuted}
        style={styles.chipHint}>
        {hint}
      </Text>
    </View>
  );
}

/** True once the dispute has an outcome a resolve pass would enact as final. */
function isTerminal(res: StationDisputeResolution): boolean {
  return (
    res === 'upheld' ||
    res === 'rejected' ||
    res === 'lapsed' ||
    res === 'escalation_upheld' ||
    res === 'escalation_rejected' ||
    res === 'escalation_lapsed'
  );
}

/** Badge label + variant for the dispute's current resolution. */
function resolutionDisplay(res: StationDisputeResolution): {
  label: string;
  variant: BadgeVariant;
} {
  switch (res) {
    case 'pending':
      return {label: 'Jury deliberating', variant: 'warning'};
    case 'awaiting_appeal':
      return {label: 'Ruled · appeal open', variant: 'warning'};
    case 'upheld':
    case 'escalation_upheld':
      return {label: 'Upheld', variant: 'danger'};
    case 'rejected':
    case 'escalation_rejected':
      return {label: 'Rejected', variant: 'success'};
    case 'lapsed':
    case 'escalation_lapsed':
      return {label: 'Lapsed', variant: 'neutral'};
    case 'escalation_pending':
      return {label: 'Community voting', variant: 'warning'};
  }
}

/** A sentence describing a terminal outcome, for the read-only banner. */
function terminalNote(res: StationDisputeResolution): string {
  switch (res) {
    case 'upheld':
    case 'escalation_upheld':
      return 'The dispute was upheld — the transaction will be voided and the confirmer’s attestation accuracy takes the hit.';
    case 'rejected':
    case 'escalation_rejected':
      return 'The dispute was rejected — the confirmed transaction stands and will settle.';
    case 'lapsed':
    case 'escalation_lapsed':
      return 'The window closed without a majority — the confirmed transaction stands and will settle.';
    default:
      return 'The station will enact the outcome on its next resolution pass.';
  }
}

/** Badge label for a juror's verdict. */
function verdictLabel(verdict: 'uphold' | 'reject' | 'awaiting'): string {
  switch (verdict) {
    case 'uphold':
      return 'Uphold';
    case 'reject':
      return 'Reject';
    case 'awaiting':
      return 'Awaiting';
  }
}

/** Badge variant for a juror's verdict. */
function verdictVariant(verdict: 'uphold' | 'reject' | 'awaiting'): BadgeVariant {
  switch (verdict) {
    case 'uphold':
      return 'danger';
    case 'reject':
      return 'success';
    case 'awaiting':
      return 'neutral';
  }
}

/** Friendly copy for a failed action, special-casing the common rejections. */
function actionErrorMessage(
  action: 'respond' | 'rule',
  error: string,
  message: string,
): string {
  if (error === 'unreachable') {
    return 'Couldn’t reach your station. Connect to it and try again.';
  }
  if (/already/i.test(message)) {
    return action === 'respond'
      ? 'You’ve already responded to this dispute.'
      : 'You’ve already cast your verdict.';
  }
  if (action === 'rule' && /seat|panel|juror/i.test(message)) {
    return 'You’re no longer on the panel for this dispute.';
  }
  if (/window|closed|not disputed/i.test(message)) {
    return 'This dispute is no longer open.';
  }
  return action === 'respond'
    ? `Couldn’t file your response: ${message}`
    : `Couldn’t cast your verdict: ${message}`;
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
  chipWrap: {flex: 1},
  chipHint: {textAlign: 'center', marginTop: 4},
  responseRow: {gap: 2},
});
