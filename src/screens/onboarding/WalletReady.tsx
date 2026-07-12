/**
 * Wallet created (T1.2.2, final step). Shows the new identity's address as a QR
 * code and in full text — others scan it to pay or vouch for the user. The CTA
 * continues into social-recovery setup (T1.2.3).
 *
 * "Continue" completes onboarding: it refreshes the wallet session, which flips
 * the root navigator from the onboarding stack to the main app. (Recovery setup
 * lands in T1.2.3; until then this is the hand-off point.)
 */
import {StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {Button, Card, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

const QR_SIZE = 180;

export function WalletReady() {
  const theme = useTheme();
  const {createdAddress} = useOnboarding();
  const {refresh} = useWalletSession();

  // Refreshing the session flips the root navigator from the onboarding stack
  // to the main app; the stack unmounts, so no explicit navigation is needed.
  // (T1.2.3 will instead route into the recovery-setup stack here.)
  async function onContinue() {
    await refresh();
  }

  return (
    <OnboardingScaffold
      footer={
        <Button variant="primary" size="lg" fullWidth onPress={onContinue}>
          Continue to recovery setup
        </Button>
      }>
      <View style={styles.body}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: theme.colors.successTint,
              borderColor: theme.colors.success,
            },
          ]}>
          <Text variant="label" color={theme.colors.success}>
            ✓ Wallet created
          </Text>
        </View>

        <Card style={styles.qrCard}>
          <View style={styles.qrFrame}>
            {createdAddress !== null && (
              <QRCode
                value={createdAddress}
                size={QR_SIZE}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            )}
          </View>
        </Card>

        <Heading
          level="headingSmall"
          style={[styles.centerText, {marginBottom: theme.spacing.xs}]}>
          This is your address
        </Heading>
        <Text
          variant="body"
          color={theme.colors.textSecondary}
          style={[styles.centerText, {marginBottom: theme.spacing.md}]}>
          Others scan this to pay you or vouch for you. It's yours forever.
        </Text>

        <Card style={{padding: theme.spacing.md}}>
          <Text
            variant="mono"
            color={theme.colors.text}
            selectable
            style={styles.centerText}
            accessibilityLabel={`Your address: ${createdAddress ?? ''}`}>
            {createdAddress}
          </Text>
        </Card>
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 20,
  },
  qrCard: {
    padding: 14,
    marginBottom: 20,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
  },
  centerText: {
    textAlign: 'center',
  },
});
