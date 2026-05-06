import type { DayAnalysis, DayRecord, Expense, Mood, Todo } from "../types/app";
import { sum } from "./format";

const expenseHints = [
  "점심",
  "아침",
  "저녁",
  "커피",
  "카페",
  "택시",
  "교통",
  "편의점",
  "배달",
  "간식",
  "쇼핑",
  "구독",
  "책",
  "약",
  "병원"
];

const taskHints = [
  "해야",
  "할 일",
  "연락",
  "마무리",
  "끝내",
  "제출",
  "예약",
  "확인",
  "정리",
  "공부",
  "운동",
  "약속"
];

const wasteHints = ["유튜브", "숏츠", "릴스", "게임", "늦잠", "미룸", "미뤘", "낭비", "멍때"];

const moodDictionary: Array<{ words: string[]; label: string; score: number; detail: string }> = [
  { words: ["피곤", "지침", "힘듦", "졸림"], label: "피로", score: 35, detail: "회복 시간이 필요한 신호가 있습니다." },
  { words: ["불안", "걱정", "초조"], label: "불안", score: 42, detail: "일정 부담이나 미해결 일이 마음을 누르는 흐름입니다." },
  { words: ["좋", "뿌듯", "행복", "만족"], label: "안정", score: 78, detail: "긍정적인 에너지가 남아 있습니다." },
  { words: ["짜증", "화남", "답답"], label: "긴장", score: 38, detail: "자극이 컸던 하루로 보입니다." },
  { words: ["우울", "무기력", "슬픔"], label: "저하", score: 30, detail: "가벼운 루틴부터 다시 잡는 편이 좋겠습니다." }
];

function id(prefix: string, index: number) {
  return `${prefix}-${Date.now()}-${index}`;
}

function normalizeAmount(raw: string, unit?: string) {
  const value = Number(raw.replace(/,/g, ""));
  if (unit === "만원") return value * 10000;
  if (unit === "천원") return value * 1000;
  return value;
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromMonthDay(month: number, day: number, baseDate = new Date()) {
  const candidate = new Date(baseDate.getFullYear(), month - 1, day);
  if (Number.isNaN(candidate.getTime())) return dateKeyFromDate(baseDate);
  return dateKeyFromDate(candidate);
}

function resolveDateKey(text: string, baseDate = new Date()) {
  const normalized = text.replace(/\s+/g, " ");
  const fullDate = normalized.match(/(20\d{2})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
  if (fullDate) {
    return dateKeyFromDate(new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3])));
  }

  const monthDay = normalized.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (monthDay) {
    return dateKeyFromMonthDay(Number(monthDay[1]), Number(monthDay[2]), baseDate);
  }

  if (normalized.includes("그제") || normalized.includes("그저께")) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - 2);
    return dateKeyFromDate(date);
  }

  if (normalized.includes("어제")) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - 1);
    return dateKeyFromDate(date);
  }

  if (normalized.includes("내일")) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + 1);
    return dateKeyFromDate(date);
  }

  return dateKeyFromDate(baseDate);
}

