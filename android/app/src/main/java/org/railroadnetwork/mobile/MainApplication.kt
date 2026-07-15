package org.railroadnetwork.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.railroadnetworkmobile.RrnMobileFfiPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // The Rust crypto FFI (ADR-0007). PackageList only covers autolinked
          // npm packages, and :rrn-ffi is a local Gradle subproject, so it is
          // registered by hand — the counterpart of RCT_EXPORT_MODULE doing this
          // implicitly on iOS. Without it every crypto call fails at startup with
          // "TurboModuleRegistry.getEnforcing(...): 'RrnMobileFfi' could not be found".
          add(RrnMobileFfiPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
