/**
 * The Community tab (T1.4.1) — the home of the community-facing surfaces. M1.4
 * puts the first one here: vouching, the in-person act that grows the web of
 * trust. Later milestones add more (listings M1.6/M1.7, governance M1.9), so
 * the screen is a growing list of sections rather than a single flow.
 *
 * The identity card mirrors Settings' community line: the community name comes
 * from the ledger identity (the station's `whoami`) when paired, so the member
 * sees which community their vouches land in.
 */
import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Card, Heading, Text} from '../../components';
import {useIdentity, useReputation, useVouchCounts} from '../../ledger';
import type {StationReputation} from '../../network/StationClient';
import {useTheme, type Theme} from '../../theme';
import type {MainTabScreenProps} from '../../navigation/types';

export function Community({navigation}: MainTabScreenProps<'Community'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {data: identity} = useIdentity();
  const {data: counts} = useVouchCounts(true);
  const {data: standing} = useReputation();

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
        <Heading level="headingLarge">Community</Heading>
        <Text variant="body" color={theme.colors.textSecondary}>
          {identity?.community !== undefined
            ? `You’re a member of ${identity.community}.`
            : 'Pair with a station to join a community.'}
        </Text>
      </View>

      <Group theme={theme} label="Your standing">
        <NavRow
          theme={theme}
          title={standingTitle(standing)}
          subtitle={standingSubtitle(standing)}
          onPress={() => navigation.navigate('Standing')}
        />
      </Group>

      <Group theme={theme} label="Marketplace">
        <NavRow
          theme={theme}
          title="Browse the marketplace"
          subtitle="See what members are offering — goods, services, and commons"
          onPress={() => navigation.navigate('Marketplace')}
        />
        <NavRow
          theme={theme}
          title="Sell something"
          subtitle="Offer goods, a service, or a community resource"
          onPress={() => navigation.navigate('CreateListing')}
        />
        <NavRow
          theme={theme}
          title="My listings"
          subtitle="Your offers, and taking one off offer"
          onPress={() => navigation.navigate('MyListings')}
        />
        <NavRow
          theme={theme}
          title="Inquiries"
          subtitle="Conversations about a listing — yours or someone else’s"
          onPress={() => navigation.navigate('Inquiries')}
        />
        <NavRow
          theme={theme}
          title="Contracts"
          subtitle="Recurring services you subscribe to or provide"
          onPress={() => navigation.navigate('Contracts')}
        />
      </Group>

      <Group theme={theme} label="Governance">
        <NavRow
          theme={theme}
          title="Charter & proposals"
          subtitle="Read the community’s rules, co-sign and vote on proposals"
          onPress={() => navigation.navigate('Governance')}
        />
      </Group>

      <Group theme={theme} label="Web of trust">
        <NavRow
          theme={theme}
          title="Vouch for someone"
          subtitle="Scan their address in person and stake your word on them"
          onPress={() => navigation.navigate('Vouch')}
        />
      </Group>

      <Group theme={theme} label="Your vouches">
        <NavRow
          theme={theme}
          title="Vouches I’ve made"
          subtitle={peopleSubtitle(counts?.given, 'given')}
          onPress={() => navigation.navigate('VouchList', {initial: 'given'})}
        />
        <NavRow
          theme={theme}
          title="Vouches I’ve received"
          subtitle={peopleSubtitle(counts?.received, 'received')}
          onPress={() => navigation.navigate('VouchList', {initial: 'received'})}
        />
      </Group>
    </ScrollView>
  );
}

/** "Member · 2.10", or a neutral title until the standing is known (loading or
 * offline — the score comes from the station, so it is never guessed here). */
function standingTitle(standing: StationReputation | undefined): string {
  if (standing === undefined) {
    return 'Your reputation';
  }
  return `${standing.band} · ${standing.composite.toFixed(2)}`;
}

/** The one line that most needs saying on the way in: whether the newcomer cap
 * is still holding the score down (T1.5.8), since that is what makes a member
 * with real history read low. */
function standingSubtitle(standing: StationReputation | undefined): string {
  if (standing === undefined) {
    return 'Tap to view';
  }
  return standing.anchored
    ? 'Anchored by a vouch'
    : 'Not anchored yet — a vouch will lift it';
}

/** "3 people you’ve vouched for" / "1 person has vouched for you" / "No one
 * yet", or a neutral hint while the count is unknown (loading or offline — never
 * a fabricated number). Verb agreement follows the count. */
function peopleSubtitle(count: number | undefined, kind: 'given' | 'received'): string {
  if (count === undefined) {
    return 'Tap to view';
  }
  if (count === 0) {
    return 'No one yet';
  }
  const noun = count === 1 ? 'person' : 'people';
  if (kind === 'given') {
    return `${count} ${noun} you’ve vouched for`;
  }
  return `${count} ${noun} ${count === 1 ? 'has' : 'have'} vouched for you`;
}

/** A titled group: a section label above a card of rows (mirrors Settings). */
function Group({theme, label, children}: {theme: Theme; label: string; children: React.ReactNode}) {
  return (
    <View style={styles.group}>
      <Text variant="label" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <Card padded={false} style={styles.groupCard}>
        {children}
      </Card>
    </View>
  );
}

/** A tappable row inside a {@link Group}: title, optional subtitle (mirrors Settings). */
function NavRow({
  theme,
  title,
  subtitle,
  onPress,
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.navRow,
        {backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent'},
      ]}>
      <View style={styles.navRowText}>
        <Text variant="label" color={theme.colors.text}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text variant="caption" color={theme.colors.textSecondary}>
            {subtitle}
          </Text>
        )}
      </View>
      <Text variant="body" color={theme.colors.textMuted}>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {gap: 8},
  groupCard: {overflow: 'hidden'},
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  navRowText: {flex: 1, minWidth: 0, gap: 2},
});
