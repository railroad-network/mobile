import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {Station} from '../network/Discovery';
import type {StationVouchListRow} from '../network/StationClient';

/** Where the social-recovery flow was entered from — decides how it exits. */
export type RecoveryOrigin = 'onboarding' | 'settings';

/**
 * Where the join-a-community flow (discover + pair) was entered from — decides
 * how its final step exits. From `onboarding` (WalletReady) it enters the app by
 * adopting the just-unlocked wallet; from `settings` it returns to the tabs.
 */
export type JoinOrigin = 'onboarding' | 'settings';

/** Which side of the vouching browser a row belongs to (T1.4.5). */
export type VouchDirection = 'given' | 'received';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Passphrase: undefined;
  BiometricSetup: undefined;
  GenerateWallet: undefined;
  WalletReady: undefined;
  Recovery: {origin: RecoveryOrigin};
  /** Join a community: discover + pair with its station, then enter the app. */
  Join: {origin: JoinOrigin};
};

/** Props for a screen in the onboarding stack. */
export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;

/**
 * The join-a-community stack (nested; launched from onboarding's WalletReady or
 * from Settings). `Find` discovers a station on the LAN; `Pair` runs the
 * in-person handshake. The `origin` rides through both so the final step knows
 * whether to enter the app or return to the tabs.
 */
export type JoinStackParamList = {
  Find: {origin: JoinOrigin};
  Pair: {station: Station; origin: JoinOrigin};
};

/** Props for a screen in the join stack. */
export type JoinScreenProps<T extends keyof JoinStackParamList> =
  NativeStackScreenProps<JoinStackParamList, T>;

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
  /** The community surfaces: vouching now, more as M1.4+ specs land. */
  Community: undefined;
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
  /** Join a community: discover + pair with its station (T1.3.2/T1.3.3). */
  Join: {origin: JoinOrigin};
  /** The stations this device is paired with, and unpairing them (T1.3.3). */
  PairedStations: undefined;
  /** Local notification + background-sync preferences (T1.3.6). */
  NotificationSettings: undefined;
  /** This member's own reputation: dimensions, composite, anchoring (T1.5.9). */
  Standing: undefined;
  /** Browse the marketplace: surfaces, search, filter chips, listing cards (T1.7.1). */
  Marketplace: undefined;
  /** One listing in full, with the Inquire CTA (T1.7.1), by content-address id. */
  ListingDetail: {listingId: string};
  /**
   * The multi-step listing form (T1.7.2). No param creates a listing; an
   * `editListingId` re-enters the same form to edit that listing (Phase B),
   * pre-filled, with the fields a patch can't change shown read-only.
   */
  CreateListing: {editListingId?: string} | undefined;
  /** The member's own listings, with the close flow (T1.7.2). */
  MyListings: undefined;
  /** The member's own inquiries, as buyer or provider (T1.7.4). */
  Inquiries: undefined;
  /** One inquiry's chat thread — messages, offers, accept/decline (T1.7.4). */
  Inquiry: {inquiryId: string};
  /** The member's own service contracts, as buyer or provider (T1.7.7). */
  Contracts: undefined;
  /** One contract's status — cadence, periods charged, terminate (T1.7.7). */
  Contract: {contractId: string};
  /** The governance hub (T1.9.8): the Charter, proposals, and statutes in force. */
  Governance: undefined;
  /** One proposal in full (T1.9.8): body, tally, and co-sign / vote actions. */
  GovProposalDetail: {proposalId: string};
  /**
   * One dispute in full (T1.10.6), by the disputed transaction id: the grievance
   * and responses, the seated jury and tally, and the role-aware action (respond
   * / rule).
   */
  DisputeDetail: {txId: string};
  /** Vouch for someone: scan their address QR, review, sign & submit (T1.4.1). */
  Vouch: undefined;
  /** The vouching browser (T1.4.5): given/received vouch lists, opened on a tab. */
  VouchList: {initial: VouchDirection};
  /** A single vouch's full detail (T1.4.5); the row travels in as a param. */
  VouchDetail: {vouch: StationVouchListRow; mode: VouchDirection};
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
