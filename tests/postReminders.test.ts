// @ts-nocheck
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(process.cwd() + '/package.json');
const ids = new Map();
const posts = [{ id: 7, title: 'Pasta', createdAt: Date.now() }, { id: 8, title: 'Walk', createdAt: Date.now() }];
const settings = new Map();
let rediscoveryEnabled = true;

const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('expo-notifications', {
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler() {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  getAllScheduledNotificationsAsync: async () => Array.from(ids.values()),
  scheduleNotificationAsync: async (request) => { ids.set(request.identifier, request); return request.identifier; },
  cancelScheduledNotificationAsync: async (id) => { ids.delete(id); },
});
stub('react-native', { Platform: { OS: 'android' } });
stub('./src/settings.ts', {
  getSettings: () => ({ remOn: rediscoveryEnabled, remAgeDays: 7, remEveryDays: 2, remHour: 19 }),
  loadSettings: async () => {},
});
stub('./src/db.ts', {
  getPost: async (id) => posts.find((post) => post.id === id),
  unopenedPosts: async () => posts,
  getSetting: async (key) => settings.get(key),
  setSetting: async (key, value) => { settings.set(key, value); },
});
stub('./src/i18n.ts', { t: (s) => s, daysPhrase: (days) => String(days) });
const { cancelPostReminder, getPostReminder, schedulePostReminder, rescheduleReminder } = require('./src/reminders.ts');
const { postReminderId, REDISCOVERY_ID } = require('./src/core/reminderTime.ts');

test('explicit reminders can be moved or cancelled and survive rediscovery refresh', async () => {
  ids.set('legacy', { identifier: 'legacy', content: { data: { postId: 8 } } });
  const at = Date.now() + 10 * 60_000;
  assert.equal(await schedulePostReminder(posts[0], at), true);
  await rescheduleReminder();
  assert.equal(ids.has('legacy'), false);
  assert.equal(ids.get(REDISCOVERY_ID).content.data.postId, 8);
  assert.equal(await getPostReminder(7), at);

  assert.equal(await schedulePostReminder(posts[0], at + 60_000), true);
  assert.equal(await schedulePostReminder(posts[1], at), true);
  rediscoveryEnabled = false;
  await rescheduleReminder();
  assert.deepEqual([...ids.keys()].sort(), [postReminderId(7), postReminderId(8)]);
  assert.equal(await getPostReminder(7), at + 60_000);

  await cancelPostReminder(7);
  assert.equal(await getPostReminder(7), null);
  assert.equal(await getPostReminder(8), at);
});
