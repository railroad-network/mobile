/**
 * Vouch flow (T1.4.1).
 *
 * A four-step full-screen flow (from the Community tab): identify the subject
 * (scan their address QR in person, or paste the address) → add a statement and
 * an optional reputation stake → review → sign and submit. The vouch is a real
 * voucher-signed attestation built on-device ({@link createSignedVouch} via
 * {@link useSubmitVouch}) and transmitted over the authenticated channel; the
 * community it is stamped into comes from the station's `whoami` at vouch time.
 *
 * The QR accepts both payload forms of `station/docs/spec/qr-payloads.md` §1 —
 * bare bech32 and the `rrn:address?addr=…&n=…` envelope. A carried nickname is
 * only a display hint: it pre-fills the local nickname the voucher can edit at
 * review time, and never enters the signed vouch.
 *
 * Edge cases: an invalid address blocks; vouching for your own address blocks;
 * a zero stake is allowed (Phase 0 records but does not enforce stakes) but the
 * review step says what staking means. Online-only like Send: if the station is
 * unreachable nothing is queued — the user retries when connected.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Identicon,
  QRScanner,
  Text,
} from '../../components';
import {
  formatCommons,
  parseAddressQr,
  parseCommons,
  shortAddress,
  useConnectivity,
  useIdentity,
  useSubmitVouch,
} from '../../ledger';
import {useWalletSession} from '../../wallet/WalletSession';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

/** Statement length cap (plain text), matching the memo cap elsewhere. */
const STATEMENT_MAX = 200;
/** Nickname length cap, matching the QR spec's `n=` bound. */
const NICKNAME_MAX = 200;

type Step = 'subject' | 'details' | 'review' | 'success';

