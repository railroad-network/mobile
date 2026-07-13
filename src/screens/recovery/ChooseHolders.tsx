/**
 * Choose the recovery circle (T1.2.3, step 1). The owner adds trusted people by
 * scanning their address QR or pasting a `rrn1…` address, with an optional local
 * nickname. Any {@link RECOVERY_THRESHOLD} of them will be able to restore the
 * wallet, so at least that many are required; the circle is capped at
 * {@link MAX_HOLDERS}. Adding exactly the threshold works but is flagged as less
 * resilient (every holder then becomes essential).
 *
 * There is no contacts list yet (that arrives with vouching, M1.4), so holders
 * are entered directly here rather than picked from a roster.
 */
import {useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {Button, Card, Field, Heading, QRScanner, Text} from '../../components';
import {InlineNotice} from './InlineNotice';
import {isValidAddress} from '../../crypto/address';
import {useTheme} from '../../theme';
import type {RecoveryScreenProps} from '../../navigation/types';
import {
  MAX_HOLDERS,
  MIN_HOLDERS,
  RECOMMENDED_HOLDERS,
  useRecovery,
  type ChosenHolder,
} from './RecoveryContext';
import {RecoveryScaffold} from './RecoveryScaffold';

export function ChooseHolders({navigation}: RecoveryScreenProps<'ChooseHolders'>) {
  const theme = useTheme();
  const {wallet, holders, setHolders, threshold} = useRecovery();

  const [address, setAddress] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const atCapacity = holders.length >= MAX_HOLDERS;

  function validate(candidate: string): string | null {
    const value = candidate.trim();
    if (value.length === 0) {
      return 'Enter or scan an address.';
    }
    if (!isValidAddress(value)) {
      return "That doesn't look like a valid address.";
    }
    if (wallet !== null && value === wallet.address) {
      return "You can't be your own recovery holder.";
    }
    if (holders.some(h => h.address === value)) {
      return 'That holder is already in your circle.';
    }
    return null;
  }

  function add(candidate: string, label?: string) {
    const value = candidate.trim();
    const problem = validate(value);
    if (problem !== null) {
      setError(problem);
      return;
    }
    const holder: ChosenHolder = {address: value};
    const name = (label ?? nickname).trim();
    if (name.length > 0) {
      holder.nickname = name;
    }
    setHolders([...holders, holder]);
    setAddress('');
    setNickname('');
    setError(null);
  }

  function remove(target: string) {
    setHolders(holders.filter(h => h.address !== target));
  }

  function onScan(value: string) {
    setScanning(false);
    setAddress(value.trim());
    add(value);
  }

  const canContinue = holders.length >= MIN_HOLDERS && holders.length <= MAX_HOLDERS;

  return (
    <RecoveryScaffold
      title="Choose your circle"
      subtitle={`${holders.length} chosen · any ${threshold} can restore`}
      onBack={() => navigation.goBack()}
      step={0}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={() => navigation.navigate('RecoverySplit')}>
          {holders.length < MIN_HOLDERS
            ? `Add at least ${MIN_HOLDERS}`
            : `Split my key into ${holders.length} pieces`}
        </Button>
      }>
      <View style={{gap: theme.spacing.md, marginTop: theme.spacing.md}}>
        <Text variant="body" color={theme.colors.textSecondary}>
          Pick people you trust and can reach in person. We recommend{' '}
          <Text variant="label" color={theme.colors.text}>
            {RECOMMENDED_HOLDERS}
          </Text>
          , so any {threshold} can bring you back even if some are unreachable.
        </Text>

        {holders.length === threshold && (
          <InlineNotice variant="warning" title="Every holder will be essential">
            With exactly {threshold}, all of them must cooperate to restore you.
            Add one or two more for a safety margin.
          </InlineNotice>
        )}

        {scanning ? (
          <Card padded={false} style={styles.scanner}>
            <QRScanner onScan={onScan} isActive={scanning} />
            <View style={styles.scannerCancel}>
              <Button variant="secondary" size="sm" onPress={() => setScanning(false)}>
                Cancel
              </Button>
            </View>
          </Card>
        ) : (
          <View style={{gap: theme.spacing.sm}}>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              disabled={atCapacity}
              onPress={() => {
                setError(null);
                setScanning(true);
              }}>
              Add by scanning their QR
            </Button>
            <Field
              label="Or paste their address"
              placeholder="rrn1…"
              value={address}
              onChangeText={t => {
                setAddress(t);
                if (error !== null) setError(null);
              }}
              editable={!atCapacity}
              error={error ?? undefined}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            <Field
              label="Nickname (optional)"
              placeholder="e.g. Mom"
              value={nickname}
              onChangeText={setNickname}
              editable={!atCapacity}
              autoCapitalize="words"
            />
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={atCapacity || address.trim().length === 0}
              onPress={() => add(address)}>
              {atCapacity ? `Circle is full (${MAX_HOLDERS})` : 'Add holder'}
            </Button>
          </View>
        )}

        {holders.length > 0 && (
          <View style={{marginTop: theme.spacing.sm}}>
            <Heading level="headingSmall" style={{marginBottom: theme.spacing.sm}}>
              Your circle
            </Heading>
            <View style={{gap: theme.spacing.sm}}>
              {holders.map(h => (
                <Card key={h.address} style={styles.holderRow}>
                  <View style={styles.holderText}>
                    {h.nickname !== undefined && (
                      <Text variant="label" color={theme.colors.text}>
                        {h.nickname}
                      </Text>
                    )}
                    <Text
                      variant="caption"
                      color={theme.colors.textSecondary}
                      numberOfLines={1}
                      ellipsizeMode="middle">
                      {h.address}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => remove(h.address)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${h.nickname ?? h.address}`}
                    hitSlop={10}>
                    <Text variant="label" color={theme.colors.danger}>
                      Remove
                    </Text>
                  </Pressable>
                </Card>
              ))}
            </View>
          </View>
        )}
      </View>
    </RecoveryScaffold>
  );
}

const styles = StyleSheet.create({
  scanner: {height: 320, overflow: 'hidden'},
  scannerCancel: {position: 'absolute', bottom: 12, alignSelf: 'center'},
  holderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  holderText: {flex: 1, minWidth: 0, gap: 2},
});
