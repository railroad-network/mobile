/**
 * Distribute the shards (T1.2.3, step 3). Each holder's sealed shard is shown as
 * a QR code for them to scan into their own wallet, in person. Delivery is
 * self-attested: the owner taps "Scanned" once a holder has it. At least
 * {@link RECOVERY_THRESHOLD} must be delivered to finish (fewer than that and
 * recovery wouldn't yet work); the rest can be handed out later.
 *
 * The shard payload comes straight from the Rust package handle and is
 * base64-wrapped for the QR ({@link encodeShardQr}); the plaintext secret is
 * never reconstructed on this device.
 */
import {useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {Button, Card, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {RecoveryScreenProps} from '../../navigation/types';
import {encodeShardQr} from '../../wallet/recoveryShard';
import {useRecovery} from './RecoveryContext';
import {RecoveryScaffold} from './RecoveryScaffold';

const QR_SIZE = 168;

export function DistributeShards({navigation}: RecoveryScreenProps<'DistributeShards'>) {
  const theme = useTheme();
  const {holders, threshold, recoveryPackage, delivered, markDelivered} = useRecovery();
  const [cursor, setCursor] = useState(0);

  const holder = holders[cursor];

  // The QR string for the holder currently in view. Reading the shard payload
  // is cheap, but re-encoding on every render (base64 of a few hundred bytes)
  // is needless — key it to the cursor.
  const qrValue = useMemo(() => {
    if (recoveryPackage === null) return null;
    try {
      return encodeShardQr(recoveryPackage.shardPayload(cursor));
    } catch {
      return null;
    }
  }, [recoveryPackage, cursor]);

  const deliveredCount = delivered.size;
  const isDelivered = delivered.has(cursor);
  const allDelivered = deliveredCount >= holders.length;
  const canFinish = deliveredCount >= threshold;

  function markAndAdvance() {
    markDelivered(cursor);
    if (cursor < holders.length - 1) {
      setCursor(cursor + 1);
    }
  }

  return (
    <RecoveryScaffold
      title="Hand out the shards"
      subtitle={`${deliveredCount} of ${holders.length} delivered`}
      onBack={() => navigation.goBack()}
      step={2}
      footer={
        <Button
          variant={allDelivered ? 'primary' : 'ghost'}
          size="lg"
          fullWidth
          disabled={!canFinish}
          onPress={() => navigation.navigate('RecoveryComplete')}>
          {allDelivered
            ? 'Finish setup'
            : canFinish
              ? 'Finish — distribute the rest later'
              : `Deliver at least ${threshold}`}
        </Button>
      }>
      <View style={[styles.centerCol, {gap: theme.spacing.sm, marginTop: theme.spacing.md}]}>
        <Heading level="headingSmall">
          {holder?.nickname ?? `Holder ${cursor + 1}`}
        </Heading>
        <Text variant="caption" color={theme.colors.textSecondary}>
          Shard {cursor + 1} of {holders.length}
        </Text>

        <Card style={[styles.qrCard, {opacity: isDelivered ? 0.4 : 1}]}>
          <View style={styles.qrFrame}>
            {qrValue !== null && (
              <QRCode value={qrValue} size={QR_SIZE} color="#000000" backgroundColor="#FFFFFF" />
            )}
          </View>
        </Card>

        <Text
          variant="body"
          color={theme.colors.textSecondary}
          style={styles.centerText}>
          Have {holder?.nickname ?? 'this holder'} scan this with their wallet.
          They hold one piece — they can never see your key alone.
        </Text>

        <View style={styles.navRow}>
          <Button
            variant="ghost"
            size="md"
            fullWidth
            disabled={cursor === 0}
            onPress={() => setCursor(cursor - 1)}>
            Previous
          </Button>
          {isDelivered ? (
            <Button
              variant="secondary"
              size="md"
              fullWidth
              disabled={cursor >= holders.length - 1}
              onPress={() => setCursor(cursor + 1)}>
              Next holder
            </Button>
          ) : (
            <Button variant="primary" size="md" fullWidth onPress={markAndAdvance}>
              Scanned
            </Button>
          )}
        </View>
      </View>

      <View style={{marginTop: theme.spacing.lg}}>
        <Heading level="headingSmall" style={{marginBottom: theme.spacing.sm}}>
          Holders
        </Heading>
        <View style={{gap: theme.spacing.xs}}>
          {holders.map((h, i) => {
            const hDone = delivered.has(i);
            return (
              <Pressable
                key={h.address}
                onPress={() => setCursor(i)}
                accessibilityRole="button"
                accessibilityLabel={`Show shard for ${h.nickname ?? h.address}`}
                style={[
                  styles.holderRow,
                  {
                    backgroundColor:
                      i === cursor ? theme.colors.surfaceSunken : 'transparent',
                    borderRadius: theme.radius.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.sm,
                  },
                ]}>
                <Text
                  variant="body"
                  color={theme.colors.text}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={styles.holderLabel}>
                  {h.nickname ?? h.address}
                </Text>
                <Text
                  variant="label"
                  color={hDone ? theme.colors.success : theme.colors.textMuted}>
                  {hDone ? 'Delivered' : 'Pending'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </RecoveryScaffold>
  );
}

const styles = StyleSheet.create({
  centerCol: {alignItems: 'center'},
  centerText: {textAlign: 'center'},
  qrCard: {padding: 14, marginTop: 8},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12},
  navRow: {flexDirection: 'row', gap: 10, width: '100%', marginTop: 12},
  holderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  holderLabel: {flex: 1, minWidth: 0},
});
