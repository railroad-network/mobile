import {StyleSheet, View} from 'react-native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';

import {useTheme} from '../theme';
import {useWalletSession} from '../wallet/WalletSession';
import {OnboardingProvider} from '../screens/onboarding/OnboardingContext';
import {Welcome} from '../screens/onboarding/Welcome';
import {Passphrase} from '../screens/onboarding/Passphrase';
import {BiometricSetup} from '../screens/onboarding/BiometricSetup';
import {GenerateWallet} from '../screens/onboarding/GenerateWallet';
import {WalletReady} from '../screens/onboarding/WalletReady';
import {Home} from '../screens/main/Home';
import {Send} from '../screens/main/Send';
import {History} from '../screens/main/History';
import {Settings} from '../screens/main/Settings';
import {HeldShards} from '../screens/main/HeldShards';
import {TransactionDetail} from '../screens/main/TransactionDetail';
import {ConfirmReceived} from '../screens/main/ConfirmReceived';
import {Receive} from '../screens/main/Receive';
import {ChangePassphrase} from '../screens/main/ChangePassphrase';
import {ExportWallet} from '../screens/main/ExportWallet';
import {FactoryReset} from '../screens/main/FactoryReset';
import {Discovery} from '../screens/main/Discovery';
import {Pairing} from '../screens/main/Pairing';
import {PairedStations} from '../screens/main/PairedStations';
import {Lock} from '../screens/main/Lock';
import {RecoveryNavigator} from '../screens/recovery/RecoveryNavigator';
import {
  HomeTabIcon,
  SendTabIcon,
  HistoryTabIcon,
  SettingsTabIcon,
} from '../components/icons/TabIcons';
import type {
  MainStackParamList,
  MainTabParamList,
  OnboardingStackParamList,
  RootStackParamList,
} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

/**
 * The create-wallet flow (T1.2.2). Wrapped in `OnboardingProvider` so the
 * screens can share transient state (passphrase, biometric choice, the new
 * address) without routing it through navigation params.
 */
function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <OnboardingStack.Navigator screenOptions={{headerShown: false}}>
        <OnboardingStack.Screen name="Welcome" component={Welcome} />
        <OnboardingStack.Screen name="Passphrase" component={Passphrase} />
        <OnboardingStack.Screen name="BiometricSetup" component={BiometricSetup} />
        <OnboardingStack.Screen
          name="GenerateWallet"
          component={GenerateWallet}
          options={{gestureEnabled: false}}
        />
        <OnboardingStack.Screen
          name="WalletReady"
          component={WalletReady}
          options={{gestureEnabled: false}}
        />
        <OnboardingStack.Screen
          name="Recovery"
          component={RecoveryNavigator}
          options={{gestureEnabled: false}}
        />
      </OnboardingStack.Navigator>
    </OnboardingProvider>
  );
}

/** Bottom-tab main nav: Home / Send / History / Settings (T1.2.1's confirmed 4-tab scope). */
function MainTabs() {
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
      <MainTab.Screen
        name="Home"
        component={Home}
        options={{tabBarIcon: HomeTabIcon}}
      />
      <MainTab.Screen
        name="Send"
        component={Send}
        options={{tabBarIcon: SendTabIcon}}
      />
      <MainTab.Screen
        name="History"
        component={History}
        options={{tabBarIcon: HistoryTabIcon}}
      />
      <MainTab.Screen
        name="Settings"
        component={Settings}
        options={{tabBarIcon: SettingsTabIcon}}
      />
    </MainTab.Navigator>
  );
}

/**
 * The main app stack: the bottom tabs, with full-screen flows pushed over them.
 * Social-recovery setup (from Settings) lives here so it can cover the tab bar.
 */
function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{headerShown: false}}>
      <MainStack.Screen name="Tabs" component={MainTabs} />
      <MainStack.Screen name="Recovery" component={RecoveryNavigator} />
      <MainStack.Screen name="HeldShards" component={HeldShards} />
      <MainStack.Screen name="TransactionDetail" component={TransactionDetail} />
      <MainStack.Screen name="ConfirmReceived" component={ConfirmReceived} />
      <MainStack.Screen name="Receive" component={Receive} />
      <MainStack.Screen name="ChangePassphrase" component={ChangePassphrase} />
      <MainStack.Screen name="ExportWallet" component={ExportWallet} />
      <MainStack.Screen name="FactoryReset" component={FactoryReset} />
      <MainStack.Screen name="Discovery" component={Discovery} />
      <MainStack.Screen name="Pairing" component={Pairing} />
      <MainStack.Screen name="PairedStations" component={PairedStations} />
    </MainStack.Navigator>
  );
}

/**
 * Top-level routing, driven by {@link useWalletSession}:
 *   - no wallet on this device → onboarding;
 *   - a wallet exists but is not unlocked this session → the lock screen (the
 *     authenticated channel signs every request, so the app unlocks once and
 *     holds the wallet for the foreground session, per T1.3.4);
 *   - a wallet exists and is unlocked → the main app.
 *
 * A `null` existence flag (initial check in flight, or no native SecureStore as
 * under Jest) shows a blank canvas. Onboarding adopts the wallet it creates, so
 * a brand-new user lands unlocked in the main app without a lock-screen detour.
 */
export function RootNavigator() {
  const theme = useTheme();
  const {hasWallet: walletExists, wallet} = useWalletSession();

  if (walletExists === null) {
    return <View style={[styles.fill, {backgroundColor: theme.colors.bg}]} />;
  }

  return (
    <RootStack.Navigator screenOptions={{headerShown: false}}>
      {!walletExists ? (
        <RootStack.Screen name="Onboarding" component={OnboardingNavigator} />
      ) : wallet === null ? (
        <RootStack.Screen name="Lock" component={Lock} />
      ) : (
        <RootStack.Screen name="Main" component={MainNavigator} />
      )}
    </RootStack.Navigator>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
