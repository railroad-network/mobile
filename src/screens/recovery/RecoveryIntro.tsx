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
import {RecoveryScaffold} from './RecoveryScaffold';

interface Point {
  glyph: string;
  title: string;
  body: string;
}

export function RecoveryIntro({navigation}: RecoveryScreenProps<'RecoveryIntro'>) {
  const theme = useTheme();
  const {threshold} = useRecovery();

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
      title="Set up social recovery"
      onBack={() => navigation.goBack()}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('ChooseHolders')}>
          Choose my circle
        </Button>
      }>
      <View style={{gap: theme.spacing.lg, marginTop: theme.spacing.md}}>
        <Text variant="body" color={theme.colors.textSecondary}>
          Recover your identity even if you lose this phone — without trusting any
          company to hold your keys.
        </Text>
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
