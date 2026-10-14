/**
 * Shards you hold for others (T1.2.3, holder-receive).
 *
 * The counterpart to the owner's distribution flow: when a friend sets up social
 * recovery and hands you one of their sealed shards, you scan it here and this
 * device files it (see {@link wallet/heldShards}). You are one of several holders
 * and the shard is sealed to you — you can never see their key alone — so this
 * is a low-ceremony "keep this safe for me" screen, reachable from Settings. A
 * scan needs this session's unlocked wallet, whose public key the shard's
 * claimed holder is checked against.
 *
 * A scanned QR is only accepted if it is a recovery-shard QR (the
 * `rrnrecovery:` scheme, distinct from a plain `rrn1…` address QR), its payload
 * parses, and it names this wallet's own key as its holder; anything else is
 * rejected with an explanation rather than stored. A shard payload is not
 * signed by its owner, so anyone can make one that claims to be a friend's: a
 * *different* piece for someone already held is never filed without an explicit
 * confirmation (the `confirmReplace` step), whose default keeps the current
 * piece. Handing a piece back during a friend's recovery is {@link HelpRecover}.
 */
import {useCallback, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Button,
  Card,
  Heading,
  QRScanner,
  ScreenHeader,
  Text,
} from '../../components';
import {bytesToBase64} from '../../crypto/base64';
import {dayLabel, shortAddress} from '../../ledger/format';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import {decodeShardQr, parseShardPayload} from '../../wallet/recoveryShard';
import {
  deleteHeldShard,
  HeldShardExistsError,
  loadHeldShards,
  saveHeldShard,
  shardIsForKey,
  type HeldShard,
} from '../../wallet/heldShards';
import {loadVouchNicknames, type VouchNicknames} from '../../wallet/vouchNicknames';
import {useWalletSession} from '../../wallet/WalletSession';
import {InlineNotice, type NoticeVariant} from '../recovery/InlineNotice';

interface Notice {
  variant: NoticeVariant;
  title: string;
  body: string;
}

/** A scanned piece that differs from the one already held for its owner. */
interface PendingReplace {
  incoming: HeldShard;
  existing: HeldShard;
}