export function Vouch({navigation}: MainStackScreenProps<'Vouch'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const {data: identity} = useIdentity();
  const {isOffline} = useConnectivity();
  const {wallet} = useWalletSession();
  const submitVouch = useSubmitVouch();

  const [step, setStep] = useState<Step>('subject');
  const [subjectInput, setSubjectInput] = useState('');
  const [subject, setSubject] = useState('');
  const [scanning, setScanning] = useState(false);
  const [nickname, setNickname] = useState('');
  const [statement, setStatement] = useState('');
  const [stake, setStake] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [stakeError, setStakeError] = useState<string | null>(null);

  // Submit step.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Result of a completed vouch, for the success screen.
  const [vouchId, setVouchId] = useState('');
  const [community, setCommunity] = useState('');

  // The stake field is optional: empty means 0 (recorded, not enforced in Phase 0).
  const parsedStake = stake.trim().length === 0 ? {centi: 0} : parseCommons(stake);
  const stakeCenti = 'centi' in parsedStake ? parsedStake.centi : 0;
  const subjectLabel =
    nickname.trim().length > 0 ? nickname.trim() : subject.length > 0 ? shortAddress(subject) : '';

  // --- Step transitions -----------------------------------------------------

  /** Validates a candidate subject (typed or scanned); advances on success. */
  function acceptSubject(raw: string) {
    const scanned = parseAddressQr(raw);
    if (scanned === null) {
      setSubjectError('That doesn’t look like a valid rrn1… address.');
      return;
    }
    if (identity?.address !== undefined && scanned.address === identity.address) {
      setSubjectError('That’s your own address — you can’t vouch for yourself.');
      return;
    }
    setSubject(scanned.address);
    if (scanned.nickname !== undefined && nickname.trim().length === 0) {
      // A QR-carried nickname is a display hint only; pre-fill, never trust.
      setNickname(scanned.nickname);
    }
    setSubjectError(null);
    setStep('details');
  }

  function confirmDetails() {
    if ('error' in parsedStake) {
      setStakeError(parsedStake.error);
      return;
    }
    setStakeError(null);
    setStep('review');
  }

  async function submit() {
    if (busy) {
      return;
    }
    // Authoritative self-vouch guard against the *real* wallet address (the
    // subject step only knows the displayed identity).
    if (wallet !== null && wallet.address === subject) {
      setSubmitError('That’s your own address — you can’t vouch for yourself.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const result = await submitVouch(subject, statement.trim(), stakeCenti);
    setBusy(false);
    if (result.ok) {
      setVouchId(result.vouchId);
      setCommunity(result.community);
      setStep('success');
      return;
    }
    // Online-only: a vouch that could not reach the station is not queued for
    // later — the user is told plainly and can retry when connected.
    setSubmitError(
      result.error === 'unreachable'
        ? 'Couldn’t reach your station. Connect to it and try again.'
        : `Couldn’t vouch: ${result.message}`,
    );
  }

  // --- Rendering ------------------------------------------------------------

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  // Step: subject ------------------------------------------------------------
  if (step === 'subject') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header
          theme={theme}
          title="Vouch for someone"
          subtitle="In person: they show their address QR, you scan it and stake your word that they’re real."
          onBack={() => navigation.goBack()}
        />
        {scanning ? (
          <View style={{gap: theme.spacing.md}}>
            <QRScanner
              onScan={value => {
                setScanning(false);
                setSubjectInput(value.trim());
                acceptSubject(value);
              }}
              style={styles.scanner}
            />
            <Button variant="secondary" size="lg" fullWidth onPress={() => setScanning(false)}>
              Cancel scan
            </Button>
          </View>
        ) : (
          <View style={{gap: theme.spacing.md}}>
            <Field
              label="Vouch for"
              value={subjectInput}
              onChangeText={t => {
                setSubjectInput(t);
                if (subjectError !== null) setSubjectError(null);
              }}
              error={subjectError ?? undefined}
              placeholder="rrn1…"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
            />
            <Button variant="accent" size="lg" fullWidth onPress={() => setScanning(true)}>
              Scan their QR code
            </Button>
          </View>
        )}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={subjectInput.trim().length === 0}
          onPress={() => acceptSubject(subjectInput)}>
          Continue
        </Button>
      </ScrollView>
    );
  }

  // Step: statement + stake --------------------------------------------------
  if (step === 'details') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header theme={theme} title="About them" onBack={() => setStep('subject')} />
        <Card style={styles.subjectCard}>
          <Identicon seed={subject} size={40} />
          <View style={styles.subjectText}>
            <Text variant="mono" color={theme.colors.text} numberOfLines={1}>
              {shortAddress(subject)}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              The person you’re vouching for
            </Text>
          </View>
        </Card>
        <Field
          label="Their name (kept on your phone)"
          value={nickname}
          onChangeText={setNickname}
          placeholder="e.g. Maria from the mill"
          maxLength={NICKNAME_MAX}
          hint="Optional — a note to yourself, never sent"
        />
        <Field
          label="Your statement"
          value={statement}
          onChangeText={setStatement}
          placeholder="e.g. I’ve known them for years"
          maxLength={STATEMENT_MAX}
          hint="Optional — recorded with the vouch for the community to see"
        />
        <Field
          label="Reputation to stake"
          value={stake}
          onChangeText={t => {
            setStake(t);
            if (stakeError !== null) setStakeError(null);
          }}
          error={stakeError ?? undefined}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoCorrect={false}
          hint="Optional — points you put behind your word"
        />
        <Button variant="primary" size="lg" fullWidth onPress={confirmDetails}>
          Review vouch
        </Button>
      </ScrollView>
    );
  }

  // Step: review -------------------------------------------------------------
  if (step === 'review') {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
        <Header theme={theme} title="Review vouch" onBack={() => setStep('details')} />
        <Card style={{gap: theme.spacing.md}}>
          <Row theme={theme} label="For">
            <Identicon seed={subject} size={28} />
            <Text variant="mono" color={theme.colors.text} numberOfLines={1}>
              {subjectLabel}
            </Text>
          </Row>
          <Row theme={theme} label="Statement">
            <Text variant="body" color={theme.colors.text}>
              {statement.trim().length > 0 ? statement.trim() : '—'}
            </Text>
          </Row>
          <Row theme={theme} label="Stake">
            <Text variant="body" color={theme.colors.text}>
              {formatCommons(stakeCenti)} points
            </Text>
          </Row>
        </Card>
        <Banner variant="warning" title="This is your word">
          A vouch tells the community this person is real and known to you. It’s recorded
          permanently under your name{stakeCenti > 0 ? ', with your stake behind it' : ''}.
        </Banner>
        {isOffline && (
          <Banner variant="warning" title="You’re offline">
            Connect to your station to submit this vouch.
          </Banner>
        )}
        {submitError !== null && (
          <Banner variant="danger" title="Vouch not sent">
            {submitError}
          </Banner>
        )}
        <Button variant="primary" size="lg" fullWidth loading={busy} onPress={submit}>
          Sign &amp; vouch
        </Button>
      </ScrollView>
    );
  }

  // Step: success ------------------------------------------------------------
  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <View style={{alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.lg}}>
        <Heading level="headingLarge">Vouch recorded</Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.centered}>
          Your vouch for {subjectLabel} is on the {community} record.
        </Text>
        {vouchId.length > 0 && (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.centered}>
            Vouch {shortId(vouchId)}
          </Text>
        )}
      </View>
      <Button variant="primary" size="lg" fullWidth onPress={() => navigation.goBack()}>
        Done
      </Button>
    </ScrollView>
  );
}

/** Shared step header: an optional back link, a title, and an optional subtitle. */
function Header({
  theme,
  title,
  subtitle,
  onBack,
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <View style={{gap: theme.spacing.xs}}>
      {onBack !== undefined && (
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
      )}
      <Heading level="headingLarge">{title}</Heading>
      {subtitle !== undefined && (
        <Text variant="body" color={theme.colors.textSecondary}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/** A label / value row inside the review card. */
function Row({theme, label, children}: {theme: Theme; label: string; children: React.ReactNode}) {
  return (
    <View style={styles.row}>
      <Text variant="body" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

/** A short, human handle for a vouch id (hex) on the success screen. */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

const styles = StyleSheet.create({
  scanner: {height: 280, borderRadius: 16, overflow: 'hidden'},
  subjectCard: {flexDirection: 'row', alignItems: 'center', gap: 14},
  subjectText: {flex: 1, minWidth: 0, gap: 2},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12},
  rowValue: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  centered: {textAlign: 'center'},
});
