/**
 * Find a station on the local network (T1.3.2).
 *
 * Lists what mDNS turns up and hands the chosen station to pairing. Nothing on
 * this screen is trusted: a station's name and claimed address come from TXT
 * records anything on the LAN could publish, so this is a convenience — it
 * saves typing a hostname, and that is all. Pairing (T1.3.3) is the step that
 * proves a station is what it says.
 *
 * That is also why manual entry is a peer of the list rather than a buried
 * fallback: a hand-typed station is worth exactly as much as a discovered one.
 * It matters more than it looks, because discovery fails in ways this screen
 * cannot see — on iOS a denied local-network permission and an empty network
 * are indistinguishable, both just silence.
 */
import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Badge, Button, Card, Field, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';
import {
  DEFAULT_STATION_PORT,
  parseManualStation,
  type ManualEntryError,
  type Station,
} from '../../network/Discovery';
import {useDiscovery} from '../../network/useDiscovery';
import {InlineNotice} from '../recovery/InlineNotice';

const MANUAL_ERROR_TEXT: Record<ManualEntryError, string> = {
  'host-empty': 'Enter the station’s address.',
  'host-invalid':
    'That doesn’t look like a hostname — try something like station.local or 192.168.1.10.',
  'port-invalid': 'A port is a number between 1 and 65535.',
};

export function Discovery({navigation}: MainStackScreenProps<'Discovery'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {state, restart} = useDiscovery();

  const [manualOpen, setManualOpen] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_STATION_PORT));
  const [manualError, setManualError] = useState<ManualEntryError | null>(null);

  function pair(station: Station) {
    navigation.navigate('Pairing', {station});
  }

  function submitManual() {
    const result = parseManualStation(host, port);
    if (!result.ok) {
      setManualError(result.error);
      return;
    }
    setManualError(null);
    pair(result.station);
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
        <Heading level="headingLarge">Find a station</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          Stations on your network announce themselves. Pick yours to pair with
          it — you’ll confirm it’s the right one in the next step.
        </Text>
      </View>

      {state.status === 'error' ? (
        <View style={{gap: theme.spacing.sm}}>
          <InlineNotice variant="warning" title="Couldn’t search the network">
            {state.error ?? 'Something went wrong looking for stations.'}
          </InlineNotice>
          <Button variant="secondary" size="md" fullWidth onPress={restart}>
            Try again
          </Button>
        </View>
      ) : null}

      {state.stations.length > 0 ? (
        <View style={{gap: theme.spacing.sm}}>
          <Heading level="headingSmall">
            {state.stations.length === 1
              ? '1 station found'
              : `${state.stations.length} stations found`}
          </Heading>
          {state.stations.map(station => (
            <StationRow
              key={station.name}
              station={station}
              onPress={() => pair(station)}
            />
          ))}
        </View>
      ) : null}

      {state.status === 'searching' ? (
        <Text variant="body" color={theme.colors.textSecondary}>
          Looking for stations…
        </Text>
      ) : null}

      {state.status === 'empty' ? (
        // Deliberately not "you denied permission" and not "there is no
        // station" — on iOS we genuinely cannot tell which, so claiming either
        // would be a guess dressed up as a fact. Give both readings and a way
        // past.
        <InlineNotice variant="info" title="No stations yet">
          Make sure you’re on the same Wi-Fi as the station and that it’s
          switched on. If the app was never allowed to find devices on your
          local network, searching won’t turn anything up — you can check that
          in Settings, or add the station by address below.
        </InlineNotice>
      ) : null}

      <View style={{gap: theme.spacing.sm}}>
        {manualOpen ? (
          <Card style={{gap: theme.spacing.sm}}>
            <Heading level="headingSmall">Add by address</Heading>
            <Field
              label="Address"
              placeholder="station.local"
              value={host}
              onChangeText={text => {
                setHost(text);
                setManualError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              error={
                manualError !== null && manualError !== 'port-invalid'
                  ? MANUAL_ERROR_TEXT[manualError]
                  : undefined
              }
            />
            <Field
              label="Port"
              value={port}
              onChangeText={text => {
                setPort(text);
                setManualError(null);
              }}
              keyboardType="number-pad"
              hint={`Stations use ${DEFAULT_STATION_PORT} unless the operator changed it.`}
              error={
                manualError === 'port-invalid'
                  ? MANUAL_ERROR_TEXT[manualError]
                  : undefined
              }
            />
            <Button variant="accent" size="md" fullWidth onPress={submitManual}>
              Continue
            </Button>
          </Card>
        ) : (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => setManualOpen(true)}>
            Add by address
          </Button>
        )}
      </View>
    </ScrollView>
  );
}

function StationRow({
  station,
  onPress,
}: {
  station: Station;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pair with ${station.name}`}>
      <Card style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="label" color={theme.colors.text} numberOfLines={1}>
            {station.name}
          </Text>
          <Text
            variant="caption"
            color={theme.colors.textSecondary}
            numberOfLines={1}
            ellipsizeMode="middle">
            {station.host}:{station.port}
          </Text>
          {station.address !== undefined ? (
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              ellipsizeMode="middle">
              {station.address}
            </Text>
          ) : null}
        </View>
        {station.version !== undefined ? (
          <Badge variant="neutral">{`v${station.version}`}</Badge>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {flex: 1, minWidth: 0, gap: 2},
});
