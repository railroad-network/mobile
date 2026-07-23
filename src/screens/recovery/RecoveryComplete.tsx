/**
 * Recovery ready (T1.2.3, final step). Persists the (non-secret) recovery config
 * for Settings to show later, then confirms the circle is in place. "Done" exits
 * the flow: into the app when recovery was set up during onboarding, or back to
 * Settings when it was set up later.
 *
 * Persistence is best-effort and local only — the shards themselves already live
 * on the holders' phones, so a failed config write doesn't undo recovery; it
 * just means Settings won't show the circle until next time.
 */
import {useEffect, useRef} from 'react';
import {StyleSheet, View} from 'react-native';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {useWalletSession} from '../../wallet/WalletSession';
import {saveRecoveryConfig, type RecoveryHolder} from '../../wallet/recoveryConfig';
import type {RecoveryScreenProps} from '../../navigation/types';
import {useRecovery} from './RecoveryContext';
import {InlineNotice} from './InlineNotice';
import {RecoveryScaffold} from './RecoveryScaffold';

export function RecoveryComplete({navigation}: RecoveryScreenProps<'RecoveryComplete'>) {
  const theme = useTheme();
  const {origin, wallet, holders, threshold, delivered, clear, isRefresh} = useRecovery();
  const {adopt, refresh} = useWalletSession();

  const deliveredCount = delivered.size;
  const savedRef = useRef(false);

  useEffect(() => {
    if (savedRef.current || wallet === null) return;
    savedRef.current = true;

    const configHolders: RecoveryHolder[] = holders.map((h, i) => ({
      address: h.address,
      nickname: h.nickname,
      delivered: delivered.has(i),
    }));
    saveRecoveryConfig({
      originalAddress: wallet.address,
      threshold,
      total: holders.length,
      holders: configHolders,
      createdAt: Math.floor(Date.now() / 1000),
    }).catch(() => {
      // Best-effort; see file header.
    });
  }, [wallet, holders, threshold, delivered]);

  function done() {
    if (origin === 'onboarding') {
      // Flips the root navigator from the onboarding stack into the app. Adopt
      // the unlocked wallet (the one recovery just split) so the new user lands
      // in the app unlocked rather than at the lock screen; fall back to refresh
      // if the handle is missing. Read `wallet` before `clear()` wipes it.
      if (wallet !== null) {
        adopt(wallet);
      } else {
        refresh();
      }
      clear();
    } else {
      // Launched from Settings — pop the whole recovery flow off the main stack.
      clear();
      navigation.getParent()?.goBack();
    }
  }

  return (
    <RecoveryScaffold
      title={isRefresh ? 'Circle updated' : 'Recovery ready'}
      step={3}
      center
      footer={
        <Button variant="primary" size="lg" fullWidth onPress={done}>
          Done
        </Button>
      }>
      <View style={[styles.center, {gap: theme.spacing.md}]}>
        <View style={[styles.mark, {backgroundColor: theme.colors.successTint}]}>
          <Text style={styles.markGlyph}>🛡️</Text>
        </View>
        <Heading level="headingMedium" style={styles.centerText}>
          {isRefresh ? 'Your new circle has you' : 'Your circle has you'}
        </Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
          {deliveredCount} of {holders.length} shards delivered. If you ever lose
          this phone, any {threshold} of your holders can bring your identity back.
          No company can — that's the point.
        </Text>
        <InlineNotice
          variant="success"
          title={`${holders.length}-holder circle · ${threshold}-of-${holders.length} to restore`}>
          You can reissue a holder's shard later without changing your identity.
        </InlineNotice>
      </View>
    </RecoveryScaffold>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center'},
  centerText: {textAlign: 'center'},
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: {fontSize: 36, lineHeight: 44},
});
