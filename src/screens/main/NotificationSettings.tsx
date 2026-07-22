/**
 * Notification preferences (T1.3.6).
 *
 * Reached from Settings → Notifications. Three parts:
 *   - a master switch that gates all local notifications (and requests OS
 *     permission the first time it is turned on);
 *   - per-kind switches for the events that have a live source in M1.3;
 *   - the opt-in Background sync switch, which provisions a background signing
 *     credential (see {@link network/backgroundCredential}) so events can be
 *     drained and notified while the app is closed. Its copy states the
 *     trade-off; it needs the unlocked wallet, so it is disabled when locked.
 *
 * Preferences persist through {@link notifications/notificationPrefs}; the OS
 * notification backend is reached only through the {@link Notifications} seam.
 */
import {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, Switch, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Banner, Card, Heading, Text} from '../../components';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import type {StationEventKind} from '../../network/StationClient';
import {getNotifier} from '../../notifications/Notifications';
import {
  DEFAULT_PREFS,
  NOTIFIABLE_KINDS,
  getPrefs,
  kindEnabled,
  setBackgroundSyncEnabled,
  setKindEnabled,
  setNotificationsEnabled,
  type NotificationPrefs,
} from '../../notifications/notificationPrefs';
import {
  clearBackgroundCredential,
  provisionBackgroundCredential,
} from '../../network/backgroundCredential';
import {requestBatteryExemption} from '../../notifications/batteryOptimization';
import {useWalletSession} from '../../wallet/WalletSession';

/** Friendly row labels for each notifiable kind. */
const KIND_LABEL: Record<string, string> = {
  proposal_received: 'Incoming payments',
  confirmation_received: 'Payments confirmed',
  settlement: 'Payments settled',
  cancellation: 'Payments cancelled',
  vouch_received: 'Someone vouches for you',
};

export function NotificationSettings({navigation}: MainStackScreenProps<'NotificationSettings'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {wallet} = useWalletSession();

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getPrefs()
        .then(p => active && setPrefs(p))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );

  async function toggleMaster(next: boolean) {
    if (next) {
      // Ask the OS the first time notifications are switched on; a denial still
      // records the intent so re-enabling in OS settings just works.
      await getNotifier()?.requestPermission();
    }
    setPrefs(await setNotificationsEnabled(next));
  }

  async function toggleKind(kind: StationEventKind, next: boolean) {
    setPrefs(await setKindEnabled(kind, next));
  }

  async function toggleBackgroundSync(next: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (next) {
        if (wallet === null) {
          return; // Guarded in UI, but never provision without an unlocked wallet.
        }
        // Provision + persist BEFORE requesting permission. The OS permission
        // dialog backgrounds the app, which drops the in-memory wallet
        // (WalletSession locks on background) and unmounts this screen — so all
        // the wallet-dependent work must finish first, or an interrupted prompt
        // could enable background sync with no credential to sign with.
        await provisionBackgroundCredential(wallet);
        setPrefs(await setBackgroundSyncEnabled(true));
        await getNotifier()?.requestPermission();
        // Ask to lift battery optimization: without it, aggressive OEM builds
        // block the background task's network to the station, so the sync
        // silently never delivers. Shows the system dialog only when not already
        // exempt; a decline just means background delivery is best-effort.
        await requestBatteryExemption();
      } else {
        await clearBackgroundCredential();
        setPrefs(await setBackgroundSyncEnabled(false));
      }
    } catch {
      // Leave the stored value as-is; the switch reflects `prefs` so it snaps back.
    } finally {
      setBusy(false);
    }
  }

  const contentPad = {
    paddingTop: insets.top + theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    gap: theme.spacing.lg,
  };

  return (
    <ScrollView style={{backgroundColor: theme.colors.bg}} contentContainerStyle={contentPad}>
      <View style={{gap: theme.spacing.xs}}>
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
        <Heading level="headingLarge">Notifications</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Get a heads-up when something happens on your ledger — a payment coming
          in, a settlement clearing.
        </Text>
      </View>

      <Group theme={theme} label="Allow">
        <ToggleRow
          theme={theme}
          label="Local notifications"
          value={prefs.notificationsEnabled}
          onValueChange={toggleMaster}
        />
      </Group>

      <Group theme={theme} label="Notify me about">
        {NOTIFIABLE_KINDS.map(kind => (
          <ToggleRow
            key={kind}
            theme={theme}
            label={KIND_LABEL[kind] ?? kind}
            value={kindEnabled(prefs, kind)}
            disabled={!prefs.notificationsEnabled}
            onValueChange={next => toggleKind(kind, next)}
          />
        ))}
      </Group>

      <View style={{gap: theme.spacing.sm}}>
        <Group theme={theme} label="Background sync">
          <ToggleRow
            theme={theme}
            label="Sync while the app is closed"
            value={prefs.backgroundSyncEnabled}
            disabled={busy || wallet === null}
            onValueChange={toggleBackgroundSync}
          />
        </Group>
        {wallet === null ? (
          <Banner variant="info" title="Unlock to change this">
            Turning background sync on needs your wallet unlocked.
          </Banner>
        ) : (
          <Text variant="caption" color={theme.colors.textSecondary}>
            To fetch events while closed, your phone keeps a background copy of
            your signing key in this device’s secure storage, usable only while
            the phone is unlocked. Leave this off if you’d rather your key stay in
            memory only.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

/** A titled group: a section label above a card of rows (mirrors Settings). */
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

/** A label + Switch row. */
function ToggleRow({
  theme,
  label,
  value,
  disabled = false,
  onValueChange,
}: {
  theme: Theme;
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.disabled]}>
      <Text variant="label" color={theme.colors.text}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{true: theme.colors.primary, false: theme.colors.borderStrong}}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {gap: 8},
  groupCard: {overflow: 'hidden'},
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  disabled: {opacity: 0.5},
});
