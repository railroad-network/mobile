import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {Station} from '../network/Discovery';

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
 * over them (social-recovery setup from Settings, transaction detail).
 */
export type MainStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  Recovery: {origin: RecoveryOrigin};
  /** Shards this device holds for other people (T1.2.3 holder-receive). */
  HeldShards: undefined;
  /** A single transaction's detail (T1.2.4 opens it; T1.2.7 expands it). */
  TransactionDetail: {id: string};
  /** Confirm/reject an incoming payment proposal (T1.2.6), by proposal id. */
  ConfirmReceived: {id: string};
  /** Receive/request: the member's address as a QR (Home's "Request" action). */
  Receive: undefined;
  /** Change the wallet passphrase (T1.2.8). */
  ChangePassphrase: undefined;
  /** Export the sealed wallet bytes to move to another device (T1.2.8). */
  ExportWallet: undefined;
  /** Factory reset, confirmed by typing the given nickname (T1.2.8). */
  FactoryReset: {nickname: string};
  /** Find a station on the local network to pair with (T1.3.2). */
  Discovery: undefined;
  /** The stations this device is paired with, and unpairing them (T1.3.3). */
  PairedStations: undefined;
  /** Local notification + background-sync preferences (T1.3.6). */
  NotificationSettings: undefined;
  /**
   * Pair with a station, discovered or hand-typed (T1.3.3).
   *
   * Takes the whole {@link Station} rather than an id because nothing has been
   * stored yet — pairing is what decides a station is worth remembering.
   */
  Pairing: {station: Station};
};

/** Props for a screen in the main stack. */
export type MainStackScreenProps<T extends keyof MainStackParamList> =
  NativeStackScreenProps<MainStackParamList, T>;

/**
 * Props for a bottom-tab screen. Composite so a tab (e.g. Home) can also address
 * routes on the parent main stack — pushing `TransactionDetail`, or jumping to
 * another tab.
 */
export type MainTabScreenProps<T extends keyof MainTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    NativeStackScreenProps<MainStackParamList>
  >;

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  /** Shown when a wallet exists but is locked this session (T1.3.4). */
  Lock: undefined;
  Main: NavigatorScreenParams<MainStackParamList>;
};
