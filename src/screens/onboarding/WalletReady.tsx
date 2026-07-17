/**
 * Wallet created (T1.2.2, final step). Shows the new identity's address as a QR
 * code and in full text — others scan it to pay or vouch for the user. From here
 * the user can set up social recovery now (T1.2.3) or skip it and enter the app.
 *
 * "Continue to recovery setup" pushes the recovery flow (tagged `onboarding`, so
 * its final screen enters the app). "Set up later" refreshes the wallet session,
 * which flips the root navigator straight from the onboarding stack to the app.
 */
import {StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {Button, Card, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import type {OnboardingScreenProps} from '../../navigation/types';
import {useOnboarding} from './OnboardingContext';
import {OnboardingScaffold} from './OnboardingScaffold';

const QR_SIZE = 180;

export function WalletReady({navigation}: OnboardingScreenProps<'WalletReady'>) {
  const theme = useTheme();
  const {createdAddress, createdWallet} = useOnboarding();
  const {adopt, refresh} = useWalletSession();

  // Entering the app flips the root navigator from the onboarding stack to the
  // main app; the stack unmounts, so no explicit navigation is needed. Adopting
  // the just-created wallet lands the user in the app unlocked; if the handle is
  // somehow missing, fall back to a plain refresh (the lock screen then asks).
  async function onSkip() {
    if (createdWallet !== null) {
      adopt(createdWallet);
    } else {
      await refresh();
    }
  }

  return (
    <OnboardingScaffold
      footer={
        <>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => navigation.navigate('Recovery', {origin: 'onboarding'})}>
            Continue to recovery setup
          </Button>
          <Button variant="ghost" size="lg" fullWidth onPress={onSkip}>
            Set up later
          </Button>
        </>
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
