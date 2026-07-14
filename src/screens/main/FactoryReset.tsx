/**
 * Factory reset (T1.2.8). Erases the wallet and everything wallet-scoped from
 * this device, returning the app to onboarding. Destructive and irreversible:
 * without a social-recovery circle, the identity is gone. To confirm, the user
 * must type their nickname — a deliberate speed bump, not a real secret.
 *
 * After clearing the secure store it also clears the in-memory ledger overlays
 * (outbox + decisions) and refreshes the wallet session, which flips the
 * top-level navigator back to onboarding.
 */
import {useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Banner, Button, Field, Heading, Text} from '../../components';
import {clearDecisions} from '../../ledger';
import {clearOutbox} from '../../ledger/outbox';
import {factoryReset} from '../../wallet/Wallet';
import {useWalletSession} from '../../wallet/WalletSession';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function FactoryReset({route, navigation}: MainStackScreenProps<'FactoryReset'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {refresh} = useWalletSession();

  const nickname = route.params.nickname;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = typed.trim() === nickname;

  async function reset() {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await factoryReset();
      clearOutbox();
      clearDecisions();
      // Flip the top-level navigator back to onboarding.
      await refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <View style={{gap: theme.spacing.xs}}>
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
        <Heading level="headingLarge">Factory reset</Heading>
      </View>

      <Banner variant="danger" title="This erases your wallet from this phone">
        Your identity, keys, and history are removed. Unless your social-recovery circle can restore
        you, this cannot be undone.
      </Banner>

      <Text variant="body" color={theme.colors.textSecondary}>
        Type your nickname <Text variant="mono" color={theme.colors.text}>{nickname}</Text> to
        confirm.
      </Text>
      <Field
        label="Nickname"
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={nickname}
      />

      <Button
        variant="danger"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!confirmed}
        onPress={reset}>
        Erase this wallet
      </Button>
    </ScrollView>
  );
}
