export function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatDateLabel(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

export function shortTime(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
