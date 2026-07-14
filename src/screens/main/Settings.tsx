/**
 * Settings (T1.2.8) — account management: identity, security, connection,
 * display, advanced, and about. The theme choice and biometric toggle take
 * effect immediately; changing the passphrase, exporting the wallet, and factory
 * reset are their own passphrase/confirm screens. Recovery + held-shards entry
 * points (T1.2.3) live under Security.
 *
 * Identity (address, community) is read from the ledger identity hook (mocked in
 * M1.2, real in M1.3); the nickname is editable here and persisted locally, and
 * the edit is reflected app-wide via the ledger identity query. Connection /
 * station pairing is a placeholder until the transport layer lands (M1.3).
 */
import {useCallback, useState} from 'react';
import {Linking, Pressable, ScrollView, StyleSheet, Switch, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useQueryClient} from '@tanstack/react-query';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Button, Card, Field, Heading, Identicon, StarMark, Text} from '../../components';
import {ledgerKeys, shortAddress, useIdentity} from '../../ledger';
import {loadHeldShards} from '../../wallet/heldShards';
import {loadProfile, saveProfile} from '../../wallet/profile';
import {loadRecoveryConfig, type RecoveryConfig} from '../../wallet/recoveryConfig';
import {setBiometricUnlock} from '../../wallet/Wallet';
import {useTheme, useThemeMode, type Theme, type ThemeMode} from '../../theme';
import type {MainStackParamList} from '../../navigation/types';

const APP_VERSION = '0.0.1';
const STATION_COMPAT = 'Station 0.9 (Phase 1)';
const REPO_URL = 'https://github.com/railroad-network/mobile';

const THEME_OPTIONS: {mode: ThemeMode; label: string}[] = [
  {mode: 'light', label: 'Light'},
  {mode: 'dark', label: 'Dark'},
  {mode: 'system', label: 'System'},
];

