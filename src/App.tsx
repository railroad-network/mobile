/**
 * @format
 */
import '../global.css';

import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {RootNavigator} from './navigation/RootNavigator';
import {StationSubscription} from './network/useStationSubscription';
import {ThemeProvider, useTheme} from './theme';
import {WalletSessionProvider} from './wallet/WalletSession';

const queryClient = new QueryClient();

function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <WalletSessionProvider>
            <AppContent />
          </WalletSessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const theme = useTheme();

  return (
    <>
      <StatusBar
        barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.bg}
      />
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
      {/* Runs the subscribe long-poll while unlocked + paired (T1.3.5). */}
      <StationSubscription />
    </>
  );
}

export default App;
