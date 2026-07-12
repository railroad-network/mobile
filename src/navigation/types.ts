import type {NavigatorScreenParams} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Passphrase: undefined;
  BiometricSetup: undefined;
  GenerateWallet: undefined;
  WalletReady: undefined;
};

/** Props for a screen in the onboarding stack. */
export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;

export type MainTabParamList = {
  Home: undefined;
  Send: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};
