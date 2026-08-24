/**
 * ErrorBoundary — the app's top-level catch for uncaught render errors (crash
 * surfacing).
 *
 * Without this, a single throw anywhere in the screen tree unmounts the whole
 * React root, and on a sideloaded release build (no redbox) the user is left
 * staring at a **white screen** with no message, no way out, and nothing to send
 * back. This replaces that dead end with a calm, plain-language fallback that:
 *
 *   - explains something went wrong in words a non-developer can act on,
 *   - offers **Try again**, which resets the boundary and re-mounts the tree (a
 *     transient render error clears; a deterministic one simply re-trips, which
 *     is honest), and
 *   - offers **Copy details**, putting the full {@link CrashReport} on the
 *     clipboard so the user can hand it back.
 *
 * The crash is also written to the persisted {@link diagnostics/crashLog} in
 * `componentDidCatch`, so it survives even if the user force-closes from here.
 *
 * A class component is used because `getDerivedStateFromError` /
 * `componentDidCatch` are the only React API for catching render errors; the
 * fallback UI itself is a function component ({@link CrashFallback}) so it can
 * use theme hooks. The boundary must live **under** ThemeProvider and
 * SafeAreaProvider (which it does — see {@link App}) so the fallback can render.
 */
import {Component, useState, type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';

import {recordCrash} from '../diagnostics/crashLog';
import {
  formatCrashReport,
  makeCrashReport,
  type CrashReport,
} from '../diagnostics/crashReport';
import {useTheme} from '../theme';
import {Button} from './Button';
import {Card} from './Card';
import {Heading} from './Heading';
import {Text} from './Text';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  report: CrashReport | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {report: null};

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // Build the report synchronously so the fallback has it on first paint; the
    // component stack is filled in by componentDidCatch just below.
    return {report: makeCrashReport('render', error)};
  }

  componentDidCatch(error: unknown, info: {componentStack?: string}): void {
    // Rebuild with the component stack (which getDerivedStateFromError lacks) so
    // both the displayed report and the persisted one name the failing screen.
    const report = makeCrashReport('render', error, {
      componentStack: info.componentStack ?? undefined,
    });
    this.setState({report});
    // Fire-and-forget; recordCrash never throws (the .catch only satisfies lint).
    recordCrash(report).catch(() => {});
  }

  private handleReset = (): void => {
    this.setState({report: null});
  };

  render(): ReactNode {
    if (this.state.report !== null) {
      return (
        <CrashFallback report={this.state.report} onReset={this.handleReset} />
      );
    }
    return this.props.children;
  }
}

interface CrashFallbackProps {
  report: CrashReport;
  onReset: () => void;
}

/**
 * The fallback screen. A function component so it can read the theme and safe-area
 * insets; kept intentionally simple (no data hooks, no navigation) because it
 * renders precisely when the rest of the app has just failed.
 */
function CrashFallback({report, onReset}: CrashFallbackProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  return (
    <View style={[styles.root, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: insets.top + theme.spacing.xl,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.lg,
        }}>
        <View style={{gap: theme.spacing.sm}}>
          <Heading level="headingLarge">Something went wrong</Heading>
          <Text variant="body" color={theme.colors.textSecondary}>
            The app hit an unexpected error and had to stop this screen. Your
            wallet and data are safe on this device. Try again below — if it keeps
            happening, copy the details and send them to whoever set up your
            community so it can be fixed.
          </Text>
        </View>

        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            What happened
          </Text>
          <Text variant="mono" color={theme.colors.textSecondary}>
            {report.message}
          </Text>
        </Card>

        <View style={{gap: theme.spacing.sm}}>
          <Button variant="primary" onPress={onReset}>
            Try again
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              Clipboard.setString(formatCrashReport(report));
              setCopied(true);
            }}>
            {copied ? 'Copied ✓' : 'Copy details'}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
