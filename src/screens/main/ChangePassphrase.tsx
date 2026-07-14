/**
 * Change passphrase (T1.2.8). Enter the current passphrase, then a new one
 * twice. The current passphrase is verified by re-opening the wallet (a wrong
 * one rejects and nothing changes); the new passphrase re-encrypts the stored
 * `.rrnwallet` bytes in place, keeping the biometric gate.
 */
import {useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Banner, Button, Field, Heading, Text} from '../../components';
import {changePassphrase} from '../../wallet/Wallet';
import {MIN_PASSPHRASE_LENGTH} from '../onboarding/passphraseStrength';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

const secureProps = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
  textContentType: 'none',
  importantForAutofill: 'no',
} as const;

export function ChangePassphrase({navigation}: MainStackScreenProps<'ChangePassphrase'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSPHRASE_LENGTH && next === confirm && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changePassphrase(current, next);
      setDone(true);
    } catch {
      // Wrong current passphrase, a cancelled biometric prompt, or a store error
      // all surface as one message.
      setError('Could not change it. Check your current passphrase and try again.');
    } finally {
      setBusy(false);
    }
  }

  const pad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  if (done) {
    return (
      <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={pad}>
        <Heading level="headingLarge">Passphrase changed</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Your wallet is now sealed with the new passphrase. Use it next time you unlock.
        </Text>
        <Button variant="primary" size="lg" fullWidth onPress={() => navigation.goBack()}>
          Done
        </Button>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={pad}>
      <View style={{gap: theme.spacing.xs}}>
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
        <Heading level="headingLarge">Change passphrase</Heading>
      </View>

      <Field
        label="Current passphrase"
        value={current}
        onChangeText={t => {
          setCurrent(t);
          if (error !== null) setError(null);
        }}
        error={error ?? undefined}
        secureTextEntry
        {...secureProps}
      />
      <Field
        label="New passphrase"
        value={next}
        onChangeText={setNext}
        hint={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
        error={tooShort ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` : undefined}
        secureTextEntry
        {...secureProps}
      />
      <Field
        label="Confirm new passphrase"
        value={confirm}
        onChangeText={setConfirm}
        error={mismatch ? 'Passphrases don’t match.' : undefined}
        secureTextEntry
        onSubmitEditing={submit}
        returnKeyType="go"
        {...secureProps}
      />

      <Banner variant="info" title="Keep it safe">
        There is no way to recover a forgotten passphrase — only your social-recovery circle can
        restore access.
      </Banner>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!canSubmit}
        onPress={submit}>
        Change passphrase
      </Button>
    </ScrollView>
  );
}
