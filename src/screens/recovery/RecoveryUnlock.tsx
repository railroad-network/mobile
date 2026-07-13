/**
 * Re-unlock gate at the top of the recovery flow (T1.2.3).
 *
 * Splitting the key for social recovery needs the opened wallet, but by this
 * point onboarding has wiped the passphrase from memory and dropped the wallet
 * handle (it seals and forgets). So the wallet is opened again here: reading the
 * encrypted blob from the keychain triggers the OS biometric prompt (when the
 * user enabled it), and the passphrase entered here decrypts it. The opened
 * wallet is held in {@link RecoveryContext} for the rest of the flow.
 *
 * The same gate serves the Settings entry point, so recovery setup always
 * starts from a fresh, explicit unlock.
 */
import {useState} from 'react';
import {View} from 'react-native';

import {Button, Field, Text} from '../../components';
import {useTheme} from '../../theme';
import {loadWallet} from '../../wallet/Wallet';
import type {RecoveryScreenProps} from '../../navigation/types';
import {useRecovery} from './RecoveryContext';
import {RecoveryScaffold} from './RecoveryScaffold';

export function RecoveryUnlock({navigation}: RecoveryScreenProps<'RecoveryUnlock'>) {
  const theme = useTheme();
  const {setWallet} = useRecovery();
  const [passphrase, setPassphrase] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock() {
    if (passphrase.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = await loadWallet(passphrase);
      if (wallet === null) {
        // No wallet on this device — nothing to set recovery up for.
        setError('No wallet found on this device.');
        return;
      }
      setWallet(wallet);
      navigation.navigate('RecoveryIntro');
    } catch {
      // Wrong passphrase, a cancelled biometric prompt, or a tampered blob all
      // surface as one message — we never say which, to avoid leaking whether
      // the passphrase was the wrong part.
      setError('Could not unlock. Check your passphrase and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecoveryScaffold
      title="Confirm it's you"
      subtitle="Unlock your wallet to set up social recovery."
      onBack={() => navigation.getParent()?.goBack()}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={passphrase.length === 0}
          onPress={unlock}>
          Unlock
        </Button>
      }>
      <View style={{gap: theme.spacing.md, marginTop: theme.spacing.lg}}>
        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={t => {
            setPassphrase(t);
            if (error !== null) setError(null);
          }}
          error={error ?? undefined}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          onSubmitEditing={unlock}
          returnKeyType="go"
          suffix={
            <Text
              variant="label"
              color={theme.colors.primary}
              onPress={() => setShow(s => !s)}
              accessibilityRole="button"
              accessibilityLabel={show ? 'Hide passphrase' : 'Show passphrase'}>
              {show ? 'Hide' : 'Show'}
            </Text>
          }
        />
      </View>
    </RecoveryScaffold>
  );
}
