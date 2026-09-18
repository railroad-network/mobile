/**
 * First launch: a one-screen explanation of Railroad Network and the single
 * call to action that begins wallet creation (T1.2.2).
 *
 * Rendered on the dark "night" canvas — the brand moment the design system
 * calls for ("travel by night, follow the North Star"), independent of the OS
 * light/dark setting.
 */
import {StyleSheet, View} from 'react-native';

import {Button, Heading, StarMark, Text} from '../../components';
import {darkColors} from '../../theme';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

export function Welcome({navigation}: OnboardingScreenProps<'Welcome'>) {
  const {setRecoveredWallet} = useOnboarding();

  // Minting a fresh identity: drop any identity a previous, abandoned recovery
  // attempt left in the flow, so the generate step never seals *that* one under
  // this new wallet's passphrase instead of a new keypair.
  function createNew() {
    setRecoveredWallet(null);
    navigation.navigate('Passphrase');
  }

  return (
    <OnboardingScaffold
      dark
      footer={
        <>
          <Button variant="accent" size="lg" fullWidth onPress={createNew}>
            Create my wallet
          </Button>
          <Text
            variant="label"
            color={darkColors.text}
            onPress={() => navigation.navigate('RecoverChoice')}
            accessibilityRole="button"
            style={styles.recoverLink}>
            Recover an existing identity
          </Text>
          <Text
            variant="caption"
            color={darkColors.textMuted}
            style={styles.footNote}>
            Takes about a minute. No email, no phone number.
          </Text>
        </>
      }>
      <View style={styles.mark}>
        <StarMark size={72} color={darkColors.accent} />
      </View>
      <Heading level="headingMedium" color={darkColors.text} style={styles.title}>
        Welcome to Railroad Network
      </Heading>
      <Text variant="bodyLarge" color={darkColors.textSecondary}>
        A community economy you own. Your identity and your Commons live on this
        phone — not on anyone's server. Let's set up your wallet.
      </Text>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  mark: {
    marginBottom: 28,
  },
  title: {
    marginBottom: 12,
  },
  footNote: {
    textAlign: 'center',
    marginTop: 4,
  },
  recoverLink: {
    textAlign: 'center',
    paddingVertical: 12,
  },
});
