/**
 * Help a friend recover (T1.11.3 slice D, holder-contribute).
 *
 * The counterpart to {@link HeldShards}: when someone you hold a recovery shard
 * for has lost their key, they run a recovery ceremony and show you a request
 * QR. You scan it here, confirm whom it is for, unlock your own wallet, and this
 * device turns the sealed piece you're holding into a response the friend scans
 * back — any `K` such responses rebuild their wallet.
 *
 * The flow is three in-screen steps (no extra nav routes):
 *   1. `scan`     — scan the friend's `rrnrecover-req:` request QR.
 *   2. `confirm`  — we look up the shard held for the identity the request
 *                   targets; if we hold one, unlock this wallet to contribute.
 *   3. `response` — show the `rrnrecover-resp:` QR for the friend to scan.
 *
 * The raw share never appears in the clear: {@link Wallet.respondToRecovery}
 * re-seals it to the operator's ephemeral recovery key inside the response, and
 * this device's own secret never leaves Rust. A single response is still below
 * the reconstruction threshold, so contributing reveals nothing on its own.
 */
import {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  Button,
  Card,
  Field,
  Heading,
  QRScanner,
  ScreenHeader,
  Text,
} from '../../components';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import {loadWallet} from '../../wallet/Wallet';
import {
  loadHeldShards,
  shardPayloadBytes,
  type HeldShard,
  type HeldShards,
} from '../../wallet/heldShards';
import {
  decodeRequestQr,
  encodeResponseQr,
  parseRecoveryRequest,
} from '../../wallet/recoveryCeremony';
import {InlineNotice, type NoticeVariant} from '../recovery/InlineNotice';

const QR_SIZE = 200;

interface Notice {
  variant: NoticeVariant;
  title: string;
  body: string;
}

/** What we scanned and the shard we hold for it, carried into the confirm step. */
interface Target {
  address: string;
  shard: HeldShard;
  request: Uint8Array;
}

type Mode = 'scan' | 'confirm' | 'response';

export function HelpRecover({navigation}: MainStackScreenProps<'HelpRecover'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('scan');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [responseQr, setResponseQr] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startScan = useCallback(() => {
    setNotice(null);
    setTarget(null);
    setResponseQr(null);
    setPassphrase('');
    setUnlockError(null);
    setMode('scan');
  }, []);

  async function handleScan(value: string) {
    const bytes = decodeRequestQr(value);
    if (bytes === null) {
      setNotice({
        variant: 'warning',
        title: "That isn't a recovery request",
        body: 'Scan the request your friend’s station is showing — a shard or plain address QR won’t work here.',
      });
      return;
    }

    let info;
    try {
      info = parseRecoveryRequest(bytes);
    } catch {
      setNotice({
        variant: 'warning',
        title: "Couldn't read that request",
        body: 'The code was damaged or incomplete. Ask your friend to show it again.',
      });
      return;
    }

    const shards = await loadHeldShards().catch(() => ({}) as HeldShards);
    const shard = shards[info.targetAddress];
    if (shard === undefined) {
      setNotice({
        variant: 'warning',
        title: "You're not holding a piece for them",
        body: 'This device has no recovery shard for that identity, so it can’t help with this recovery.',
      });
      return;
    }

    setNotice(null);
    setTarget({address: info.targetAddress, shard, request: bytes});
    setMode('confirm');
  }

  async function contribute() {
    if (target === null || passphrase.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setUnlockError(null);
    try {
      const wallet = await loadWallet(passphrase);
      if (wallet === null) {
        setUnlockError('No wallet found on this device.');
        return;
      }
      const response = await wallet.respondToRecovery(
        shardPayloadBytes(target.shard),
        target.request,
      );
      setResponseQr(encodeResponseQr(response));
      setMode('response');
    } catch {
      // A wrong passphrase, a cancelled biometric prompt, a tampered blob, or an
      // address mismatch all surface as one message — we never say which.
      setUnlockError('Could not contribute. Check your passphrase and try again.');
    } finally {
      setBusy(false);
    }
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
        title="Help someone recover"
        subtitle={
          'When a friend you hold a shard for loses their key, scan the request ' +
          'their station shows to contribute your piece.'
        }
        onBack={() => navigation.goBack()}
      />

      {notice !== null && (
        <InlineNotice variant={notice.variant} title={notice.title}>
          {notice.body}
        </InlineNotice>
      )}

      {mode === 'scan' && (
        <Card padded={false} style={styles.scanner}>
          <QRScanner onScan={handleScan} isActive />
        </Card>
      )}

      {mode === 'confirm' && target !== null && (
        <View style={{gap: theme.spacing.md}}>
          <Card style={{gap: theme.spacing.xs}}>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Recovering
            </Text>
            <Text
              variant="label"
              color={theme.colors.text}
              numberOfLines={1}
              ellipsizeMode="middle">
              {target.address}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              You hold a {target.shard.threshold}-of-{target.shard.total} piece
              for them. Any {target.shard.threshold} holders can bring them back.
            </Text>
          </Card>

          <Text variant="body" color={theme.colors.textSecondary}>
            Unlock your wallet to contribute your piece. It gets sealed to your
            friend — no one else, not even you, can use it.
          </Text>

          <Field
            label="Your passphrase"
            value={passphrase}
            onChangeText={t => {
              setPassphrase(t);
              if (unlockError !== null) setUnlockError(null);
            }}
            error={unlockError ?? undefined}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            onSubmitEditing={contribute}
            returnKeyType="go"
            suffix={
              <Text
                variant="label"
                color={theme.colors.primary}
                onPress={() => setShowPass(s => !s)}
                accessibilityRole="button"
                accessibilityLabel={showPass ? 'Hide passphrase' : 'Show passphrase'}>
                {showPass ? 'Hide' : 'Show'}
              </Text>
            }
          />

          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={passphrase.length === 0}
            onPress={contribute}>
            Contribute my piece
          </Button>
          <Button variant="ghost" size="md" fullWidth onPress={startScan}>
            Cancel
          </Button>
        </View>
      )}

      {mode === 'response' && responseQr !== null && (
        <View style={[styles.centerCol, {gap: theme.spacing.md}]}>
          <Heading level="headingSmall">Show this to your friend</Heading>
          <Card style={styles.qrCard}>
            <View style={styles.qrFrame}>
              <QRCode
                value={responseQr}
                size={QR_SIZE}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            </View>
          </Card>
          <Text
            variant="body"
            color={theme.colors.textSecondary}
            style={styles.centerText}>
            Have their station scan this. It only works for them — your piece is
            sealed to this one recovery.
          </Text>
          <Button variant="primary" size="lg" fullWidth onPress={() => navigation.goBack()}>
            Done
          </Button>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scanner: {height: 320, overflow: 'hidden'},
  centerCol: {alignItems: 'center'},
  centerText: {textAlign: 'center'},
  qrCard: {padding: 14},
  qrFrame: {backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12},
});
