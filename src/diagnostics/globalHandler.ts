/**
 * Global JS error capture (crash surfacing).
 *
 * The error boundary catches failures thrown during React render, but a lot of
 * app failures happen outside render — in a timer, a network callback, an async
 * effect, a floating promise — and on a release build those vanish silently
 * (there is no redbox). This installs process-level hooks so those, too, land in
 * the persisted {@link diagnostics/crashLog} for a pilot user to hand back.
 *
 * It is deliberately conservative:
 *
 *  - It **chains** the previous handler rather than replacing it, so React
 *    Native's own reporting (the dev redbox, the native crash path for fatals)
 *    still runs exactly as before. We record *in addition*, never *instead*.
 *  - Recording is fire-and-forget: we kick off the async keychain write and then
 *    hand straight to the previous handler, so a fatal's native teardown is not
 *    delayed waiting on us. The trade-off, confirmed on-device: for a *fatal*
 *    error (React Native terminates the process) the async {@link crypto/SecureStore}
 *    write usually loses the race against teardown, so fatal crashes are NOT
 *    reliably persisted here — the app simply closing is their signal, and the
 *    error boundary (which persists synchronously enough to survive a restart)
 *    is the durable path. Non-fatal errors and rejections, where the app keeps
 *    running, do persist. Guaranteeing fatal-crash capture would need a
 *    synchronous on-device write (a file/MMKV), which the SecureStore-only
 *    persistence choice deliberately forgoes.
 *  - Rejection tracking is best-effort. Hooking unhandled rejections is
 *    engine-specific (Hermes vs. the JSC promise polyfill), so it is wrapped in
 *    a try/catch and simply skipped where unavailable — the exception handler,
 *    the more important of the two, does not depend on it.
 */
import {recordError} from './crashLog';

/** Installed once; a second call is a no-op (index load + tests both call it). */
let installed = false;

/**
 * The subset of React Native's `ErrorUtils` we touch. Declared locally so this
 * module needs no `@types/react-native` global augmentation.
 */
interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

function getErrorUtils(): ErrorUtilsLike | undefined {
  // `global.ErrorUtils` is present in the RN runtime but not in the ambient
  // types, so reach it through an unknown-typed global.
  const g = globalThis as {ErrorUtils?: ErrorUtilsLike};
  return g.ErrorUtils;
}

/** Installs the global exception handler (and, best-effort, rejection tracking). */
export function installGlobalErrorHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  const errorUtils = getErrorUtils();
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      // Fire-and-forget: persist, then let RN's own handler run undelayed.
      recordError(isFatal ? 'fatal' : 'error', error).catch(() => {});
      previous?.(error, isFatal);
    });
  }

  installRejectionTracking();
}

/**
 * Best-effort unhandled-promise-rejection capture. Uses the bundled `promise`
 * polyfill's rejection tracker when present; on engines/setups where it is not,
 * this quietly does nothing. Chains any tracker already enabled.
 */
function installRejectionTracking(): void {
  try {
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: unknown, error: unknown) => {
        recordError('rejection', error).catch(() => {});
      },
      // A rejection that is later handled is not a crash; nothing to undo.
      onHandled: () => {},
    });
  } catch {
    // Rejection tracking unavailable in this runtime — the exception handler,
    // installed above, still covers the common case.
  }
}

/** Test-only: forget the install guard so a test can re-install onto a spy. */
export function resetGlobalErrorHandlerForTests(): void {
  installed = false;
}
