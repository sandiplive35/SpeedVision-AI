import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { CctvCredentials, PersistedAppState } from './types';

const APP_STATE_KEY = 'speedvision.app-state.v1';
const CCTV_NAME_KEY = 'speedvision.cctv.name';
const CCTV_URL_KEY = 'speedvision.cctv.url';
const CCTV_USERNAME_KEY = 'speedvision.cctv.username';
const CCTV_PASSWORD_KEY = 'speedvision.cctv.password';

export async function loadAppState(): Promise<PersistedAppState | null> {
  const raw = await AsyncStorage.getItem(APP_STATE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PersistedAppState;
  } catch {
    return null;
  }
}

export async function saveAppState(state: PersistedAppState): Promise<void> {
  await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
}

export async function clearAppState(): Promise<void> {
  await AsyncStorage.removeItem(APP_STATE_KEY);
}

export async function saveCctvCredentials(credentials: CctvCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(CCTV_NAME_KEY, credentials.name),
    SecureStore.setItemAsync(CCTV_URL_KEY, credentials.url),
    SecureStore.setItemAsync(CCTV_USERNAME_KEY, credentials.username),
    SecureStore.setItemAsync(CCTV_PASSWORD_KEY, credentials.password),
  ]);
}

export async function loadCctvCredentials(): Promise<CctvCredentials | null> {
  const [name, url, username, password] = await Promise.all([
    SecureStore.getItemAsync(CCTV_NAME_KEY),
    SecureStore.getItemAsync(CCTV_URL_KEY),
    SecureStore.getItemAsync(CCTV_USERNAME_KEY),
    SecureStore.getItemAsync(CCTV_PASSWORD_KEY),
  ]);

  if (!name && !url && !username && !password) return null;
  return {
    name: name ?? '',
    url: url ?? '',
    username: username ?? '',
    password: password ?? '',
  };
}

export async function clearCctvCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CCTV_NAME_KEY),
    SecureStore.deleteItemAsync(CCTV_URL_KEY),
    SecureStore.deleteItemAsync(CCTV_USERNAME_KEY),
    SecureStore.deleteItemAsync(CCTV_PASSWORD_KEY),
  ]);
}
