/**
 * Diagnostics (crash surfacing) — a plain window onto the persisted crash log.
 *
 * Reached from Settings → Advanced. It exists so a pilot user can *retrieve* a
 * crash after the fact — including one captured by the global handler that never
 * put up the error-boundary fallback (a background exception, an unhandled
 * rejection) — and hand it back: **Copy all** puts every recent report on the
 * clipboard, and each entry can be copied on its own. **Clear** empties the log
 * once a report has been sent.
 *
 * This is read/format/copy only: the reports are produced by
 * {@link components/ErrorBoundary} and {@link diagnostics/globalHandler} and
 * stored by {@link diagnostics/crashLog}. Newest first.
 */
import {useCallback, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';

import {Button, Card, ScreenHeader, Text} from '../../components';
import {relativeTime} from '../../ledger';
import {clearCrashLog, loadCrashLog} from '../../diagnostics/crashLog';
import {
  formatCrashReport,
  formatCrashReports,
  type CrashReport,
} from '../../diagnostics/crashReport';
import {useTheme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

/** Human noun per kind, matching the report header wording. */
const KIND_LABEL: Record<CrashReport['kind'], string> = {
  render: 'Screen error',
  fatal: 'Fatal error',
  error: 'Error',
  rejection: 'Unhandled rejection',
};

export function Diagnostics({navigation}: MainStackScreenProps<'Diagnostics'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadCrashLog()
        .then(l => active && setReports(l))
        .catch(() => active && setReports([]));
      return () => {
        active = false;
      };
    }, []),
  );

  const empty = reports.length === 0;

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <ScreenHeader
        title="Diagnostics"
        subtitle="Recent errors captured on this phone. Copy a report and send it to whoever set up your community if something keeps going wrong."
        onBack={() => navigation.goBack()}
      />

      {empty && (
        <Card style={{gap: theme.spacing.xs}}>
          <Text variant="label" color={theme.colors.text}>
            Nothing to report
          </Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            No errors have been recorded. If the app misbehaves, come back here —
            a report will be waiting to copy.
          </Text>
        </Card>
      )}

      {!empty && (
        <View style={[styles.row, {gap: theme.spacing.sm}]}>
          <View style={styles.flex1}>
            <Button
              variant="primary"
              onPress={() => {
                Clipboard.setString(formatCrashReports(reports));
                setCopiedAll(true);
              }}>
              {copiedAll ? 'Copied ✓' : 'Copy all'}
            </Button>
          </View>
          <View style={styles.flex1}>
            <Button
              variant="secondary"
              onPress={() => {
                clearCrashLog().catch(() => {});
                setReports([]);
                setCopiedAll(false);
              }}>
              Clear
            </Button>
          </View>
        </View>
      )}

      {reports.map(report => (
        <ReportCard key={report.id} report={report} />
      ))}
    </ScrollView>
  );
}

function ReportCard({report}: {report: CrashReport}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  return (
    <Card style={{gap: theme.spacing.sm}}>
      <View style={styles.tightGap}>
        <Text variant="label" color={theme.colors.text}>
          {KIND_LABEL[report.kind]}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {relativeTime(Math.floor(report.at / 1000))} · v{report.appVersion}
        </Text>
      </View>
      <Text variant="mono" color={theme.colors.textSecondary}>
        {report.message}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          Clipboard.setString(formatCrashReport(report));
          setCopied(true);
        }}>
        {copied ? 'Copied ✓' : 'Copy report'}
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row'},
  flex1: {flex: 1},
  tightGap: {gap: 2},
});
