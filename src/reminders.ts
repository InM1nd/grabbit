import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as db from './db';

const DAY = 86_400_000;
const AGE_MS = 7 * DAY;          // remind about saves older than a week
const MIN_GAP_MS = 2 * DAY;      // at most one reminder every two days
const REPEAT_AFTER_MS = 21 * DAY; // don't nag about the same post again for 3 weeks
const HOUR = 19;                  // fire in the evening

export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Напоминания о сохранённом',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function ensurePermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  const asked = await db.getSetting('notif_asked');
  if (asked) return false;
  await db.setSetting('notif_asked', '1');
  const r = await Notifications.requestPermissionsAsync();
  return r.granted;
}

export async function remindersEnabled() {
  return (await db.getSetting('reminders')) !== 'off';
}
export async function setRemindersEnabled(on: boolean) {
  await db.setSetting('reminders', on ? 'on' : 'off');
  await rescheduleReminder();
}

/** Next evening slot (19:00) at or after t. */
function eveningAtOrAfter(t: number): number {
  const d = new Date(t);
  d.setHours(HOUR, 0, 0, 0);
  if (d.getTime() < t) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/**
 * Keeps exactly one local notification scheduled: about the oldest save that is
 * 7+ days old and was never opened. Called on app start / background / data changes.
 */
export async function rescheduleReminder() {
  try {
    const now = Date.now();
    // book-keeping: the previously scheduled reminder has fired already
    const prevId = Number(await db.getSetting('rem_post'));
    const prevAt = Number(await db.getSetting('rem_at'));
    if (prevId && prevAt && prevAt <= now) {
      await db.updatePost(prevId, { reminded_at: prevAt });
      await db.setSetting('rem_last_fired', String(prevAt));
      await db.setSetting('rem_post', null);
      await db.setSetting('rem_at', null);
    }
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!(await remindersEnabled())) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    const lastFired = Number(await db.getSetting('rem_last_fired')) || 0;
    const candidates = (await db.unopenedPosts()).filter((p) => !p.remindedAt || now - p.remindedAt > REPEAT_AFTER_MS);
    if (!candidates.length) return;
    // oldest first; the post becomes eligible once it is AGE_MS old
    const post = candidates[0];
    const earliest = Math.max(post.createdAt + AGE_MS, lastFired + MIN_GAP_MS, now + 30 * 60_000);
    const at = eveningAtOrAfter(earliest);
    const days = Math.max(7, Math.round((at - post.createdAt) / DAY));
    const title = post.aiTitle || post.title || post.url;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Ты сохранил это ${days} ${plural(days, 'день', 'дня', 'дней')} назад 👀`,
        body: `${title}${post.summary ? ' — ' + post.summary.slice(0, 120) : ''}`,
        data: { postId: post.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: 'reminders' },
    });
    await db.setSetting('rem_post', String(post.id));
    await db.setSetting('rem_at', String(at));
  } catch (e) {
    console.warn('reminder', e);
  }
}
