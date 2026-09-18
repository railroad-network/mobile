/**
 * Recover an existing identity onto this device (ADR-0016): the fork between the
 * two ways a member gets their key back after losing a phone.
 *
 *   - **From my recovery circle** — the member set up social recovery earlier and
 *     handed shards to people they trust. This device runs the reconstruction
 *     ceremony (`RecoverFromCircle`): it shows a request, the holders scan it and
 *     hand back responses, and any `RECOVERY_THRESHOLD` of them rebuild the key
 *     here — never on the station (ADR-0006).
 *   - **From an exported wallet** — the member kept a copy of their sealed
 *     `.rrnwallet` export (Settings → Export wallet). `RecoverFromExport` opens it
 *     with its passphrase.
 *
 * Both land in the same tail as a new wallet — set a passphrase for *this* device,
 * choose biometrics, then join/re-pair — so the recovered identity is sealed
 * afresh here and the old device's secret is never carried over.
 */
import {Pressable, View} from 'react-native';

import {Button, Card, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

export function RecoverChoice({
  navigation,
}: OnboardingScreenProps<'RecoverChoice'>) {
  const theme = useTheme();
  const {setRecoveredWallet} = useOnboarding();

  // Bail out of recovery straight into fresh wallet creation, mirroring Welcome's
  // "Create my wallet": drop any identity an abandoned recovery attempt left in
  // the flow so the generate step seals a new keypair, not that one.
  function createNew() {
    setRecoveredWallet(null);
    navigation.navigate('Passphrase');
  }

  return (
    <OnboardingScaffold
      footer={
        <>
          <Button variant="ghost" size="lg" fullWidth onPress={createNew}>
            Create a new wallet instead
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => navigation.goBack()}>
            Back
          </Button>
        </>
      }>
      <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
        Recover your identity
      </Heading>
      <Text
        variant="body"
        color={theme.colors.textSecondary}
        style={{marginBottom: theme.spacing.xl}}>
        Getting back into an identity you already have — from the people you
        trusted with recovery, or from a wallet export you saved.
      </Text>

      <View style={{gap: theme.spacing.md}}>
        <Pressable
          onPress={() => navigation.navigate('RecoverFromCircle')}
          accessibilityRole="button"
          accessibilityLabel="Recover from my recovery circle">
          <Card style={{gap: theme.spacing.xs}}>
            <Heading level="headingSmall">From my recovery circle</Heading>
            <Text variant="body" color={theme.colors.textSecondary}>
              Rebuild your key with help from the people you gave recovery shards
              to. You'll need enough of them together, in person or on a call.
            </Text>
          </Card>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('RecoverFromExport')}
          accessibilityRole="button"
          accessibilityLabel="Recover from an exported wallet">
          <Card style={{gap: theme.spacing.xs}}>
            <Heading level="headingSmall">From an exported wallet</Heading>
            <Text variant="body" color={theme.colors.textSecondary}>
              Paste a wallet export you saved earlier and unlock it with the
              passphrase it was exported under.
            </Text>
          </Card>
        </Pressable>
      </View>
    </OnboardingScaffold>
  );
}
