package com.margelo.nitro.rrndiscovery

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Exists for two reasons, neither of them the usual one.
 *
 * It exports no modules and no views — a Nitro hybrid object is reached through
 * the registry, not through a `ReactPackage`. But React Native's autolinking
 * finds an Android library by scanning for a `ReactPackage`, so without this
 * class the module is simply not linked into the app. And the static
 * initialiser below is what loads `libRrnDiscovery.so`, which is what registers
 * the "StationDiscovery" constructor the JS side asks for.
 */
class RrnDiscoveryPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider { emptyMap() }

  companion object {
    init {
      // Compiled into the class's static initialiser, so this runs when the
      // class is loaded — before anything can ask for a StationDiscovery.
      RrnDiscoveryOnLoad.initializeNative()
    }
  }
}
