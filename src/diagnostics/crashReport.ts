/**
 * A captured failure and its plain-text rendering (crash surfacing).
 *
 * The point of this module is a pilot user, not a developer: when the app falls
 * over on a sideloaded build there is no redbox and no crash-reporting backend,
 * so the only way a report reaches us is the user copying one out and handing it
 * back. {@link formatCrashReport} therefore produces a self-contained block of
 * text — no colours, no truncation, everything needed to place the crash — that
 * reads well pasted into any channel.
 *
 * Two producers write these: the top-level {@link components/ErrorBoundary} for
 * uncaught render errors (the white-screen killer), and the
 * {@link diagnostics/globalHandler} for global JS exceptions and unhandled
 * promise rejections. Both persist through {@link diagnostics/crashLog}.
 */

/** Where a captured failure came from — shapes the header wording only. */
export type CrashKind =
  /** Thrown during React render/lifecycle; caught by the error boundary. */
  | 'render'
  /** Uncaught JS exception reported to the global handler as fatal. */
  | 'fatal'
  /** Uncaught JS exception reported as non-fatal (app kept running). */
  | 'error'
  /** A promise that rejected with no handler. */
  | 'rejection';

export interface CrashReport {
  /** Stable id (capture time in ms, plus a small suffix to avoid collisions). */
  id: string;
  kind: CrashKind;
  /** The error message, always present even if the thrown value was not an Error. */
  message: string;
  /** The JS stack, when the thrown value carried one. */
  stack?: string;
  /** React's component stack (render crashes only) — names the failing screen. */
  componentStack?: string;
  /** Capture time, Unix milliseconds. */
  at: number;
  /** App version string at capture, so an old report is not misread. */
  appVersion: string;
}

/**
 * The app's human version label. Kept here as the single source so the crash
 * header and the Settings "About" line can never drift apart; bump on release.
 */
export const APP_VERSION = '0.0.1';

/** A friendly noun for each kind, used in the report header. */
function kindLabel(kind: CrashKind): string {
  switch (kind) {
    case 'render':
      return 'Screen error';
    case 'fatal':
      return 'Fatal error';
    case 'error':
      return 'Error';
    case 'rejection':
      return 'Unhandled promise rejection';
  }
}

/**
 * Coerces an unknown thrown value into a {@link CrashReport}'s message/stack.
 * Anything can be thrown in JS, not only `Error`s, so this never assumes shape.
 */
export function describeError(err: unknown): {message: string; stack?: string} {
  if (err instanceof Error) {
    return {message: err.message || err.name || 'Error', stack: err.stack};
  }
  if (typeof err === 'string') {
    return {message: err};
  }
  try {
    return {message: JSON.stringify(err) ?? String(err)};
  } catch {
    return {message: String(err)};
  }
}

/**
 * Builds a report from a thrown value plus context. `at`/`id`/`appVersion` are
 * filled in here so callers only supply what they know.
 */
export function makeCrashReport(
  kind: CrashKind,
  err: unknown,
  extra?: {componentStack?: string},
): CrashReport {
  const {message, stack} = describeError(err);
  const at = Date.now();
  return {
    id: `${at}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind,
    message,
    stack,
    componentStack: extra?.componentStack,
    at,
    appVersion: APP_VERSION,
  };
}

/**
 * Renders a report as the plain-text block a user copies out. Ordering puts the
 * human-placeable facts (what, when, version) first and the stacks last, so the
 * top stays readable even when the trace is long.
 */
export function formatCrashReport(report: CrashReport): string {
  const when = new Date(report.at).toISOString();
  const lines = [
    `Railroad Network — ${kindLabel(report.kind)}`,
    `App: ${report.appVersion}`,
    `When: ${when}`,
    '',
    `Message: ${report.message}`,
  ];
  if (report.componentStack) {
    lines.push('', 'Component stack:', report.componentStack.trim());
  }
  if (report.stack) {
    lines.push('', 'Stack:', report.stack.trim());
  }
  return lines.join('\n');
}

/** Renders several reports into one copy-all block, newest first, rule-separated. */
export function formatCrashReports(reports: CrashReport[]): string {
  return reports.map(formatCrashReport).join('\n\n' + '─'.repeat(32) + '\n\n');
}
