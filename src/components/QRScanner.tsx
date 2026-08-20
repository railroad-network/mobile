/**
 * The camera seam: a reusable QR-code scanner (T1.2.3 Phase 1).
 *
 * Wraps a native barcode scanner so the rest of the app depends on this small
 * surface — `<QRScanner onScan={…} />` — rather than on the camera library's
 * API. It owns the camera-permission gate and the no-device fallback, and hands
 * the parent a decoded string.
 *
 * Reused by social-recovery distribution/holder-receive (T1.2.3), vouching,
 * Send (T1.2.5), and station key recovery (T1.11.3).
 *
 * NOTE (platform / library split): the actual scanning view is
 * `react-native-camera-kit`, whose barcode scanner works on **both** Android and
 * iOS. `react-native-vision-camera` v5's object-output scanner is iOS-only (its
 * Nitro rewrite hard-throws `CameraObjectOutput is not available on Android!`),
 * so it can't drive scanning here — but its `useCameraPermission` /
 * `useCameraDevice` hooks give the cleanest cross-platform permission gate
 * (including the blocked-vs-can-ask distinction camera-kit's boolean API lacks),
 * so those two hooks stay. Everything is behind this seam, so callers are
 * unaffected.
 */

import React, {useCallback, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {useCameraDevice, useCameraPermission} from 'react-native-vision-camera';
import {Camera as CameraKitCamera, CameraType} from 'react-native-camera-kit';

import {useTheme} from '../theme';
import {Button} from './Button';
import {Text} from './Text';

/**
 * camera-kit's `onReadCode` event shape. Defined locally because the package
 * re-exports `Camera`/`CameraType` from its root but not the `OnReadCodeData`
 * type — and a deep `dist/` import would be brittle.
 */
interface ReadCodeEvent {
  nativeEvent: {codeStringValue?: string};
}

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

  // De-duplicate: the scanner fires continuously while a code is in frame, so
  // only surface a value when it differs from the last one reported.
  const lastValue = useRef<string | null>(null);
  const handleReadCode = useCallback(
    (event: ReadCodeEvent) => {
      const value = event.nativeEvent.codeStringValue;
      if (value == null || value === lastValue.current) {
        return;
      }
      lastValue.current = value;
      onScan(value);
    },
    [onScan],
  );

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
      <CameraKitCamera
        style={StyleSheet.absoluteFill}
        cameraType={CameraType.Back}
        // `scanBarcode` gates reading, not the preview: false pauses scanning
        // (e.g. after a successful read, or when the screen is unfocused).
        scanBarcode={isActive}
        onReadCode={handleReadCode}
        showFrame={false}
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
