/**
 * Shards you hold for others (T1.2.3, holder-receive).
 *
 * The counterpart to the owner's distribution flow: when a friend sets up social
 * recovery and hands you one of their sealed shards, you scan it here and this
 * device files it (see {@link wallet/heldShards}). You are one of several holders
 * and the shard is sealed to you — you can never see their key alone — so this
 * is a low-ceremony "keep this safe for me" screen, reachable from Settings and
 * needing no unlock of your own wallet.
 *
 * A scanned QR is only accepted if it is a recovery-shard QR (the
 * `rrnrecovery:` scheme, distinct from a plain `rrn1…` address QR) and its
 * payload parses; anything else is rejected with an explanation rather than
 * stored. Reconstruction (handing the shard back during a friend's recovery) is
 * a later milestone — this screen only receives and lists.
 */
import {useCallback, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Button, Card, Heading, QRScanner, Text} from '../../components';
import {bytesToBase64} from '../../crypto/base64';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import {decodeShardQr, parseShardPayload} from '../../wallet/recoveryShard';
import {
  deleteHeldShard,
  loadHeldShards,
  saveHeldShard,
  type HeldShard,
} from '../../wallet/heldShards';
import {InlineNotice, type NoticeVariant} from '../recovery/InlineNotice';

interface Notice {
  variant: NoticeVariant;
  title: string;
  body: string;
}

export function HeldShards({navigation}: MainStackScreenProps<'HeldShards'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [shards, setShards] = useState<HeldShard[]>([]);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const reload = useCallback(() => {
    loadHeldShards()
      .then(map => setShards(Object.values(map)))
      .catch(() => setShards([]));
  }, []);

  // Re-read on focus so a shard received elsewhere (or a fresh install) shows.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  async function handleScan(value: string) {
    setScanning(false);

    const bytes = decodeShardQr(value);
    if (bytes === null) {
      setNotice({
        variant: 'warning',
        title: "That isn't a recovery shard",
        body: 'Scan the shard your friend sent you — a plain address or other QR code won’t work here.',
      });
      return;
    }

    let info;
    try {
      info = parseShardPayload(bytes);
    } catch {
      setNotice({
        variant: 'warning',
        title: "Couldn't read that shard",
        body: 'The code was damaged or incomplete. Ask your friend to show it again.',
      });
      return;
    }

    try {
      await saveHeldShard({
        originalAddress: info.originalAddress,
        holderAddress: info.holderAddress,
        threshold: info.threshold,
        total: info.total,
        payload: bytesToBase64(bytes),
        receivedAt: Math.floor(Date.now() / 1000),
      });
      setNotice({
        variant: 'success',
        title: 'Shard saved',
        body: `You’re now holding a recovery piece. If your friend ever needs it, any ${info.threshold} of their ${info.total} holders can bring them back.`,
      });
      reload();
    } catch {
      setNotice({
        variant: 'warning',
        title: "Couldn't save the shard",
        body: 'Something went wrong writing to secure storage. Try scanning again.',
      });
    }
  }

  async function forget(originalAddress: string) {
    await deleteHeldShard(originalAddress);
    reload();
  }

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
      keyboardShouldPersistTaps="handled">
      <View style={{gap: theme.spacing.xs}}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{marginBottom: theme.spacing.xs}}>
          <Text variant="body" color={theme.colors.primary}>
            ‹ Back
          </Text>
        </Pressable>
        <Heading level="headingLarge">Shards you hold</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Recovery pieces friends have entrusted to you. Each is sealed to you and
          is only one piece — you can never see anyone’s key alone.
        </Text>
      </View>

      {notice !== null && (
        <InlineNotice variant={notice.variant} title={notice.title}>
          {notice.body}
        </InlineNotice>
      )}

      {scanning ? (
        <Card padded={false} style={styles.scanner}>
          <QRScanner onScan={handleScan} isActive={scanning} />
          <View style={styles.scannerCancel}>
            <Button variant="secondary" size="sm" onPress={() => setScanning(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          variant="accent"
          size="lg"
          fullWidth
          onPress={() => {
            setNotice(null);
            setScanning(true);
          }}>
          Scan a shard
        </Button>
      )}

      {shards.length === 0 ? (
        <InlineNotice variant="info" title="You’re not holding anything yet">
          When a friend sets up social recovery and shares a shard with you, scan
          it here to keep it safe.
        </InlineNotice>
      ) : (
        <View style={{gap: theme.spacing.sm}}>
          <Heading level="headingSmall">
            Holding {shards.length} {shards.length === 1 ? 'shard' : 'shards'}
          </Heading>
          {shards.map(shard => (
            <Card key={shard.originalAddress} style={styles.row}>
              <View style={styles.rowText}>
                <Text
                  variant="label"
                  color={theme.colors.text}
                  numberOfLines={1}
                  ellipsizeMode="middle">
                  {shard.originalAddress}
                </Text>
                <Text variant="caption" color={theme.colors.textSecondary}>
                  {shard.threshold}-of-{shard.total} recovery
                </Text>
              </View>
              <Pressable
                onPress={() => forget(shard.originalAddress)}
                accessibilityRole="button"
                accessibilityLabel={`Forget shard for ${shard.originalAddress}`}
                hitSlop={10}>
                <Text variant="label" color={theme.colors.danger}>
                  Forget
                </Text>
              </Pressable>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scanner: {height: 320, overflow: 'hidden'},
  scannerCancel: {position: 'absolute', bottom: 12, alignSelf: 'center'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {flex: 1, minWidth: 0, gap: 2},
});
