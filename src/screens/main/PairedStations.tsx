/**
 * The stations this device is paired with, and unpairing them (T1.3.3).
 *
 * Reached from Settings → Connection. Lists what {@link pairedStation} has
 * persisted and lets the user forget a station. Unpairing here is only the
 * mobile's half: it removes this device's record so the app stops trusting and
 * talking to that station. The operator revokes independently on the station
 * (`station unpair`), so this screen says so rather than implying the station is
 * told — under ADR-0008 either side can drop the pairing on its own.
 *
 * A station is shown by its captured label and host, but identified by its
 * address — the only trusted field — so removal always targets the address.
 */
import {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Banner, Button, Card, Heading, Text} from '../../components';
import {shortAddress} from '../../ledger';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import {
  loadPairedStations,
  removePairedStation,
  type PairedStation,
} from '../../network/pairedStation';

export function PairedStations({navigation}: MainStackScreenProps<'PairedStations'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [stations, setStations] = useState<PairedStation[] | null>(null);
  // The address whose row is showing its "remove this pairing?" confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStations(await loadPairedStations());
    } catch {
      setStations([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadPairedStations()
        .then(s => active && setStations(s))
        .catch(() => active && setStations([]));
      return () => {
        active = false;
      };
    }, []),
  );

  async function unpair(address: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await removePairedStation(address);
      setConfirming(null);
      await reload();
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
        <Heading level="headingLarge">Paired stations</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Stations that recognise this phone. Pairing is what lets you send and
          receive through a station.
        </Text>
      </View>

      {stations !== null && stations.length === 0 ? (
        <Banner variant="info" title="Not paired yet">
          You haven’t paired with a station. Find one on your network to start
          sending and receiving.
        </Banner>
      ) : null}

      {stations !== null && stations.length > 0 ? (
        <View style={{gap: theme.spacing.sm}}>
          {stations.map(station => (
            <StationRow
              key={station.address}
              theme={theme}
              station={station}
              confirming={confirming === station.address}
              busy={busy}
              onAskRemove={() => setConfirming(station.address)}
              onCancelRemove={() => setConfirming(null)}
              onConfirmRemove={() => unpair(station.address)}
            />
          ))}
        </View>
      ) : null}

      <Button
        variant={stations !== null && stations.length > 0 ? 'secondary' : 'primary'}
        size="lg"
        fullWidth
        onPress={() => navigation.navigate('Discovery')}>
        {stations !== null && stations.length > 0
          ? 'Pair with another station'
          : 'Find a station'}
      </Button>
    </ScrollView>
  );
}

function StationRow({
  theme,
  station,
  confirming,
  busy,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  theme: Theme;
  station: PairedStation;
  confirming: boolean;
  busy: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const title =
    station.name !== undefined && station.name.length > 0
      ? station.name
      : shortAddress(station.address);

  return (
    <Card style={{gap: theme.spacing.sm}}>
      <View style={styles.rowText}>
        <Text variant="label" color={theme.colors.text} numberOfLines={1}>
          {title}
        </Text>
        <Text
          variant="caption"
          color={theme.colors.textSecondary}
          numberOfLines={1}
          ellipsizeMode="middle">
          {station.host}:{station.port}
        </Text>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          ellipsizeMode="middle">
          {station.address}
        </Text>
      </View>

      {confirming ? (
        <View style={{gap: theme.spacing.xs}}>
          <Text variant="caption" color={theme.colors.textSecondary}>
            Forget this station? Your phone will stop trusting it. The station’s
            operator removes it on their side separately.
          </Text>
          <View style={styles.confirmButtons}>
            <Button
              variant="ghost"
              size="md"
              disabled={busy}
              onPress={onCancelRemove}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={busy}
              onPress={onConfirmRemove}>
              Unpair
            </Button>
          </View>
        </View>
      ) : (
        <Button variant="danger" size="md" fullWidth onPress={onAskRemove}>
          Unpair
        </Button>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  rowText: {minWidth: 0, gap: 2},
  confirmButtons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
});
