/**
 * Explains social recovery before setup begins (T1.2.3). Recovery splits the
 * wallet key across trusted people ("holders") using Shamir's Secret Sharing,
 * entirely on-device; any `K` of them can later restore the identity, and no
 * single holder — or company — can. Mirrors the design system's RecoveryIntro.
 */
import {StyleSheet, View} from 'react-native';

import {Button, Heading, Text} from '../../components';
import {useTheme} from '../../theme';
import type {RecoveryScreenProps} from '../../navigation/types';
import {RECOMMENDED_HOLDERS, useRecovery} from './RecoveryContext';
import {InlineNotice} from './InlineNotice';
import {RecoveryScaffold} from './RecoveryScaffold';

interface Point {
  glyph: string;
  title: string;
  body: string;
}

export function RecoveryIntro({navigation}: RecoveryScreenProps<'RecoveryIntro'>) {
  const theme = useTheme();
  const {threshold, isRefresh} = useRecovery();

  const points: Point[] = [
    {
      glyph: '👥',
      title: 'Your circle holds the key',
      body: `Split your key into pieces and give one to each person you trust. We recommend ${RECOMMENDED_HOLDERS}.`,
    },
    {
      glyph: '🧩',
      title: `Any ${threshold} can bring you back`,
      body: `If you lose this phone, ${threshold} of your holders together restore your identity — no single one can.`,
    },
    {
      glyph: '📴',
      title: 'Nothing is uploaded',
      body: 'The split happens here, offline. You hand each piece out in person.',
    },
  ];

  return (
    <RecoveryScaffold
      title={isRefresh ? 'Update your recovery circle' : 'Set up social recovery'}
      onBack={() => navigation.goBack()}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('ChooseHolders')}>
          {isRefresh ? 'Update my circle' : 'Choose my circle'}
        </Button>
      }>
      <View style={{gap: theme.spacing.lg, marginTop: theme.spacing.md}}>
        <Text variant="body" color={theme.colors.textSecondary}>
          {isRefresh
            ? 'Change who holds a piece of your key. Your identity and address stay the same — only the circle changes.'
            : 'Recover your identity even if you lose this phone — without trusting any company to hold your keys.'}
        </Text>
        {isRefresh && (
          <InlineNotice
            variant="warning"
            title="Your old pieces stop working">
            Updating re-splits your key from scratch, so every current holder’s
            piece becomes useless. Hand out the new pieces to your updated circle.
          </InlineNotice>
        )}
        {points.map(p => (
          <View key={p.title} style={styles.row}>
            <View
              style={[styles.mark, {backgroundColor: theme.colors.primaryTint}]}>
              <Text style={styles.markGlyph}>{p.glyph}</Text>
            </View>
            <View style={styles.rowText}>
              <Heading level="headingSmall">{p.title}</Heading>
              <Text
                variant="body"
                color={theme.colors.textSecondary}
                style={{marginTop: theme.spacing.xs}}>
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </RecoveryScaffold>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 14, alignItems: 'flex-start'},
  rowText: {flex: 1, minWidth: 0},
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: {fontSize: 24, lineHeight: 30},
});
