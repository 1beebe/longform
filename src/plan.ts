// The gap finder and the placement of suggested posts. Deterministic: no AI.
import type { Channel, QueueItem } from "./buffer";
import type { Plan, Role } from "./session";
import { addDays, daysBetween, localDate, weekday } from "./time";

export const WINDOW_START = 3; // the earliest publish day, in days from today
export const WINDOW_DAYS = 28;

export interface Slot {
  slot: number;
  role: Role;
  channelId: string;
  service: string;
  channelName: string;
  date: string;
}

// Where each role may land, in days from the publish day, nearest first.
const SHAPE: { role: Role; days: number[] }[] = [
  { role: "teaser", days: [-4, -5, -6, -3, -7] },
  { role: "teaser", days: [-1, -2, -3] },
  { role: "launch", days: [0] },
  { role: "pullquote", days: [1, 2] },
  { role: "keyidea", days: [2, 3, 4] },
  { role: "followup", days: [7, 6, 8] },
];

export type Busy = Map<string, QueueItem[]>; // date -> queued items that day

export function busyByDay(queue: QueueItem[], tz: string): Busy {
  const out: Busy = new Map();
  for (const q of queue) {
    const d = localDate(Date.parse(q.dueAt), tz);
    out.set(d, [...(out.get(d) ?? []), q]);
  }
  return out;
}

const count = (busy: Busy, d: string) => busy.get(d)?.length ?? 0;
const DAY_PENALTY = [2, 0, 0, 0, 2, 6, 6]; // Mon..Sun: Tue to Thu best, weekends last

export function score(busy: Busy, d: string): number {
  let s = DAY_PENALTY[weekday(d)] + count(busy, d) * 3;
  for (const k of [-2, -1, 1, 2]) s += count(busy, addDays(d, k));
  return s;
}

export function pickPublishDay(busy: Busy, today: string): string {
  let best = addDays(today, WINDOW_START);
  let bestScore = Infinity;
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = addDays(today, WINDOW_START + i);
    const s = score(busy, d);
    if (s < bestScore) { best = d; bestScore = s; }
  }
  return best;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function longDate(d: string): string {
  return `${DAYS[weekday(d)]}, ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}
function shortDate(d: string): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}
function span(a: string, b: string): string {
  if (a === b) return shortDate(a);
  return a.slice(0, 7) === b.slice(0, 7) ? `${shortDate(a)} to ${Number(b.slice(8))}` : `${shortDate(a)} to ${shortDate(b)}`;
}

// The "why" sentence, written from the queue itself.
export function reasonFor(busy: Busy, p: string, chosen: boolean): string {
  const lead = chosen ? `You picked ${longDate(p)}.` : `Publish ${longDate(p)}.`;
  const total = [...busy.values()].reduce((n, l) => n + l.length, 0);
  if (!total) return `${lead} Nothing is queued in Buffer for the next few weeks, so every day is open. This is the earliest Tuesday-to-Thursday slot with room for teasers before it.`;
  if (count(busy, p) === 0) {
    let a = p, b = p;
    while (count(busy, addDays(a, -1)) === 0 && daysBetween(addDays(a, -1), p) <= 6) a = addDays(a, -1);
    while (count(busy, addDays(b, 1)) === 0 && daysBetween(p, addDays(b, 1)) <= 6) b = addDays(b, 1);
    const around = [-2, -1, 1, 2].reduce((n, k) => n + count(busy, addDays(p, k)), 0);
    const tail = around ? "" : " The two days on either side are clear too.";
    return `${lead} Nothing is booked ${a === b ? `that day` : span(a, b)}, so the launch won't compete with posts you already have.${tail}`;
  }
  const n = count(busy, p);
  return `${lead} It's the quietest weekday in the window: ${n} post${n === 1 ? "" : "s"} queued that day, fewer than the days around it.`;
}

export function launchChannel(channels: Channel[]): Channel {
  return channels.find((c) => c.service === "linkedin") ?? channels[0];
}

export function placeholderChannel(channels: Channel[]): Channel | undefined {
  return channels.find((c) => c.service === "substack") ?? channels.find((c) => c.service === "linkedin") ?? channels[0];
}

// Place the six roles around the publish day. With `fixed`, each slot keeps
// its channel (the text was written for it) and only the dates move.
export function place(busy: Busy, channels: Channel[], p: string, today: string, fixed?: Slot[]): Slot[] {
  const taken = new Set<string>(); // `${date}|${channelId}` used by a suggestion
  const uses = new Map<string, number>();
  const out: Slot[] = [];
  const earliest = addDays(today, 1);
  SHAPE.forEach((shape, i) => {
    const keep = fixed?.find((f) => f.slot === i + 1);
    if (fixed && !keep) return;
    const options = keep ? channels.filter((c) => c.id === keep.channelId) : shape.role === "launch" ? [launchChannel(channels)] : channels;
    if (!options.length) return;
    let best: { date: string; ch: Channel; cost: number } | undefined;
    shape.days.forEach((k, rank) => {
      const date = addDays(p, k);
      if (date < earliest) return;
      for (const ch of options) {
        if (taken.has(`${date}|${ch.id}`)) continue;
        const day = busy.get(date) ?? [];
        const cost = rank * 0.6
          + (day.some((q) => q.channelId === ch.id) ? 5 : 0)
          + day.length
          + (weekday(date) >= 5 ? 4 : 0)
          + (uses.get(ch.id) ?? 0) * 1.5;
        if (!best || cost < best.cost) best = { date, ch, cost };
      }
    });
    if (!best) return;
    taken.add(`${best.date}|${best.ch.id}`);
    uses.set(best.ch.id, (uses.get(best.ch.id) ?? 0) + 1);
    out.push({ slot: i + 1, role: shape.role, channelId: best.ch.id, service: best.ch.service, channelName: best.ch.name, date: best.date });
  });
  return out;
}

// Drafts deleted in Buffer. A saved post that is dated after today and inside
// the calendar but no longer in the queue (drafts and scheduled posts) was
// deleted there, so it goes back to unsaved. Posts dated today or earlier may
// have been sent, and posts past the range aren't read, so those stay saved.
// Only trust a complete queue read. Returns how many came back.
export function forgetDeleted(plan: Plan, queue: QueueItem[], today: string, rangeEnd: string, complete: boolean): number {
  if (!complete) return 0;
  const live = new Set(queue.map((q) => q.id));
  const gone = (id: string | undefined, date: string) => Boolean(id) && date > today && date <= rangeEnd && !live.has(id!);
  let n = 0;
  for (const c of plan.suggestions) {
    if (gone(c.bufferId, c.date)) { c.bufferId = undefined; c.included = true; c.error = undefined; n++; }
  }
  if (gone(plan.placeholder.bufferId, plan.publishDate)) { plan.placeholder.bufferId = undefined; plan.placeholder.included = true; plan.placeholder.error = undefined; n++; }
  return n;
}
