/**
 * A single vouch's full detail (T1.4.5), reached from the vouching browser.
 * Shows the two parties, the statement, stake, community, date, and content
 * address — plus a verification line: every row the browser lists came from the
 * station's own append-only log, which verified the signature before recording
 * it (`submit_vouch` calls `.verify()`), so a listed vouch is verified by
 * construction.
 *
 * The row travels in as a navigation param (it is small, plain JSON), so the
 * screen needs no refetch. For a vouch you made, the subject's local nickname is
 * loaded from {@link wallet/vouchNicknames}; a received vouch shows the voucher's
 * shortened address.
 */
import {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Card, Heading, Identicon, Text} from '../../components';
import {dayLabel, formatCommons, shortAddress} from '../../ledger';
import {loadVouchNicknames} from '../../wallet/vouchNicknames';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

export function VouchDetail({route, navigation}: MainStackScreenProps<'VouchDetail'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {vouch, mode} = route.params;
  const [nickname, setNickname] = useState<string | undefined>(undefined);

  // Only a vouch you made carries a local nickname (for the subject).
  useEffect(() => {
    if (mode !== 'given') {
      return;
    }
    let active = true;
    loadVouchNicknames()
      .then(m => active && setNickname(m[vouch.subject_address]))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mode, vouch.subject_address]);

  const counterpartyAddress =
    mode === 'given' ? vouch.subject_address : vouch.voucher_address;
  const counterpartyLabel =
    mode === 'given' && nickname !== undefined && nickname.length > 0
      ? nickname
      : shortAddress(counterpartyAddress);
  const directionText = mode === 'given' ? 'You vouched for' : 'Vouched for you';
  const hasStatement = vouch.statement.trim().length > 0;

  return (
    <ScrollView
      style={{backgroundColor: theme.colors.bg}}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xl,
        gap: theme.spacing.lg,
      }}>
      <View style={{gap: theme.spacing.xs}}>
        <Text
          variant="body"
          color={theme.colors.primary}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back">
          ‹ Back
        </Text>
        <Heading level="headingLarge">Vouch</Heading>
      </View>

      <Card style={styles.hero}>
        <Identicon seed={counterpartyAddress} size={52} />
        <View style={{flex: 1, minWidth: 0, gap: 2}}>
          <Text variant="caption" color={theme.colors.textSecondary}>
            {directionText}
          </Text>
          <Text variant="label" color={theme.colors.text} numberOfLines={1} style={styles.heroName}>
            {counterpartyLabel}
          </Text>
        </View>
      </Card>

      {hasStatement && (
        <Text variant="body" color={theme.colors.textSecondary} style={styles.quote}>
          “{vouch.statement.trim()}”
        </Text>
      )}

      <Card style={{gap: theme.spacing.sm}}>
        <DetailRow theme={theme} label="Community">
          <Text variant="body" color={theme.colors.text}>
            {vouch.community}
          </Text>
        </DetailRow>
        <DetailRow theme={theme} label="Reputation staked">
          <Text variant="body" color={theme.colors.text}>
            {vouch.stake_centi > 0 ? `${formatCommons(vouch.stake_centi)} points` : 'None'}
          </Text>
        </DetailRow>
        <DetailRow theme={theme} label="Date">
          <Text variant="body" color={theme.colors.text}>
            {dayLabel(vouch.issued_at)}
          </Text>
        </DetailRow>
        <DetailRow theme={theme} label="Voucher">
          <Text variant="mono" color={theme.colors.text}>
            {shortAddress(vouch.voucher_address)}
          </Text>
        </DetailRow>
        <DetailRow theme={theme} label="Subject">
          <Text variant="mono" color={theme.colors.text}>
            {shortAddress(vouch.subject_address)}
          </Text>
        </DetailRow>
        <DetailRow theme={theme} label="Vouch ID">
          <Text variant="mono" color={theme.colors.textSecondary}>
            {shortId(vouch.vouch_id)}
          </Text>
        </DetailRow>
      </Card>

      <Text variant="caption" color={theme.colors.textMuted} style={styles.verified}>
        ✓ Verified · on the {vouch.community} record
      </Text>
    </ScrollView>
  );
}

function DetailRow({theme, label, children}: {theme: Theme; label: string; children: React.ReactNode}) {
  return (
    <View style={styles.detailRow}>
      <Text variant="label" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View style={styles.detailValue}>{children}</View>
    </View>
  );
}

/** A middle-elided content address, e.g. `a1b2c3…f4e5`. */
function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

const styles = StyleSheet.create({
  hero: {flexDirection: 'row', alignItems: 'center', gap: 14},
  heroName: {fontWeight: '700'},
  quote: {fontStyle: 'italic'},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailValue: {flexShrink: 1, alignItems: 'flex-end'},
  verified: {textAlign: 'center'},
});
