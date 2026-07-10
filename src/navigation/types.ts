import type {NavigatorScreenParams} from '@react-navigation/native';

export type OnboardingStackParamList = {
  Welcome: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Send: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};
