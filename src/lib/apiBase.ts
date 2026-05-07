const runtimeEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

/**
 * 네이티브: EXPO_PUBLIC_AUTH_ENDPOINT 환경변수 사용
 * 웹 localhost: 로컬 개발 서버 (8787)
 * 웹 배포: 같은 origin의 /api
 */
export function getApiBase(): string {
  const explicit = runtimeEnv?.EXPO_PUBLIC_AUTH_ENDPOINT;
  if (explicit) return explicit.replace(/\/+$/, "");

  const loc = (globalThis as unknown as {
    location?: { protocol?: string; hostname?: string; host?: string };
  }).location;

  if (loc?.protocol?.startsWith("http") && loc.hostname && loc.host) {
    if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
      return `${loc.protocol}//${loc.hostname}:8787/api`;
    }
    return `${loc.protocol}//${loc.host}/api`;
  }

  return "";
}