function splitSentences(text: string) {
  return text
    .split(/[.!?\n]|고\s|,\s?/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectLabel(context: string) {
  const direct = expenseHints.find((hint) => context.includes(hint));
  if (direct) return direct;
  if (context.includes("썼") || context.includes("지출")) return "기타 지출";
  return "지출";
}

function parseExpenses(text: string): Expense[] {
  const matches = Array.from(text.matchAll(/([가-힣A-Za-z0-9\s]{0,12}?)(\d{1,3}(?:,\d{3})*|\d+)\s*(만원|천원|원)/g));
  const seen = new Set<string>();
  const baseDate = new Date();

  return matches
    .map((match, index) => {
      const context = match[1] ?? "";
      const amount = normalizeAmount(match[2], match[3]);
      const label = detectLabel(context);
      const dateWindow = text.slice(Math.max((match.index ?? 0) - 36, 0), (match.index ?? 0) + match[0].length + 16);
      const dateKey = resolveDateKey(dateWindow, baseDate);
      const key = `${dateKey}-${label}-${amount}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: id("expense", index),
        label,
        amount,
        confidence: label === "지출" ? 0.62 : 0.86,
        dateKey
      };
    })
    .filter(Boolean) as Expense[];
}

function cleanTask(sentence: string) {
  return sentence
    .replace(/오늘|내일|요즘|좀|못|했음|해야 함|해야함|할 것|할 일/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTodos(text: string): Todo[] {
  const sentences = splitSentences(text);
  const rawTodos = sentences.filter((sentence) => taskHints.some((hint) => sentence.includes(hint)));
  const refined = rawTodos
    .map(cleanTask)
    .map((task) => {
      if (task.includes("친구") && task.includes("약속")) return "친구에게 약속 연락하기";
      if (task.includes("과제")) return "과제 마무리하기";
      if (task.includes("운동")) return "가벼운 운동하기";
      return task.length > 2 ? task : "중요한 일 하나 처리하기";
    });

  return Array.from(new Set(refined)).slice(0, 6).map((title, index) => ({
    id: id("todo", index),
    title,
    done: false,
    source: "ai",
    dateKey: resolveDateKey(rawTodos[index] ?? title)
  }));
}

function parseMoods(text: string): Mood[] {
  const moods = moodDictionary.filter((item) => item.words.some((word) => text.includes(word)));
  const dateKey = resolveDateKey(text);
  if (moods.length === 0) {
    return [
      {
        label: "보통",
        score: 58,
        detail: "감정 표현이 적어 무난한 하루로 분류했습니다.",
        dateKey
      }
    ];
  }

  return moods.map(({ label, score, detail }) => ({ label, score, detail, dateKey }));
}

function parseWaste(text: string) {
  return wasteHints.filter((hint) => text.includes(hint)).map((hint) => {
    if (hint === "유튜브" || hint === "숏츠" || hint === "릴스") return "짧은 영상 시청 시간이 길었을 가능성";
    if (hint.includes("미")) return "중요한 일을 미룬 흐름";
    return `${hint} 관련 시간 사용`;
  });
}

function parseNotes(text: string, todos: Todo[]) {
  const sentences = splitSentences(text);
  const taskTitles = todos.map((todo) => todo.title);
  const notes = sentences
    .filter((sentence) => !taskHints.some((hint) => sentence.includes(hint)))
    .filter((sentence) => !/\d{1,3}(?:,\d{3})*|\d+\s*(만원|천원|원)/.test(sentence))
    .filter((sentence) => !moodDictionary.some((mood) => mood.words.some((word) => sentence.includes(word))))
    .filter((sentence) => !taskTitles.some((title) => sentence.includes(title)));

  return notes.slice(0, 4);
}

function buildTomorrowPlan(expenses: Expense[], todos: Todo[], moods: Mood[], wastes: string[]) {
  const plan = todos.slice(0, 3).map((todo) => todo.title);
  if (expenses.some((expense) => ["커피", "카페"].includes(expense.label))) {
    plan.push("커피 지출은 한 번만 쓰기");
  }
  if (moods.some((mood) => mood.label === "피로")) {
    plan.push("밤 12시 전 취침 준비하기");
  }
  if (wastes.length > 0) {
    plan.push("짧은 영상은 20분 타이머로 제한하기");
  }
  if (plan.length === 0) {
    plan.push("오전 첫 30분에 가장 중요한 일 하나 끝내기");
  }
  return Array.from(new Set(plan)).slice(0, 5);
}

function compareWithHistory(totalExpense: number, history: DayRecord[]) {
  const previousTotals = history.slice(0, 7).map((record) => sum(record.analysis.expenses.map((expense) => expense.amount)));
  if (previousTotals.length === 0) return "첫 기록이라 기준을 만들고 있습니다.";
  const average = sum(previousTotals) / previousTotals.length;
  if (totalExpense > average * 1.15) return "평소보다 지출이 높은 편입니다.";
  if (totalExpense < average * 0.85) return "평소보다 지출을 잘 줄인 하루입니다.";
  return "평소와 비슷한 지출 흐름입니다.";
}

export function analyzeLocally(text: string, history: DayRecord[]): DayAnalysis {
  const expenses = parseExpenses(text);
  const todos = parseTodos(text);
  const moods = parseMoods(text);
  const wasteSignals = Array.from(new Set(parseWaste(text)));
  const notes = parseNotes(text, todos);
  const totalExpense = sum(expenses.map((expense) => expense.amount));
  const spendingTone = totalExpense > 0 ? compareWithHistory(totalExpense, history) : "소비 기록은 아직 없습니다.";
  const todoTone = todos.length > 0 ? `${todos.length}개의 할 일이 잡혔습니다.` : "내일로 넘길 일이 뚜렷하지 않습니다.";
  const moodTone = moods[0]?.label === "보통" ? "감정 변화는 크지 않아 보입니다." : `${moods[0].label} 신호가 있습니다.`;

  return {
    summary: `${spendingTone} ${todoTone} ${moodTone}`,
    expenses,
    todos,
    moods,
    notes,
    tomorrowPlan: buildTomorrowPlan(expenses, todos, moods, wasteSignals),
    wasteSignals,
    createdAt: new Date().toISOString()
  };
}
