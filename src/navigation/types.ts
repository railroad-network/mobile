import type {NavigatorScreenParams} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

/** Where the social-recovery flow was entered from — decides how it exits. */
export type RecoveryOrigin = 'onboarding' | 'settings';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Passphrase: undefined;
  BiometricSetup: undefined;
  GenerateWallet: undefined;
  WalletReady: undefined;
  Recovery: {origin: RecoveryOrigin};
};

/** Props for a screen in the onboarding stack. */
export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;

/** The social-recovery setup stack (nested; launched from onboarding or Settings). */
export type RecoveryStackParamList = {
  RecoveryUnlock: undefined;
  RecoveryIntro: undefined;
  ChooseHolders: undefined;
  RecoverySplit: undefined;
  DistributeShards: undefined;
  RecoveryComplete: undefined;
};

/** Props for a screen in the recovery stack. */
export type RecoveryScreenProps<T extends keyof RecoveryStackParamList> =
  NativeStackScreenProps<RecoveryStackParamList, T>;

export type MainTabParamList = {
  Home: undefined;
  Send: undefined;
  History: undefined;
  Settings: undefined;
};

/**
 * The main app's native stack: the bottom tabs, plus full-screen flows pushed
 * over them (social-recovery setup from Settings).
 */
export type MainStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  Recovery: {origin: RecoveryOrigin};
  /** Shards this device holds for other people (T1.2.3 holder-receive). */
  HeldShards: undefined;
};

/** Props for a screen in the main stack. */
export type MainStackScreenProps<T extends keyof MainStackParamList> =
  NativeStackScreenProps<MainStackParamList, T>;

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainStackParamList>;
};
