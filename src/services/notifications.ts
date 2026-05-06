import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const SUMMARY_NOTIFICATION_ID = "haru-jeongri-daily-summary";
const SUMMARY_CHANNEL_ID = "daily-summary";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export type ReminderScheduleResult = {
  enabled: boolean;
  granted: boolean;
  message: string;
};

export async function scheduleDailySummaryReminder(hour: number, minute: number): Promise<ReminderScheduleResult> {
  if (Platform.OS === "web") {
    return {
      enabled: false,
      granted: false,
      message: "웹 미리보기에서는 알림 예약을 지원하지 않습니다. iOS/Android 앱에서 동작합니다."
    };
  }

  await ensureAndroidChannel();
  const granted = await ensureNotificationPermission();

  if (!granted) {
    await cancelDailySummaryReminder();
    return {
      enabled: false,
      granted: false,
      message: "알림 권한이 꺼져 있습니다. 기기 설정에서 알림을 허용해 주세요."
    };
  }

  await Notifications.cancelScheduledNotificationAsync(SUMMARY_NOTIFICATION_ID).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: SUMMARY_NOTIFICATION_ID,
    content: {
      title: "하루정리",
      body: "오늘 기록을 정리하고 내일 할 일을 가볍게 준비해보세요.",
      sound: "default"
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: SUMMARY_CHANNEL_ID,
      hour,
      minute
    }
  });

  return {
    enabled: true,
    granted: true,
    message: `${formatTime(hour, minute)}에 매일 요약 알림을 보냅니다.`
  };
}

export async function cancelDailySummaryReminder() {
  if (Platform.OS === "web") return;
  await Notifications.cancelScheduledNotificationAsync(SUMMARY_NOTIFICATION_ID).catch(() => undefined);
}

export async function getNotificationPermissionStatus() {
  if (Platform.OS === "web") return "web";
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.status;
}

async function ensureNotificationPermission() {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(SUMMARY_CHANNEL_ID, {
    name: "하루 요약",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0EA5A4"
  });
}

function formatTime(hour: number, minute: number) {
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}
