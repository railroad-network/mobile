package org.railroadnetwork.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Requesting exemption from battery optimization (T1.3.6).
 *
 * Background sync opens a network request to the paired station from a
 * background/headless task. On many OEM builds (notably Motorola) Android's
 * background-network firewall blocks an app's network unless it is foreground —
 * so the drain silently fails to reach the station. Exempting the app from
 * battery optimization ("Unrestricted" battery) lifts that block.
 *
 * The direct one-tap system dialog is `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`,
 * which requires a `package:` data URI — something React Native's `Linking` API
 * cannot set. Hence this tiny native module. It is Android-only; iOS has no
 * equivalent and the JS seam no-ops there.
 */
class BatteryOptimizationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "RrnBatteryOptimization"

  /** Whether this app is already exempt from battery optimization. */
  @ReactMethod
  fun isExempt(promise: Promise) {
    try {
      val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } catch (e: Exception) {
      promise.reject("battery_opt_error", e)
    }
  }

  /**
   * Opens the system "allow unrestricted background" dialog for this app, unless
   * it is already exempt. Resolves whether the app is exempt *before* the prompt
   * (the result of the prompt itself is learned on the next `isExempt` check).
   */
  @ReactMethod
  fun requestExemption(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
        promise.resolve(true)
        return
      }
      val intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${ctx.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      ctx.startActivity(intent)
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("battery_opt_error", e)
    }
  }
}
