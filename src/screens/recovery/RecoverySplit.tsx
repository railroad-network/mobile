/**
 * Split the key (T1.2.3, step 2). On entry this actually performs the split:
 * the Rust FFI runs Shamir's Secret Sharing over the wallet secret, sealing one
 * shard to each holder's public key. The secret and shards stay in Rust — only
 * the opaque package handle comes back, held in {@link RecoveryContext} for the
 * distribute step. A brief progress state covers the work, then a confirmation.
 */
import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {RecoveryScreenProps} from '../../navigation/types';
import {useRecovery} from './RecoveryContext';
import {InlineNotice} from './InlineNotice';
import {RecoveryScaffold} from './RecoveryScaffold';

export function RecoverySplit({navigation}: RecoveryScreenProps<'RecoverySplit'>) {
  const theme = useTheme();
  const {wallet, holders, threshold, recoveryPackage, setRecoveryPackage} =
    useRecovery();
  const [error, setError] = useState<string | null>(null);
  // One-shot guard: the split is deterministic to re-run, but there's no reason
  // to redo the crypto on a strict-mode re-invoke. Mirrors GenerateWallet.
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const done = recoveryPackage !== null;

  useEffect(() => {
    if (done || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        if (wallet === null) {
          throw new Error('Wallet is locked.');
        }
        const pkg = await wallet.createRecoveryPackage(
          holders.map(h => h.address),
          threshold,
        );
        setRecoveryPackage(pkg);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not split your key.');
      }
    })();
    // `attempt` re-arms on retry; the other inputs are fixed for this flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function retry() {
    setError(null);
    startedRef.current = false;
    setAttempt(a => a + 1);
  }

  if (error !== null) {
    return (
      <RecoveryScaffold
        title="Split your key"
        onBack={() => navigation.goBack()}
        step={1}
        center
        footer={
          <Button variant="primary" size="lg" fullWidth onPress={retry}>
            Try again
          </Button>
        }>
        <View style={styles.center}>
          <Heading
            level="headingSmall"
            color={theme.colors.danger}
            style={[styles.centerText, {marginBottom: theme.spacing.sm}]}>
            Couldn't split your key
          </Heading>
          <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
            {error}
          </Text>
        </View>
      </RecoveryScaffold>
    );
  }

  if (!done) {
    return (
      <RecoveryScaffold title="Split your key" step={1} center>
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            style={{marginBottom: theme.spacing.lg}}
          />
          <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
            Splitting your key into {holders.length} shards, right here on your
            phone…
          </Text>
        </View>
      </RecoveryScaffold>
    );
  }

  return (
    <RecoveryScaffold
      title="Split your key"
      onBack={() => navigation.goBack()}
      step={1}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('DistributeShards')}>
          Distribute the shards
        </Button>
      }>
      <View style={[styles.center, {gap: theme.spacing.md, marginTop: theme.spacing.lg}]}>
        <View style={[styles.mark, {backgroundColor: theme.colors.primaryTint}]}>
          <Text style={styles.markGlyph}>🧩</Text>
        </View>
        <Heading level="headingMedium" style={styles.centerText}>
          Your key is now {holders.length} shards
        </Heading>
        <Text variant="body" color={theme.colors.textSecondary} style={styles.centerText}>
          Using Shamir's Secret Sharing. No single shard reveals anything — it
          takes any {threshold} together to rebuild your key.
        </Text>
        <InlineNotice variant="success" title="Nothing was uploaded">
          The split happened here, offline. Next, hand each piece to a holder in
          person.
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
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: {fontSize: 36, lineHeight: 44},
});
