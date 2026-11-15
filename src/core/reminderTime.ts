export function reminderPreset(preset: 'tomorrow' | 'weekend', now = new Date()): number {
  const date = new Date(now);
  date.setHours(19, 0, 0, 0);
  if (preset === 'tomorrow') {
    date.setDate(date.getDate() + 1);
  } else {
    while (date <= now || (date.getDay() !== 0 && date.getDay() !== 6)) {
      date.setDate(date.getDate() + 1);
    }
  }
  return date.getTime();
}

export function parseReminderTime(text: string, now = Date.now()): number | null {
  const fields = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!fields) return null;
  const [year, month, day, hour, minute] = fields.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getTime() <= now) return null;
  return date.getTime();
}

export function reminderInputValue(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join('-') + ' ' + [p(d.getHours()), p(d.getMinutes())].join(':');
}

export const postReminderId = (id: number) => 'grabbit:post:' + id;
export const REDISCOVERY_ID = 'grabbit:rediscovery';

export function isRediscoveryReminder(request: { identifier: string; content: { data?: Record<string, unknown> } }): boolean {
  return request.identifier === REDISCOVERY_ID ||
    (!request.identifier.startsWith('grabbit:') && request.content.data?.reminderKind == null && typeof request.content.data?.postId === 'number');
}