export function Settings() {
  const theme = useTheme();
  const {mode, setMode} = useThemeMode();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const {data: identity} = useIdentity();

  const [recovery, setRecovery] = useState<RecoveryConfig | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const [biometric, setBiometric] = useState(true);
  const [nickname, setNickname] = useState('');
  const [savedNickname, setSavedNickname] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRecoveryConfig()
        .then(c => active && setRecovery(c))
        .catch(() => active && setRecovery(null));
      loadHeldShards()
        .then(m => active && setHeldCount(Object.keys(m).length))
        .catch(() => active && setHeldCount(0));
      loadProfile()
        .then(p => {
          if (!active) return;
          setBiometric(p.biometricEnabled ?? true);
          const nick = p.nickname ?? '';
          setNickname(nick);
          setSavedNickname(nick);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );

  const address = identity?.address ?? '';
  const displayName = nickname.length > 0 ? nickname : identity?.nickname ?? shortAddress(address);

  async function saveNickname() {
    const next = nickname.trim();
    await saveProfile({nickname: next});
    setSavedNickname(next);
    // Reflect the new name on Home and elsewhere.
    await queryClient.invalidateQueries({queryKey: ledgerKeys.identity});
  }

  async function toggleBiometric(next: boolean) {
    // Optimistic; revert if the keychain re-store fails (e.g. cancelled prompt).
    setBiometric(next);
    try {
      await setBiometricUnlock(next);
    } catch {
      setBiometric(!next);
    }
  }

  const recoverySubtitle =
    recovery === null
      ? 'Not set up — protect access if you lose this phone'
      : `${recovery.threshold}-of-${recovery.total} circle · ${
          recovery.holders.filter(h => h.delivered).length
        } delivered`;

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <Heading level="headingLarge">Settings</Heading>

      {/* Identity card → address QR + copy */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your address"
        onPress={() => navigation.navigate('Receive')}>
        <Card style={styles.idCard}>
          <Identicon seed={address || displayName} size={48} />
          <View style={styles.idText}>
            <Text variant="mono" color={theme.colors.text} numberOfLines={1} style={styles.idName}>
              {displayName}
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>
              {identity?.community ?? 'Show address · QR · copy'}
            </Text>
          </View>
          <Text variant="body" color={theme.colors.textMuted}>
            ›
          </Text>
        </Card>
      </Pressable>

      <Group theme={theme} label="Identity">
        <View style={styles.nickRow}>
          <Field
            label="Local nickname"
            value={nickname}
            onChangeText={setNickname}
            placeholder="Add a nickname"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.nickField}
          />
          {nickname.trim() !== savedNickname && (
            <Button variant="secondary" size="md" onPress={saveNickname}>
              Save
            </Button>
          )}
        </View>
      </Group>

      <Group theme={theme} label="Security">
        <NavRow theme={theme} title="Change passphrase" onPress={() => navigation.navigate('ChangePassphrase')} />
        <View style={styles.toggleRow}>
          <Text variant="label" color={theme.colors.text}>
            Unlock with biometrics
          </Text>
          <Switch
            value={biometric}
            onValueChange={toggleBiometric}
            trackColor={{true: theme.colors.primary, false: theme.colors.borderStrong}}
            accessibilityLabel="Unlock with biometrics"
          />
        </View>
        <NavRow
          theme={theme}
          title="Social recovery"
          subtitle={recoverySubtitle}
          right={
            recovery !== null ? (
              <Badge variant="success" size="sm" dot>
                Ready
              </Badge>
            ) : undefined
          }
          onPress={() => navigation.navigate('Recovery', {origin: 'settings'})}
        />
        <NavRow
          theme={theme}
          title="Shards you hold"
          subtitle={heldCount === 0 ? 'Recovery pieces friends entrust to you' : `Holding ${heldCount}`}
          onPress={() => navigation.navigate('HeldShards')}
        />
      </Group>

      <Group theme={theme} label="Connection">
        <NavRow
          theme={theme}
          title="Station pairing"
          subtitle="Not paired — pairing arrives with the station link (M1.3)"
        />
      </Group>

      <Group theme={theme} label="Display">
        <View style={styles.toggleRow}>
          <Text variant="label" color={theme.colors.text}>
            Theme
          </Text>
          <View style={[styles.segment, {backgroundColor: theme.colors.surfaceSunken}]}>
            {THEME_OPTIONS.map(o => {
              const on = mode === o.mode;
              return (
                <Pressable
                  key={o.mode}
                  onPress={() => setMode(o.mode)}
                  accessibilityRole="button"
                  accessibilityLabel={`Theme: ${o.label}`}
                  accessibilityState={{selected: on}}
                  style={[styles.segmentBtn, on && {backgroundColor: theme.colors.surfaceRaised}]}>
                  <Text variant="label" color={on ? theme.colors.text : theme.colors.textSecondary}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.toggleRow}>
          <Text variant="label" color={theme.colors.text}>
            Language
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            English
          </Text>
        </View>
      </Group>

      <Group theme={theme} label="Advanced">
        <NavRow theme={theme} title="Export wallet" onPress={() => navigation.navigate('ExportWallet')} />
        <NavRow
          theme={theme}
          title="Factory reset"
          subtitle="Erase this wallet from the device"
          danger
          onPress={() => navigation.navigate('FactoryReset', {nickname: displayName})}
        />
      </Group>

      <View style={styles.about}>
        <StarMark size={26} color={theme.colors.textMuted} />
        <Text variant="caption" color={theme.colors.textMuted} style={styles.aboutLine}>
          Railroad Network {APP_VERSION} · {STATION_COMPAT}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.aboutLine}>
          Your keys never leave this phone.
        </Text>
        <Text
          variant="label"
          color={theme.colors.textLink}
          onPress={() => Linking.openURL(REPO_URL)}
          accessibilityRole="link"
          accessibilityLabel="Source code">
          Source code
        </Text>
      </View>
    </ScrollView>
  );
}

/** A titled group: a section label above a card of rows. */
function Group({theme, label, children}: {theme: Theme; label: string; children: React.ReactNode}) {
  return (
    <View style={styles.group}>
      <Text variant="label" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <Card padded={false} style={styles.groupCard}>
        {children}
      </Card>
    </View>
  );
}

/** A tappable row inside a {@link Group}: title, optional subtitle, optional right node. */
function NavRow({
  theme,
  title,
  subtitle,
  right,
  danger = false,
  onPress,
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  danger?: boolean;
  onPress?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={onPress === undefined}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.navRow,
        {backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent'},
      ]}>
      <View style={styles.navRowText}>
        <Text variant="label" color={danger ? theme.colors.danger : theme.colors.text}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text variant="caption" color={theme.colors.textSecondary}>
            {subtitle}
          </Text>
        )}
      </View>
      {right ?? (onPress !== undefined ? <Text variant="body" color={theme.colors.textMuted}>›</Text> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  idCard: {flexDirection: 'row', alignItems: 'center', gap: 14},
  idText: {flex: 1, minWidth: 0, gap: 2},
  idName: {fontWeight: '600', fontSize: 16},
  group: {gap: 8},
  groupCard: {overflow: 'hidden'},
  nickRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 14},
  nickField: {flex: 1},
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  segment: {flexDirection: 'row', gap: 4, padding: 4, borderRadius: 10},
  segmentBtn: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7},
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  navRowText: {flex: 1, minWidth: 0, gap: 2},
  about: {alignItems: 'center', gap: 6, paddingTop: 8},
  aboutLine: {textAlign: 'center'},
});
