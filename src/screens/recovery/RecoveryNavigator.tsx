/**
 * The social-recovery setup flow as a self-contained nested stack (T1.2.3).
 *
 * Registered as one screen in both the onboarding stack (reached from
 * WalletReady) and the main stack (reached from Settings), so the same flow
 * serves first-run setup and later setup. The entry's `origin` route param
 * (which stack launched it) is threaded into {@link RecoveryProvider} so the
 * final screen knows whether to enter the app or return to Settings.
 *
 * A re-unlock gate (`RecoveryUnlock`) sits atop the stack: by the time recovery
 * runs, onboarding has wiped the passphrase and dropped the in-memory wallet
 * handle, so the wallet must be opened again before its key can be split.
 */
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import type {RecoveryOrigin, RecoveryStackParamList} from '../../navigation/types';
import {RecoveryProvider} from './RecoveryContext';
import {RecoveryUnlock} from './RecoveryUnlock';
import {RecoveryIntro} from './RecoveryIntro';
import {ChooseHolders} from './ChooseHolders';
import {RecoverySplit} from './RecoverySplit';
import {DistributeShards} from './DistributeShards';
import {RecoveryComplete} from './RecoveryComplete';

const Stack = createNativeStackNavigator<RecoveryStackParamList>();

/** Minimal prop shape shared by the two host stacks that mount this flow. */
interface RecoveryNavigatorProps {
  route: {params: {origin: RecoveryOrigin}};
}

export function RecoveryNavigator({route}: RecoveryNavigatorProps) {
  return (
    <RecoveryProvider origin={route.params.origin}>
      <Stack.Navigator
        screenOptions={{headerShown: false, gestureEnabled: false}}>
        <Stack.Screen name="RecoveryUnlock" component={RecoveryUnlock} />
        <Stack.Screen name="RecoveryIntro" component={RecoveryIntro} />
        <Stack.Screen name="ChooseHolders" component={ChooseHolders} />
        <Stack.Screen name="RecoverySplit" component={RecoverySplit} />
        <Stack.Screen name="DistributeShards" component={DistributeShards} />
        <Stack.Screen name="RecoveryComplete" component={RecoveryComplete} />
      </Stack.Navigator>
    </RecoveryProvider>
  );
}
