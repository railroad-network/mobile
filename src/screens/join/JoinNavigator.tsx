/**
 * The join-a-community flow (discover + pair) as a self-contained nested stack
 * (T1.11.1).
 *
 * Registered as one screen in both the onboarding stack (reached from
 * WalletReady) and the main stack (reached from Settings / Home), so the same
 * two-step flow serves first-run onboarding and later "add a station". The
 * entry's `origin` route param (which stack launched it) rides down to {@link
 * Pair} via the first screen's params, so the final step knows whether to enter
 * the app or return to the tabs.
 *
 * This mirrors the recovery flow's `RecoveryNavigator`: wrapping the shared
 * screens in their own stack keeps the two host stacks from each needing to know
 * the internal `Find → Pair` routing.
 */
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import type {JoinOrigin, JoinStackParamList} from '../../navigation/types';
import {Find} from './Find';
import {Pair} from './Pair';

const Stack = createNativeStackNavigator<JoinStackParamList>();

/** Minimal prop shape shared by the two host stacks that mount this flow. */
interface JoinNavigatorProps {
  route: {params: {origin: JoinOrigin}};
}

export function JoinNavigator({route}: JoinNavigatorProps) {
  const {origin} = route.params;
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Find" component={Find} initialParams={{origin}} />
      <Stack.Screen name="Pair" component={Pair} />
    </Stack.Navigator>
  );
}
