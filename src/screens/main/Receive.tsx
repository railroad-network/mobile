/**
 * Receive — the "Request" quick action from Home. Shows the member's address as
 * a QR plus text so someone can pay them: they scan or copy the address, then
 * propose a payment from their own wallet. There is no amount request in M1
 * (a plain address is enough); a requested-amount flow can come later.
 */
import {ScrollView, StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Card, Heading, Identicon, Text} from '../../components';
import {shortAddress, useIdentity} from '../../ledger';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

const QR_SIZE = 220;

export function Receive({navigation}: MainStackScreenProps<'Receive'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data: identity} = useIdentity();
  const address = identity?.address ?? '';

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
        <Heading level="headingLarge">Request payment</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Have someone scan this to pay you, or share your address.
        </Text>
      </View>

      <Card style={styles.qrCard}>
        <Identicon seed={address} size={40} />
        {address.length > 0 && (
          <View style={styles.qrFrame}>
            <QRCode value={address} size={QR_SIZE} color="#000000" backgroundColor="#FFFFFF" />
          </View>
        )}
        <Text variant="mono" color={theme.colors.text} style={styles.address} selectable>
          {address}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {identity?.nickname ?? shortAddress(address)}
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  qrCard: {alignItems: 'center', gap: 16, paddingVertical: 24},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16},
  address: {textAlign: 'center'},
});
