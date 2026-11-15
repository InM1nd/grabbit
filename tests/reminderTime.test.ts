import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRediscoveryReminder, parseReminderTime, postReminderId, REDISCOVERY_ID, reminderInputValue, reminderPreset } from '../src/core/reminderTime';

test('presets use the local calendar and roll from Sunday night to Saturday', () => {
  const sunday = new Date(2026, 10, 15, 20);
  assert.equal(reminderPreset('tomorrow', sunday), new Date(2026, 10, 16, 19).getTime());
  assert.equal(reminderPreset('weekend', sunday), new Date(2026, 10, 21, 19).getTime());
});
test('custom reminders reject past and impossible dates and round-trip local time', () => {
  const now = new Date(2026, 0, 1).getTime();
  assert.equal(parseReminderTime('2026-02-30 19:00', now), null);
  assert.equal(parseReminderTime('2025-12-31 23:59', now), null);
  assert.equal(parseReminderTime('2026-02-15 24:00', now), null);
  assert.equal(parseReminderTime(reminderInputValue(new Date(2026, 1, 15, 19, 1).getTime()), now), new Date(2026, 1, 15, 19, 1).getTime());
});
test('refreshing rediscovery can cancel legacy reminders without cancelling explicit reminders', () => {
  assert.equal(isRediscoveryReminder({ identifier: REDISCOVERY_ID, content: {} }), true);
  assert.equal(isRediscoveryReminder({ identifier: 'legacy', content: { data: { postId: 42 } } }), true);
  assert.equal(isRediscoveryReminder({ identifier: postReminderId(42), content: { data: { postId: 42 } } }), false);
});
