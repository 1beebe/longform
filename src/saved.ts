// What the save confirmation shows, built from the createPost payload.
import type { CreatedPost } from "./buffer";
import { serviceName } from "./suggest";
import { validZone } from "./time";

// Channel drafts in Buffer's publish app, the view you get by clicking that
// channel in the sidebar and opening the Drafts tab.
//
// Verified against the Wayback CDX index of publish.buffer.com (status 200
// through 2025-08, and real visits all through 2026, which the auth wall
// records as 302s to login with this path preserved):
//   https://publish.buffer.com/channels/{channelId}/schedule?tab=drafts
// alongside the same page with tab=queue and tab=sent.
// The unfiltered list is https://publish.buffer.com/schedule?tab=drafts
// (and, through 2025, /all-channels?tab=drafts). That tab opens on the
// Unscheduled group, so dated drafts are easy to miss.
// Not used, because the channel URL above is stable: calendar week links such
// as /channels/{id}/calendar/week?date={epoch ms} and
// /calendar/week?channels[]={id}&date={epoch ms}.
export function channelDraftsUrl(channelId: string): string {
  return `https://publish.buffer.com/channels/${encodeURIComponent(channelId)}/schedule?tab=drafts`;
}

const FIRST_LINE = 64;

export function firstLine(text: string, max = FIRST_LINE): string {
  const line = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  const clean = line.replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trimEnd()}...`;
}

// "Mon Nov 30, 10:00 AM" in the account timezone the rest of the planner uses.
export function formatSavedWhen(dueAt: string, timeZone: string): string {
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) return dueAt;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const period = get("dayPeriod").replace(/\./g, "").toUpperCase();
  const ampm = period.startsWith("A") ? "AM" : period.startsWith("P") ? "PM" : period;
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${ampm}`;
}

export interface DraftFallback {
  channelId: string;
  service: string;
  channelName: string;
  dueAt: string;
  text: string;
}

export interface SavedDraft {
  id: string;
  dueAt: string;
  channelId: string;
  service: string;
  serviceLabel: string;
  channelName: string;
  text: string;
  href: string;
  line: string;
}

// Prefer the post Buffer returned. fallback is only for a field the payload omitted.
export function toSavedDraft(post: CreatedPost, timeZone: string, fallback?: DraftFallback): SavedDraft {
  const channel = post.channel;
  const channelId = post.channelId || channel?.id || fallback?.channelId || "";
  const service = channel?.service || post.channelService || fallback?.service || "";
  const serviceLabel = serviceName(service);
  const fromApi = (channel?.displayName || channel?.name || "").trim();
  const channelName = fromApi || (fallback?.channelName || "").trim() || serviceLabel;
  const dueAt = post.dueAt || fallback?.dueAt || "";
  const text = post.text ?? fallback?.text ?? "";
  const who = channelName.toLowerCase() !== serviceLabel.toLowerCase() ? `${serviceLabel} · ${channelName}` : serviceLabel;
  const when = dueAt ? formatSavedWhen(dueAt, timeZone) : "";
  const line = [who, when, firstLine(text)].filter(Boolean).join(" · ");
  return {
    id: post.id,
    dueAt,
    channelId,
    service,
    serviceLabel,
    channelName,
    text,
    href: channelId ? channelDraftsUrl(channelId) : "https://publish.buffer.com/schedule?tab=drafts",
    line,
  };
}

export function orderSavedDrafts(drafts: SavedDraft[]): SavedDraft[] {
  return [...drafts].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.line.localeCompare(b.line));
}

// One link per channel, in the order the drafts were listed.
export function draftLinks(drafts: SavedDraft[]): SavedDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    if (!d.channelId || seen.has(d.channelId)) return false;
    seen.add(d.channelId);
    return true;
  });
}
