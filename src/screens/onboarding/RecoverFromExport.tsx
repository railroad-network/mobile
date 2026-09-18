/**
 * Restore from an exported wallet (ADR-0016, the import half of Settings → Export
 * wallet). The member pastes the base64 export they saved and the passphrase it
 * was sealed under; this opens it entirely in Rust ({@link importWalletFromExport}
 * → `EncryptedWallet.from_bytes(...).decrypt(...)`), and on success carries the
 * opened identity into the shared onboarding tail, where a *new* device
 * passphrase re-seals it. The export's own passphrase never becomes this device's
 * passphrase.
 *
 * Nothing is stored until that tail's seal step: a wrong passphrase or corrupt
 * paste surfaces one inline error and leaves the device untouched.
 */
import {useState} from 'react';
import {View} from 'react-native';

import {Button, Field, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {importWalletFromExport} from '../../wallet/Wallet';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

export function RecoverFromExport({
  navigation,
}: OnboardingScreenProps<'RecoverFromExport'>) {
  const theme = useTheme();
  const {setRecoveredWallet} = useOnboarding();

  const [exportText, setExportText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canContinue = exportText.trim().length > 0 && passphrase.length > 0;

  async function onContinue() {
    if (!canContinue || busy) return;
    setBusy(true);
    setError(null);
    try {
      const wallet = await importWalletFromExport(exportText, passphrase);
      // Hand the opened identity to the shared tail; it is sealed under a new
      // device passphrase there, never stored with the export's passphrase.
      setRecoveredWallet(wallet);
      // Drop the pasted export and its passphrase from this screen's memory now
      // that the identity is opened — they are not needed past this point.
      setExportText('');
      setPassphrase('');
      navigation.navigate('Passphrase');
    } catch {
      // A wrong passphrase, tampered bytes, or an unreadable paste all surface
      // as one message — we never distinguish which.
      setError("That didn't open. Check the export and its passphrase.");
    } finally {
      setBusy(false);
    }
  }

  const revealToggle = (
    <Text
      variant="label"
      color={theme.colors.textLink}
      onPress={() => setReveal(v => !v)}
      accessibilityRole="button"
      accessibilityLabel={reveal ? 'Hide passphrase' : 'Show passphrase'}>
      {reveal ? 'Hide' : 'Show'}
    </Text>
  );

  return (
    <OnboardingScaffold
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!canContinue}
          onPress={onContinue}>
          Continue
        </Button>
      }>
      <Heading level="headingMedium" style={{marginBottom: theme.spacing.sm}}>
        Restore from an export
      </Heading>
      <Text
        variant="body"
        color={theme.colors.textSecondary}
        style={{marginBottom: theme.spacing.lg}}>
        Paste the wallet export you saved, then enter the passphrase it was
        exported under.
      </Text>

      <View style={{gap: theme.spacing.lg}}>
        <Field
          label="Wallet export"
          value={exportText}
          onChangeText={t => {
            setExportText(t);
            if (error !== null) setError(null);
          }}
          placeholder="Paste the exported text here"
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
        />
        <Field
          label="Export passphrase"
          value={passphrase}
          onChangeText={t => {
            setPassphrase(t);
            if (error !== null) setError(null);
          }}
          placeholder="••••••••••••"
          error={error ?? undefined}
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          suffix={revealToggle}
          onSubmitEditing={onContinue}
          returnKeyType="go"
        />
      </View>
    </OnboardingScaffold>
  );
}