export function HeldShards({navigation}: MainStackScreenProps<'HeldShards'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const {wallet} = useWalletSession();

  const [shards, setShards] = useState<HeldShard[]>([]);
  const [nicknames, setNicknames] = useState<VouchNicknames>({});
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  // This wallet's own public key, against which every shard's claimed holder is
  // checked. `null` (no unlocked wallet) refuses every scan.
  const ownKey = useMemo(() => {
    if (wallet === null) {
      return null;
    }
    try {
      return wallet.publicKey().toBytes();
    } catch {
      return null;
    }
  }, [wallet]);

  const reload = useCallback(() => {
    loadHeldShards()
      .then(map => setShards(Object.values(map)))
      .catch(() => setShards([]));
    loadVouchNicknames()
      .then(setNicknames)
      .catch(() => setNicknames({}));
  }, []);

  const ownerName = (address: string) => nicknames[address] ?? shortAddress(address);

  // Held rows sealed to another identity — kept and flagged, never used here.
  const sealedElsewhere = useMemo(
    () =>
      new Set(
        ownKey === null
          ? []
          : shards
              .filter(row => !shardIsForKey(row.holderAddress, ownKey))
              .map(row => row.originalAddress),
      ),
    [shards, ownKey],
  );

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

    if (ownKey === null) {
      setNotice({
        variant: 'warning',
        title: "Couldn't check that piece",
        body: 'Unlock the app and scan again, so it can check the piece is addressed to you. Nothing was saved.',
      });
      return;
    }
    if (!shardIsForKey(info.holderAddress, ownKey)) {
      setNotice({
        variant: 'warning',
        title: "This piece isn't addressed to you",
        body: 'It was made for a different identity, so this device could never use it. Nothing was saved.',
      });
      return;
    }

    const incoming: HeldShard = {
      originalAddress: info.originalAddress,
      holderAddress: info.holderAddress,
      threshold: info.threshold,
      total: info.total,
      payload: bytesToBase64(bytes),
      receivedAt: Math.floor(Date.now() / 1000),
    };

    try {
      const outcome = await saveHeldShard(incoming);
      if (outcome === 'unchanged') {
        setNotice({
          variant: 'info',
          title: 'You already hold this piece',
          body: `Nothing changed — this is the same piece you’re keeping for ${ownerName(info.originalAddress)}.`,
        });
        return;
      }
      showSaved(incoming);
    } catch (e) {
      if (e instanceof HeldShardExistsError) {
        setPending({incoming, existing: e.existing});
        return;
      }
      showSaveFailed();
    }
  }

  function showSaved(shard: HeldShard) {
    setNotice({
      variant: 'success',
      title: `Piece saved for ${ownerName(shard.originalAddress)}`,
      body: `You’re now holding a recovery piece for ${shard.originalAddress}. If your friend ever needs it, any ${shard.threshold} of their ${shard.total} holders can bring them back.`,
    });
    reload();
  }

  function showSaveFailed() {
    setNotice({
      variant: 'warning',
      title: "Couldn't save the shard",
      body: 'Something went wrong writing to secure storage. Try scanning again.',
    });
  }

  function keepCurrent() {
    if (pending !== null) {
      setNotice({
        variant: 'info',
        title: 'Kept your current piece',
        body: `Nothing changed — you still hold the same piece for ${ownerName(pending.existing.originalAddress)}.`,
      });
    }
    setPending(null);
  }

  async function replaceHeld() {
    if (pending === null) {
      return;
    }
    const {incoming} = pending;
    setPending(null);
    try {
      await saveHeldShard(incoming, undefined, {replace: true});
      showSaved(incoming);
    } catch {
      showSaveFailed();
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
      <ScreenHeader
        title="Shards you hold"
        subtitle={
          'Recovery pieces friends have entrusted to you. Each is sealed to you ' +
          'and is only one piece — you can never see anyone’s key alone.'
        }
        onBack={() => navigation.goBack()}
      />

      {notice !== null && (
        <InlineNotice variant={notice.variant} title={notice.title}>
          {notice.body}
        </InlineNotice>
      )}

      {pending !== null ? (
        <Card style={{gap: theme.spacing.sm}}>
          <Heading level="headingSmall">Replace your piece?</Heading>
          {nicknames[pending.incoming.originalAddress] !== undefined && (
            <Text variant="label" color={theme.colors.text}>
              {nicknames[pending.incoming.originalAddress]}
            </Text>
          )}
          <Text variant="mono" color={theme.colors.text} selectable>
            {pending.incoming.originalAddress}
          </Text>
          <Text variant="caption" color={theme.colors.textSecondary}>
            Piece you hold: received {dayLabel(pending.existing.receivedAt)},{' '}
            {pending.existing.threshold}-of-{pending.existing.total} recovery
          </Text>
          <Text variant="caption" color={theme.colors.textSecondary}>
            New piece: {pending.incoming.threshold}-of-{pending.incoming.total}{' '}
            recovery
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            You already hold a recovery piece for this person. Replace it only if
            they asked you, in person, to take a new one. Anyone can make a code
            that claims to be theirs — if this one is fake and you replace your
            piece, they may not be able to recover.
          </Text>
          <Button variant="primary" size="lg" fullWidth onPress={keepCurrent}>
            Keep my current piece
          </Button>
          <Button variant="danger" size="md" fullWidth onPress={replaceHeld}>
            Replace it
          </Button>
        </Card>
      ) : scanning ? (
        <Card padded={false} style={styles.scanner}>
          <QRScanner onScan={handleScan} isActive={scanning} />
          <View style={styles.scannerCancel}>
            <Button variant="secondary" size="sm" onPress={() => setScanning(false)}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <View style={{gap: theme.spacing.sm}}>
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
          <Button
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => navigation.navigate('HelpRecover')}>
            Help someone recover
          </Button>
        </View>
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
                {sealedElsewhere.has(shard.originalAddress) && (
                  <Text variant="caption" color={theme.colors.warning}>
                    Sealed to a different identity — this device can’t use it.
                  </Text>
                )}
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
