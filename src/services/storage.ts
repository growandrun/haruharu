import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultSettings } from "../data/sample";
import type { DayRecord, UserSettings } from "../types/app";

const RECORDS_KEY = "haru-jeongri:records";
const SETTINGS_KEY = "haru-jeongri:settings";
const STORAGE_VERSION_KEY = "haru-jeongri:storage-version";
const CURRENT_STORAGE_VERSION = "1";

export async function loadRecords(): Promise<DayRecord[]> {
  const stored = await AsyncStorage.getItem(RECORDS_KEY);
  if (!stored) {
    await AsyncStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
    return [];
  }

  const records = JSON.parse(stored) as DayRecord[];
  const userRecords = records.filter((record) => record.id !== "sample-record");

  if (userRecords.length !== records.length) {
    await saveRecords(userRecords);
  }

  return userRecords;
}

export async function saveRecords(records: DayRecord[]) {
  await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  await AsyncStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
}

export async function loadSettings(): Promise<UserSettings> {
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!stored) return defaultSettings;
  return { ...defaultSettings, ...(JSON.parse(stored) as Partial<UserSettings>) };
}

export async function saveSettings(settings: UserSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  await AsyncStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
}

export async function resetLocalData() {
  await AsyncStorage.multiRemove([RECORDS_KEY, SETTINGS_KEY, STORAGE_VERSION_KEY]);
}
