/**
 * Settings — minimal for now (the full screen is T1.2.8). It carries the entry
 * point into social-recovery setup (T1.2.3) so recovery can be set up after
 * onboarding, and reflects whether a circle already exists by reading the
 * persisted recovery config.
 */
import {useCallback, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Card, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import {loadRecoveryConfig, type RecoveryConfig} from '../../wallet/recoveryConfig';
import type {MainStackParamList} from '../../navigation/types';

export function Settings() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [recovery, setRecovery] = useState<RecoveryConfig | null>(null);

  // Re-read on focus so returning from the recovery flow reflects the new state.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRecoveryConfig()
        .then(config => {
          if (active) setRecovery(config);
        })
        .catch(() => {
          if (active) setRecovery(null);
        });
      return () => {
        active = false;
      };
    }, []),
  );

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
        paddingTop: insets.top + theme.spacing.xl,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <Heading level="headingLarge">Settings</Heading>

      <View style={{gap: theme.spacing.sm}}>
        <Text variant="label" color={theme.colors.textSecondary}>
          Security
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Social recovery"
          onPress={() => navigation.navigate('Recovery', {origin: 'settings'})}>
          <Card style={styles.row}>
            <View style={styles.rowText}>
              <Text variant="label" color={theme.colors.text}>
                Social recovery
              </Text>
              <Text variant="caption" color={theme.colors.textSecondary}>
                {recoverySubtitle}
              </Text>
            </View>
            <Text variant="body" color={theme.colors.textMuted}>
              ›
            </Text>
          </Card>
        </Pressable>
      </View>
    </ScrollView>
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
