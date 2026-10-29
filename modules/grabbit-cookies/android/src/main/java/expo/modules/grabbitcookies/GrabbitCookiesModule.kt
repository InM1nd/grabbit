package expo.modules.grabbitcookies

import android.webkit.CookieManager
import android.webkit.WebStorage
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GrabbitCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GrabbitCookies")

    AsyncFunction("clearAll") { promise: Promise ->
      val cm = CookieManager.getInstance()
      cm.removeAllCookies { ok ->
        cm.flush()
        try { WebStorage.getInstance().deleteAllData() } catch (_: Throwable) {}
        promise.resolve(ok)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
