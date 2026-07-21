/**
 * Battery-optimization exemption seam (T1.3.6).
 *
 * Background sync reaches the paired station from a background/headless task.
 * Android's background-network firewall blocks that network on many OEM builds
 * (Motorola especially) unless the app is exempt from battery optimization. The
 * native {@link BatteryOptimizationModule} shows the one-tap system dialog to
 * request that exemption; this seam wraps it so callers stay platform-agnostic
 * and tests need no native module.
 *
 * On iOS (no such concept) and when the native module is absent (tests), both
 * calls degrade gracefully: the app is treated as already exempt and no dialog
 * is shown.
 */
import {NativeModules, Platform} from 'react-native';

interface BatteryOptimizationNative {
  isExempt(): Promise<boolean>;
  requestExemption(): Promise<boolean>;
}

const native: BatteryOptimizationNative | undefined = (
  NativeModules as {RrnBatteryOptimization?: BatteryOptimizationNative}
).RrnBatteryOptimization;

/** Whether the app is exempt from battery optimization (true where N/A). */
export async function isBatteryExempt(): Promise<boolean> {
  if (Platform.OS !== 'android' || native === undefined) {
    return true;
  }
  try {
    return await native.isExempt();
  } catch {
    return true;
  }
}

/**
 * Shows the system "allow unrestricted background" dialog for this app if it is
 * not already exempt. Resolves whether it was already exempt (so `false` means
 * the dialog was shown). No-op / `true` where not applicable.
 */
export async function requestBatteryExemption(): Promise<boolean> {
  if (Platform.OS !== 'android' || native === undefined) {
    return true;
  }
  try {
    return await native.requestExemption();
  } catch {
    return true;
  }
}
