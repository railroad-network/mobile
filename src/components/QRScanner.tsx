/**
 * The camera seam: a reusable QR-code scanner (T1.2.3 Phase 1).
 *
 * Wraps `react-native-vision-camera` v5's object-output scanner so the rest of
 * the app depends on this small surface — `<QRScanner onScan={…} />` — rather
 * than on the camera library's API. It owns the camera-permission gate and the
 * no-device fallback, and hands the parent a decoded string.
 *
 * Reused by social-recovery distribution/holder-receive (T1.2.3) and later by
 * Send (T1.2.5).
 *
 * NOTE (platform): vision-camera v5's object/code scanning is **iOS-only** at
 * this version — its Nitro rewrite has not yet ported barcode scanning to
 * Android. On Android `useCameraDevice`/scanning will not surface QR codes; the
 * permission gate and fallbacks still render. Revisit when the library adds
 * Android object output (or slot in an Android-specific scanner behind this
 * same seam).
 */

import React, {useCallback, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  Camera,
  isScannedCode,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
  type ScannedObject,
  type ScannedObjectType,
} from 'react-native-vision-camera';

import {useTheme} from '../theme';
import {Button} from './Button';
import {Text} from './Text';

// Stable reference: `useObjectOutput` memoizes on `types`, so a new array
// literal each render would rebuild the native output every time.
const QR_TYPES: ScannedObjectType[] = ['qr'];

/** Render-prop state for the permission gate. */
export interface QRScannerPermissionState {
  /** Prompt the OS permission dialog (only meaningful when `canRequest`). */
  request: () => void;
  /**
   * Whether the OS will still show a prompt. `false` once the user has denied:
   * the app must then send them to Settings to grant it.
   */
  canRequest: boolean;
}

export interface QRScannerProps {
  /**
   * Called with the decoded string each time a *new* QR value is recognized
   * (consecutive identical reads are de-duplicated). The parent decides what to
   * do next — typically pause the scanner and advance the flow.
   */
  onScan: (value: string) => void;
  /**
   * Whether the camera is actively streaming. Set `false` to pause it (e.g.
   * when the screen is not focused, or after a successful scan). Defaults to
   * `true`.
   */
  isActive?: boolean;
  /** Overrides the default UI shown until camera permission is granted. */
  renderNoPermission?: (state: QRScannerPermissionState) => React.ReactNode;
  /** Overrides the default UI shown when no back camera exists (e.g. a sim). */
  renderNoDevice?: () => React.ReactNode;
  /** Extra style for the camera container. */
  style?: View['props']['style'];
}

/** A QR scanner with a built-in permission gate and no-device fallback. */
export function QRScanner({
  onScan,
  isActive = true,
  renderNoPermission,
  renderNoDevice,
  style,
}: QRScannerProps) {
  const {hasPermission, requestPermission, canRequestPermission} =
    useCameraPermission();
  const device = useCameraDevice('back');

  // De-duplicate: the object output fires continuously while a code is in
  // frame, so only surface a value when it differs from the last one reported.
  const lastValue = useRef<string | null>(null);
  const handleObjectsScanned = useCallback(
    (objects: ScannedObject[]) => {
      for (const object of objects) {
        if (isScannedCode(object) && object.value != null) {
          if (object.value === lastValue.current) {
            return;
          }
          lastValue.current = object.value;
          onScan(object.value);
          return;
        }
      }
    },
    [onScan],
  );
  const objectOutput = useObjectOutput({
    types: QR_TYPES,
    onObjectsScanned: handleObjectsScanned,
  });

  if (!hasPermission) {
    const state: QRScannerPermissionState = {
      request: requestPermission,
      canRequest: canRequestPermission,
    };
    return renderNoPermission ? (
      <>{renderNoPermission(state)}</>
    ) : (
      <NoPermission {...state} />
    );
  }

  if (device == null) {
    return renderNoDevice ? <>{renderNoDevice()}</> : <NoDevice />;
  }

  return (
    <View style={[styles.fill, style]}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        outputs={[objectOutput]}
      />
    </View>
  );
}

/** Default permission gate: explains why the camera is needed and prompts. */
function NoPermission({request, canRequest}: QRScannerPermissionState) {
  const {colors, spacing} = useTheme();
  return (
    <View
      style={[
        styles.center,
        {backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md},
      ]}>
      <Text variant="body" color={colors.textSecondary} style={styles.centerText}>
        {canRequest
          ? 'Camera access is needed to scan QR codes.'
          : 'Camera access is off. Enable it in Settings to scan QR codes.'}
      </Text>
      {canRequest ? (
        <Button variant="accent" onPress={request}>
          Enable camera
        </Button>
      ) : null}
    </View>
  );
}

/** Default fallback when there is no back camera (e.g. the iOS simulator). */
function NoDevice() {
  const {colors, spacing} = useTheme();
  return (
    <View
      style={[
        styles.center,
        {backgroundColor: colors.bg, padding: spacing.lg},
      ]}>
      <Text variant="body" color={colors.textSecondary} style={styles.centerText}>
        No camera is available on this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  centerText: {textAlign: 'center'},
});
