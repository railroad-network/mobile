/**
 * Transient state shared across the create-wallet flow (Welcome → Passphrase →
 * BiometricSetup → GenerateWallet → WalletReady).
 *
 * The passphrase is deliberately held here, in a context scoped to the
 * onboarding stack, rather than passed through navigation route params: route
 * params get serialized into persisted navigation state, and a passphrase has
 * no business living there. {@link OnboardingState.clearSecrets} wipes it from
 * memory as soon as the wallet has been sealed.
 */
import {createContext, useContext, useMemo, useState, type ReactNode} from 'react';

import type {Wallet} from '../../wallet/Wallet';

export interface OnboardingState {
  passphrase: string;
  setPassphrase: (value: string) => void;

  /** Whether the user opted into biometric unlock. Defaults to `false`. */
  biometricEnabled: boolean;
  setBiometricEnabled: (value: boolean) => void;

  /** The bech32 address of the freshly created wallet (public; shown last). */
  createdAddress: string | null;
  setCreatedAddress: (value: string) => void;

  /**
   * The freshly-created, unlocked wallet handle — handed to the session on the
   * last onboarding screen ({@link WalletSession.adopt}) so a new user lands in
   * the app unlocked rather than at the lock screen. Not a secret (the seed
   * stays in Rust); held only until onboarding completes.
   */
  createdWallet: Wallet | null;
  setCreatedWallet: (value: Wallet) => void;

  /** Forgets the passphrase once it is no longer needed. */
  clearSecrets: () => void;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({children}: {children: ReactNode}) {
  const [passphrase, setPassphrase] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [createdAddress, setCreatedAddress] = useState<string | null>(null);
  const [createdWallet, setCreatedWallet] = useState<Wallet | null>(null);

  const value = useMemo<OnboardingState>(
    () => ({
      passphrase,
      setPassphrase,
      biometricEnabled,
      setBiometricEnabled,
      createdAddress,
      setCreatedAddress,
      createdWallet,
      setCreatedWallet,
      clearSecrets: () => setPassphrase(''),
    }),
    [passphrase, biometricEnabled, createdAddress, createdWallet],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

/** Reads the onboarding flow state. Must be used under {@link OnboardingProvider}. */
export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (ctx === null) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return ctx;
}
