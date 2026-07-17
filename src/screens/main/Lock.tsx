/**
 * The lock screen: unlock the wallet to enter the app (T1.3.4).
 *
 * The authenticated station channel signs every request — including reads — so
 * the app holds the unlocked wallet for the foreground session rather than
 * prompting per action. This screen is that one prompt: it gates the main app
 * whenever a wallet exists but is not unlocked (fresh launch, or after the app
 * was backgrounded). On success the wallet is held in the {@link WalletSession}
 * and routing swaps to the main stack; the encrypted wallet at rest is untouched.
 *
 * Rendered on the dark "night" canvas — the same brand moment as onboarding
 * ("travel by night, follow the North Star"), independent of the OS theme.
 */
import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Button, Field, Heading, StarMark, Text} from '../../components';
import {darkColors} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';

export function Lock() {
  const {unlock} = useWalletSession();
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function attemptUnlock() {
    if (passphrase.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await unlock(passphrase);
    if (!ok) {
      // A wrong passphrase (or a cancelled biometric prompt) both land here; the
      // copy stays deliberately generic so it never confirms a guess was close.
      setError('That passphrase didn’t unlock your wallet.');
      setPassphrase('');
      setBusy(false);
    }
    // On success this component unmounts (routing swaps to the main stack), so
    // there is nothing to reset.
  }

  return (
    <SafeAreaView style={styles.fill}>
      <View style={styles.body}>
        <View style={styles.mark}>
          <StarMark size={64} color={darkColors.accent} />
        </View>
        <Heading level="headingMedium" color={darkColors.text} style={styles.title}>
          Welcome back
        </Heading>
        <Text variant="body" color={darkColors.textSecondary} style={styles.subtitle}>
          Unlock your wallet to continue.
        </Text>
        <Field
          label="Passphrase"
          value={passphrase}
          onChangeText={t => {
            setPassphrase(t);
            if (error !== null) setError(null);
          }}
          error={error ?? undefined}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          onSubmitEditing={attemptUnlock}
          returnKeyType="go"
          autoFocus
          suffix={
            <Text
              variant="label"
              color={darkColors.accent}
              onPress={() => setShowPass(s => !s)}
              accessibilityRole="button"
              accessibilityLabel={showPass ? 'Hide passphrase' : 'Show passphrase'}>
              {showPass ? 'Hide' : 'Show'}
            </Text>
          }
        />
      </View>
      <View style={styles.footer}>
        <Button
          variant="accent"
          size="lg"
          fullWidth
          loading={busy}
          disabled={passphrase.length === 0}
          onPress={attemptUnlock}>
          Unlock
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: darkColors.bg,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  mark: {
    marginBottom: 28,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 28,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
});
