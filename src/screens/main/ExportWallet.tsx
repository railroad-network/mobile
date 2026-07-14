/**
 * Export wallet bytes (T1.2.8). Transferring the identity to another device: the
 * passphrase is entered and verified, then the sealed `.rrnwallet` bytes are
 * produced as base64 for the user to copy. The export is still passphrase-
 * encrypted — the same sealed format — so it is useless without the passphrase.
 *
 * Minimal by design: it copies the base64 to the clipboard. A file/QR/AirDrop
 * transfer is a later refinement.
 */
import {useState} from 'react';
import {ScrollView, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Banner, Button, Card, Field, Heading, Text} from '../../components';
import {exportWalletBytes} from '../../wallet/Wallet';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function ExportWallet({navigation}: MainStackScreenProps<'ExportWallet'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function doExport() {
    if (passphrase.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setExported(await exportWalletBytes(passphrase));
    } catch {
      setError('Could not export. Check your passphrase and try again.');
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
        <Heading level="headingLarge">Export wallet</Heading>
      </View>

      {exported === null ? (
        <>
          <Text variant="body" color={theme.colors.textSecondary}>
            This produces your encrypted wallet file so you can move your identity to another
            device. It stays sealed with your passphrase.
          </Text>
          <Field
            label="Passphrase"
            value={passphrase}
            onChangeText={t => {
              setPassphrase(t);
              if (error !== null) setError(null);
            }}
            error={error ?? undefined}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            onSubmitEditing={doExport}
            returnKeyType="go"
          />
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={passphrase.length === 0}
            onPress={doExport}>
            Export
          </Button>
        </>
      ) : (
        <>
          <Banner variant="warning" title="Anyone with this file and your passphrase is you">
            Keep it private. Move it directly to your other device and delete any copies afterwards.
          </Banner>
          <Card>
            <Text variant="mono" color={theme.colors.text} selectable numberOfLines={6}>
              {exported}
            </Text>
          </Card>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => {
              Clipboard.setString(exported);
              setCopied(true);
            }}>
            {copied ? 'Copied ✓' : 'Copy to clipboard'}
          </Button>
        </>
      )}
    </ScrollView>
  );
}
