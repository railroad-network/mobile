/**
 * Sign the founding charter — a founder's side of a distributed founding
 * ceremony, pushed from the {@link Governance} hub.
 *
 * Genesis normally signs the Charter with every founder's *secret* on one
 * machine, which shuts out a phone-held founder (their key is locked in the
 * device keychain). The ceremony instead fixes the Charter body once, on the
 * coordinator, and gathers signatures incrementally: each declared founder signs
 * that exact body on their own device and hands back only their signature. This
 * screen is where a phone founder reads the body being ratified and adds their
 * signature; the Charter publishes once `ceil(founders × 0.75)` have signed.
 *
 * The body is rebuilt and verified against the ceremony's `body_hex` before
 * signing (see {@link createSignedCharterSignature}), so a founder can never sign
 * a body that differs from the one on offer. The read surface tells us who has
 * signed, so the screen knows this member's exact state — not yet a founder here,
 * already signed and waiting, or the one signature that publishes it — and shows
 * the right thing without guessing.
 */
import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Banner, Button, Card, ScreenHeader, Text} from '../../components';
import {
  shortAddress,
  useIdentity,
  usePendingCharter,
  useSignFoundingCharter,
} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {StationPendingCharter} from '../../network/StationClient';
import type {MainStackScreenProps} from '../../navigation/types';

export function SignCharter({navigation}: MainStackScreenProps<'SignCharter'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const identity = useIdentity();
  const pending = usePendingCharter();

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <ScreenHeader title="Founding charter" onBack={() => navigation.goBack()} />

      {pending.isLoading && (
        <Card>
          <Text variant="body" color={theme.colors.textSecondary}>
            Reading the founding charter from the station…
          </Text>
        </Card>
      )}

      {pending.isError && !pending.isLoading && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Couldn’t load the charter
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Your station either can’t be reached or hasn’t begun a founding
            ceremony yet.
          </Text>
        </Card>
      )}

      {pending.data !== undefined && !pending.data.exists && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            No founding ceremony yet
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            A founding ceremony is started from the station command line by the
            community’s coordinator. Once it’s under way, founders sign the
            charter here.
          </Text>
        </Card>
      )}

      {pending.data !== undefined && pending.data.exists && (
        <CeremonyBody
          theme={theme}
          pending={pending.data}
          ownAddress={identity.data?.address}
          onSigned={() => pending.refetch()}
        />
      )}
    </ScrollView>
  );
}

function CeremonyBody({
  theme,
  pending,
  ownAddress,
  onSigned,
}: {
  theme: Theme;
  pending: StationPendingCharter;
  ownAddress: string | undefined;
  onSigned: () => void;
}) {
  const signCharter = useSignFoundingCharter();
  // Hold the just-signed confirmation locally: the refetch that follows may lag,
  // and if this signature published the charter we want to say so immediately.
  const [justSigned, setJustSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFounder = ownAddress !== undefined && pending.founders.includes(ownAddress);
  const alreadySigned =
    ownAddress !== undefined && pending.signed_founders.includes(ownAddress);
  const published = pending.published;

  async function doSign() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signCharter();
    setBusy(false);
    if (result.ok) {
      setJustSigned(true);
      onSigned();
      return;
    }
    setError(signErrorMessage(result.error, result.message));
  }

  return (
    <>
      <View style={{gap: theme.spacing.sm}}>
        <View style={styles.badges}>
          <Badge variant="neutral" size="sm">{`v${pending.version}`}</Badge>
          {published ? (
            <Badge variant="success" size="sm">
              Ratified
            </Badge>
          ) : (
            <Badge variant="info" size="sm">
              Being signed
            </Badge>
          )}
        </View>
        <Text variant="headingMedium" color={theme.colors.text}>
          {pending.community_id}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          A community’s constitution. Its founders authorize it by each signing
          this same body from their own device.
        </Text>
      </View>

      {pending.founding_principles.length > 0 && (
        <Card style={{gap: theme.spacing.xs}}>
          <CharterList
            theme={theme}
            title="Founding principles"
            items={pending.founding_principles}
          />
        </Card>
      )}
      {pending.rights_floor.length > 0 && (
        <Card style={{gap: theme.spacing.xs}}>
          <CharterList theme={theme} title="Rights floor" items={pending.rights_floor} />
        </Card>
      )}

      {/* Who is founding it, and how far the signing has come. */}
      <Card style={{gap: theme.spacing.sm}}>
        <View style={styles.metaRow}>
          <Text variant="label" color={theme.colors.text}>
            Signatures
          </Text>
          <Text variant="body" color={theme.colors.text}>
            {pending.signed_founders.length} of {pending.threshold} needed
          </Text>
        </View>
        <Text variant="caption" color={theme.colors.textSecondary}>
          Founded by {pending.founders.length}{' '}
          {pending.founders.length === 1 ? 'member' : 'members'}; it publishes once{' '}
          {pending.threshold} have signed.
        </Text>
        <View style={{gap: theme.spacing.xs}}>
          {pending.founders.map(f => {
            const signed = pending.signed_founders.includes(f);
            const isYou = ownAddress !== undefined && f === ownAddress;
            return (
              <View key={f} style={styles.metaRow}>
                <Text variant="body" color={theme.colors.text}>
                  {shortAddress(f)}
                  {isYou ? ' (you)' : ''}
                </Text>
                <Text
                  variant="caption"
                  color={signed ? theme.colors.success : theme.colors.textMuted}>
                  {signed ? '✓ signed' : 'waiting'}
                </Text>
              </View>
            );
          })}
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
    // Published — either it already was, or this member's signature just tipped
    // it over. Terminal, so no button.
    if (published) {
      return (
        <Banner variant="success" title="Charter ratified">
          Enough founders have signed. The charter is now this community’s
          constitution, and governance can begin.
        </Banner>
      );
    }

    // This member has added their signature but the threshold isn't met yet.
    if (alreadySigned || justSigned) {
      return (
        <Banner variant="success" title="Your signature is in">
          Waiting for the other founders. The charter publishes once{' '}
          {pending.threshold} have signed.
        </Banner>
      );
    }

    // A founder who hasn't signed yet — the point of the screen.
    if (isFounder) {
      return (
        <>
          <Banner variant="info" title="Your signature is needed">
            Signing adds your authorization to this charter. Sign only a charter
            whose principles and rights you stand behind — it’s the community’s
            constitution.
          </Banner>
          <Button variant="primary" size="lg" fullWidth loading={busy} onPress={doSign}>
            Sign the founding charter
          </Button>
        </>
      );
    }

    // A ceremony is under way, but this phone isn't one of its declared founders.
    return (
      <Banner variant="info" title="You’re not a founder of this charter">
        Only the declared founders can sign this charter. You can still see who is
        founding the community and follow the signing here.
      </Banner>
    );
  }
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

/** Friendly copy for a signing failure, special-casing the common rejections. */
function signErrorMessage(error: string, message: string): string {
  if (error === 'unreachable') {
    return 'Couldn’t reach your station. Connect to it and try again.';
  }
  if (/already/i.test(message)) {
    return 'You’ve already signed this charter.';
  }
  if (/founder/i.test(message)) {
    return 'Only the declared founders can sign this charter.';
  }
  if (/match|body|drift/i.test(message)) {
    return 'The charter on your device didn’t match the station’s. It may have changed — reopen this screen and try again.';
  }
  return `Couldn’t sign: ${message}`;
}

const styles = StyleSheet.create({
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center'},
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  bulletRow: {flexDirection: 'row', gap: 8},
  bulletText: {flex: 1},
});
