/**
 * @format
 */
import '../global.css';

import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {ErrorBoundary} from './components';
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
            {/* Top-level catch for uncaught render errors: without it, a single
                throw unmounts the whole app to a blank screen on a release build.
                Sits under ThemeProvider + SafeAreaProvider so its fallback can
                render themed and inset-aware. */}
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
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
