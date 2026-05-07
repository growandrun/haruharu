module.exports = {
  expo: {
    name: "하루정리",
    slug: "crak-nudalu",
    version: "0.1.0",
    description: "하루 기록을 소비, 할 일, 감정, 메모, 내일 계획으로 정리해주는 AI 생활 관리 앱",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "harujeongri",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["assets/**/*"],
    plugins: [
      [
        "expo-notifications",
        {
          color: "#0EA5A4",
          defaultChannel: "daily-summary"
        }
      ]
    ],
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#F5F8FA"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.haru.jeongri",
      buildNumber: "1",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      package: "com.haru.jeongri",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#F5F8FA"
      }
    },
    web: {
      bundler: "metro",
      favicon: "./assets/favicon.png",
      name: "하루정리",
      shortName: "하루정리",
      lang: "ko"
    },
    extra: {
      eas: {
        projectId: "ff9ffb50-d1f1-4041-9014-b991e2e57488"
      }
    },
    owner: "nudalu"
  }
};
