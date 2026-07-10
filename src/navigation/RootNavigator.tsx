import {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';

import {useTheme} from '../theme';
import {hasWallet} from '../wallet/Wallet';
import {Welcome} from '../screens/onboarding/Welcome';
import {Home} from '../screens/main/Home';
import {Send} from '../screens/main/Send';
import {History} from '../screens/main/History';
import {Settings} from '../screens/main/Settings';
import type {MainTabParamList, OnboardingStackParamList, RootStackParamList} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

function OnboardingNavigator() {
  return (
    <OnboardingStack.Navigator screenOptions={{headerShown: false}}>
      <OnboardingStack.Screen name="Welcome" component={Welcome} />
    </OnboardingStack.Navigator>
  );
}

/** Bottom-tab main nav: Home / Send / History / Settings (T1.2.1's confirmed 4-tab scope). */
function MainNavigator() {
  const theme = useTheme();

  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceRaised,
          borderTopColor: theme.colors.border,
        },
      }}>
      <MainTab.Screen name="Home" component={Home} />
      <MainTab.Screen name="Send" component={Send} />
      <MainTab.Screen name="History" component={History} />
      <MainTab.Screen name="Settings" component={Settings} />
    </MainTab.Navigator>
  );
}

/**
 * Top-level routing: `OnboardingStack` when no wallet has been created on
 * this device yet, `MainStack` once one exists. The check runs once on
 * mount; a failure (e.g. no native SecureStore module, as under Jest)
 * falls back to onboarding rather than crashing the app shell.
 */
export function RootNavigator() {
  const theme = useTheme();
  const [walletExists, setWalletExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasWallet()
      .then(exists => {
        if (!cancelled) {
          setWalletExists(exists);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWalletExists(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (walletExists === null) {
    return <View style={[styles.fill, {backgroundColor: theme.colors.bg}]} />;
  }

  return (
    <RootStack.Navigator screenOptions={{headerShown: false}}>
      {walletExists ? (
        <RootStack.Screen name="Main" component={MainNavigator} />
      ) : (
        <RootStack.Screen name="Onboarding" component={OnboardingNavigator} />
      )}
    </RootStack.Navigator>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
