// Tiny i18n: Russian source strings are the keys; EN/UK translations below.
import { getLocales } from 'expo-localization';

export type Lang = 'ru' | 'en' | 'uk';
let lang: Lang = 'ru';

// [ru (key), en, uk]
const T: [string, string, string][] = [
  ['Попробовать', 'Try it', 'Спробувати'],
  ['Сделано', 'Done', 'Зроблено'],
  ['Неважно', 'Not important', 'Неважливо'],
  ['Показать все', 'Show all', 'Показати всі'],
  ['Снять отметку', 'Clear mark', 'Зняти позначку'],
  ['Скрыто из ленты: «Неважно»', 'Hidden from feed: “Not important”', 'Приховано зі стрічки: «Неважливо»'],
  ['Похожие посты', 'Similar posts', 'Схожі пости'],
  ['по смыслу', 'by meaning', 'за змістом'],
  ['✨ Поиск по смыслу — самые близкие сверху', '✨ Search by meaning — closest first', '✨ Пошук за змістом — найближчі зверху'],
  ['Поиск по смыслу недоступен — ищу по словам', 'Search by meaning unavailable — searching by words', 'Пошук за змістом недоступний — шукаю за словами'],
  ['Спроси: «как монтировать видео»', 'Ask: “how to edit videos”', 'Запитай: «як монтувати відео»'],
  ['Здесь пока ничего', 'Nothing here yet', 'Тут поки нічого'],
  ['Долгое нажатие на карточку — отметить «Попробовать», «Сделано» или «Неважно».', 'Long-press a card to mark it “Try it”, “Done” or “Not important”.', 'Довге натискання на картку — позначити «Спробувати», «Зроблено» або «Неважливо».'],
  ['+ тег', '+ tag', '+ тег'],
  ['2 недель', '2 weeks', '2 тижнів'],
  ['2 с', '2 s', '2 с'],
  ['3 дней', '3 days', '3 днів'],
  ['5 с', '5 s', '5 с'],
  ['Instagram подключён', 'Instagram connected', 'Instagram підключено'],
  ['Instagram подключён — перечитываю {n}', 'Instagram connected — re-reading {n}', 'Instagram підключено — перечитую {n}'],
  ['{n} ждут обработки', '{n} waiting', '{n} чекають обробки'],
  ['Авто', 'Auto', 'Авто'],
  ['Авто — выбирает ИИ', 'Auto — AI decides', 'Авто — обирає ШІ'],
  ['Без доски: {n}', 'No board: {n}', 'Без дошки: {n}'],
  ['В Instagram, TikTok, YouTube или X нажми «Поделиться» → Grabbit. ИИ опишет пост и положит на доску.', 'In Instagram, TikTok, YouTube or X tap “Share” → Grabbit. AI will describe the post and put it on a board.', 'В Instagram, TikTok, YouTube або X натисни «Поділитися» → Grabbit. ШІ опише пост і покладе на дошку.'],
  ['В последнем релизе нет APK', 'The latest release has no APK', 'В останньому релізі немає APK'],
  ['В сообщении нет ссылки', 'No link in the message', 'У повідомленні немає посилання'],
  ['Вернуться в приложение', 'Return to the app', 'Повернутися до застосунку'],
  ['Версия {v}', 'Version {v}', 'Версія {v}'],
  ['Войти', 'Log in', 'Увійти'],
  ['Время', 'Time', 'Час'],
  ['Все', 'All', 'Усі'],
  ['Все посты, доски, теги и заметки', 'All posts, boards, tags and notes', 'Усі пости, дошки, теги й нотатки'],
  ['Вход в Instagram', 'Log in to Instagram', 'Вхід в Instagram'],
  ['Выйти', 'Log out', 'Вийти'],
  ['Выход из Instagram', 'Log out of Instagram', 'Вихід з Instagram'],
  ['Вышел из Instagram', 'Logged out of Instagram', 'Вийшов з Instagram'],
  ['Готово', 'Done', 'Готово'],
  ['Данные', 'Data', 'Дані'],
  ['Данные хранятся только на телефоне', 'Data stays on this phone', 'Дані зберігаються лише на телефоні'],
  ['Добавить заметку', 'Add note', 'Додати нотатку'],
  ['Добавить ссылку', 'Add link', 'Додати посилання'],
  ['Добавлено {a}, пропущено {s}', 'Added {a}, skipped {s}', 'Додано {a}, пропущено {s}'],
  ['Долгое нажатие — переименовать или удалить', 'Long press to rename or delete', 'Довге натискання — перейменувати або видалити'],
  ['Доска', 'Board', 'Дошка'],
  ['Доска по умолчанию', 'Default board', 'Дошка за замовчуванням'],
  ['Доски', 'Boards', 'Дошки'],
  ['Доступна версия {v}', 'Version {v} available', 'Доступна версія {v}'],
  ['Если подпись пустая, ИИ разберёт картинку', 'If the caption is empty, AI looks at the image', 'Якщо підпис порожній, ШІ розбере картинку'],
  ['Если такая доска уже есть, они объединятся.', 'If such a board exists, they will be merged.', 'Якщо така дошка вже є, вони об’єднаються.'],
  ['Есть новая версия', 'A new version is available', 'Є нова версія'],
  ['Ещё', 'More', 'Ще'],
  ['Жду Instagram-сессию', 'Waiting for Instagram session', 'Чекаю на сесію Instagram'],
  ['Закрытые посты: {n}', 'Private posts: {n}', 'Закриті пости: {n}'],
  ['Заметка', 'Note', 'Нотатка'],
  ['ИИ будет класть сюда подходящие посты.', 'AI will put matching posts here.', 'ШІ складатиме сюди відповідні пости.'],
  ['ИИ разбирает пост…', 'AI is reading the post…', 'ШІ розбирає пост…'],
  ['ИИ учтёт заметку и перепишет описание.', 'AI will use the note and rewrite the description.', 'ШІ врахує нотатку й перепише опис.'],
  ['ИИ-описания', 'AI descriptions', 'ШІ-описи'],
  ['Изменить', 'Change', 'Змінити'],
  ['Изменить заметку', 'Edit note', 'Змінити нотатку'],
  ['Импорт', 'Import', 'Імпорт'],
  ['Импорт из JSON', 'Import from JSON', 'Імпорт з JSON'],
  ['Как в посте', 'Post language', 'Як у пості'],
  ['Картинки будут грузиться из сети заново.', 'Images will be downloaded again.', 'Картинки завантажаться з мережі знову.'],
  ['Ключ Gemini не найден в сборке', 'No Gemini key in this build', 'Ключ Gemini не знайдено у збірці'],
  ['Кэш очищен', 'Cache cleared', 'Кеш очищено'],
  ['Лента', 'Feed', 'Стрічка'],
  ['Логин идёт прямо на instagram.com — Grabbit не видит пароль. Сессия хранится только на телефоне и нужна, чтобы читать посты закрытых аккаунтов, на которые ты подписан.', 'You log in directly on instagram.com — Grabbit never sees your password. The session stays on this phone and is used to read posts from private accounts you follow.', 'Вхід відбувається прямо на instagram.com — Grabbit не бачить пароль. Сесія зберігається лише на телефоні й потрібна, щоб читати пости закритих акаунтів, на які ти підписаний.'],
  ['Назад', 'Back', 'Назад'],
  ['Название', 'Name', 'Назва'],
  ['Напоминания', 'Reminders', 'Нагадування'],
  ['Напоминания о сохранённом', 'Saved-post reminders', 'Нагадування про збережене'],
  ['Напоминать о забытом', 'Remind about forgotten saves', 'Нагадувати про забуте'],
  ['Например: UI-идеи', 'E.g. UI ideas', 'Наприклад: UI-ідеї'],
  ['Настройки', 'Settings', 'Налаштування'],
  ['Не вышло', 'Failed', 'Не вийшло'],
  ['Не вышло — попробую позже', 'Failed — will retry later', 'Не вийшло — спробую пізніше'],
  ['Не подключён', 'Not connected', 'Не підключено'],
  ['Не удалось выйти', 'Could not log out', 'Не вдалося вийти'],
  ['Не удалось открыть ссылку', 'Could not open the link', 'Не вдалося відкрити посилання'],
  ['Не удалось проверить: {e}', 'Check failed: {e}', 'Не вдалося перевірити: {e}'],
  ['Не удалось скачать: {e}', 'Download failed: {e}', 'Не вдалося завантажити: {e}'],
  ['Не уходить', 'Stay', 'Не виходити'],
  ['Не чаще чем', 'At most', 'Не частіше ніж'],
  ['Нет доступа к релизам (приватный репозиторий)', 'No access to releases (private repository)', 'Немає доступу до релізів (приватний репозиторій)'],
  ['Нет ключа Gemini в сборке', 'No Gemini key in this build', 'Немає ключа Gemini у збірці'],
  ['Нет сети', 'Offline', 'Немає мережі'],
  ['Ничего не нашлось', 'Nothing found', 'Нічого не знайдено'],
  ['Новая доска', 'New board', 'Нова дошка'],
  ['Нужен, чтобы читать посты закрытых аккаунтов. Сессия хранится только на телефоне.', 'Needed to read posts from private accounts. The session stays on this phone.', 'Потрібен, щоб читати пости закритих акаунтів. Сесія зберігається лише на телефоні.'],
  ['О постах старше', 'For posts older than', 'Про пости, старші за'],
  ['О чём этот пост? Например: нейросеть для монтажа видео', 'What is this post about? E.g. AI tool for video editing', 'Про що цей пост? Наприклад: нейромережа для монтажу відео'],
  ['Обновить', 'Update', 'Оновити'],
  ['Обновление', 'Update', 'Оновлення'],
  ['Обновления', 'Updates', 'Оновлення'],
  ['Обновляю {n}…', 'Updating {n}…', 'Оновлюю {n}…'],
  ['Обрабатываю…', 'Processing…', 'Обробляю…'],
  ['Он пропадёт из ленты и досок.', 'It will disappear from the feed and boards.', 'Він зникне зі стрічки та дошок.'],
  ['Описание обновлено', 'Description updated', 'Опис оновлено'],
  ['Описывать посты ИИ', 'Describe posts with AI', 'Описувати пости ШІ'],
  ['Оригинал', 'Original', 'Оригінал'],
  ['Открыть в {p}', 'Open in {p}', 'Відкрити в {p}'],
  ['Открыть в браузере', 'Open in browser', 'Відкрити в браузері'],
  ['Открыть страницу релизов', 'Open releases page', 'Відкрити сторінку релізів'],
  ['Отмена', 'Cancel', 'Скасувати'],
  ['Отменить', 'Undo', 'Скасувати'],
  ['Оформление', 'Appearance', 'Вигляд'],
  ['Очередь', 'Queue', 'Черга'],
  ['Очистить', 'Clear', 'Очистити'],
  ['Очистить кэш превью', 'Clear preview cache', 'Очистити кеш прев’ю'],
  ['Очистить кэш превью?', 'Clear preview cache?', 'Очистити кеш прев’ю?'],
  ['Переименовать', 'Rename', 'Перейменувати'],
  ['Переименовать доску', 'Rename board', 'Перейменувати дошку'],
  ['Переописать с ИИ', 'Re-describe with AI', 'Переописати з ШІ'],
  ['Перечитать их через твою сессию', 'Re-read them with your session', 'Перечитати їх через твою сесію'],
  ['Повторить', 'Retry', 'Повторити'],
  ['Поделиться', 'Share', 'Поділитися'],
  ['Подключить Instagram', 'Connect Instagram', 'Підключити Instagram'],
  ['Подключён', 'Connected', 'Підключено'],
  ['Поиск', 'Search', 'Пошук'],
  ['Поиск: слово, тег, автор', 'Search: word, tag, author', 'Пошук: слово, тег, автор'],
  ['Пока пусто', 'Nothing here yet', 'Поки порожньо'],
  ['Попробуй другое слово или тег.', 'Try another word or tag.', 'Спробуй інше слово або тег.'],
  ['После «Поделиться»', 'After “Share”', 'Після «Поділитися»'],
  ['Пост закрыт: аккаунт приватный или нужен вход. Подключи Instagram или напиши пару слов — ИИ перепишет описание.', 'The post is private or needs a login. Connect Instagram or write a few words — AI will rewrite the description.', 'Пост закритий: акаунт приватний або потрібен вхід. Підключи Instagram або напиши кілька слів — ШІ перепише опис.'],
  ['Пост, рилс, видео или статья.', 'A post, reel, video or article.', 'Пост, рілс, відео або стаття.'],
  ['Посты останутся в ленте, просто без доски.', 'Posts stay in the feed, just without a board.', 'Пости залишаться у стрічці, просто без дошки.'],
  ['Про пост, который ты сохранил и не открыл', 'About a post you saved but never opened', 'Про пост, який ти зберіг і не відкрив'],
  ['Проверить обновления', 'Check for updates', 'Перевірити оновлення'],
  ['Проверять при запуске', 'Check on launch', 'Перевіряти під час запуску'],
  ['Пусто', 'Empty', 'Порожньо'],
  ['Раз в 2 дня', 'Every 2 days', 'Раз на 2 дні'],
  ['Раз в день', 'Daily', 'Раз на день'],
  ['Раз в неделю', 'Weekly', 'Раз на тиждень'],
  ['Разбираю…', 'Reading…', 'Розбираю…'],
  ['Разреши уведомления в настройках Android', 'Allow notifications in Android settings', 'Дозволь сповіщення в налаштуваннях Android'],
  ['Репозиторий приватный — скачай APK в браузере, войдя в GitHub', 'The repository is private — download the APK in a browser logged in to GitHub', 'Репозиторій приватний — завантаж APK у браузері, увійшовши в GitHub'],
  ['Русский', 'Russian', 'Російська'],
  ['Сайт почти ничего не отдал. Напиши пару слов о посте — ИИ перепишет описание.', 'The site returned almost nothing. Write a few words about the post — AI will rewrite the description.', 'Сайт майже нічого не віддав. Напиши кілька слів про пост — ШІ перепише опис.'],
  ['Светлая', 'Light', 'Світла'],
  ['Системный', 'System', 'Системна'],
  ['Скопировать ссылку', 'Copy link', 'Скопіювати посилання'],
  ['Смотреть на превью', 'Look at the preview', 'Дивитися на прев’ю'],
  ['Сохранено', 'Saved', 'Збережено'],
  ['Сохранено — ИИ разбирает', 'Saved — AI is on it', 'Збережено — ШІ розбирає'],
  ['Сохранить', 'Save', 'Зберегти'],
  ['Сразу', 'Instantly', 'Одразу'],
  ['Ссылка скопирована', 'Link copied', 'Посилання скопійовано'],
  ['Существующие ссылки не дублируются', 'Existing links are not duplicated', 'Наявні посилання не дублюються'],
  ['Тема', 'Theme', 'Тема'],
  ['Ты сохранил это {d} назад 👀', 'You saved this {d} ago 👀', 'Ти зберіг це {d} тому 👀'],
  ['Тёмная', 'Dark', 'Темна'],
  ['У тебя последняя версия', 'You have the latest version', 'У тебе остання версія'],
  ['Удалено', 'Deleted', 'Видалено'],
  ['Удалить', 'Delete', 'Видалити'],
  ['Удалить доску', 'Delete board', 'Видалити дошку'],
  ['Удалить доску?', 'Delete board?', 'Видалити дошку?'],
  ['Удалить пост?', 'Delete post?', 'Видалити пост?'],
  ['Удалить тег', 'Remove tag', 'Видалити тег'],
  ['Уже сохранено', 'Already saved', 'Вже збережено'],
  ['Установить', 'Install', 'Встановити'],
  ['Файл не от Grabbit', 'Not a Grabbit file', 'Файл не від Grabbit'],
  ['Файл повреждён (не JSON)', 'File is damaged (not JSON)', 'Файл пошкоджено (не JSON)'],
  ['Экспорт Grabbit', 'Grabbit export', 'Експорт Grabbit'],
  ['Экспорт в JSON', 'Export to JSON', 'Експорт у JSON'],
  ['Экспортировано: {n}', 'Exported: {n}', 'Експортовано: {n}'],
  ['Это не похоже на ссылку', 'That doesn’t look like a link', 'Це не схоже на посилання'],
  ['Это не файл экспорта Grabbit', 'This is not a Grabbit export file', 'Це не файл експорту Grabbit'],
  ['Язык интерфейса', 'App language', 'Мова інтерфейсу'],
  ['Язык описаний', 'Description language', 'Мова описів'],
  ['недели', 'a week', 'тижня'],
  ['✎ Заметка', '✎ Note', '✎ Нотатка'],
  ['＋  Новая доска', '＋  New board', '＋  Нова дошка'],
  ['＋ Доска', '＋ Board', '＋ Дошка'],
  ['Сайт', 'Website', 'Сайт'],
  ['только что', 'just now', 'щойно'],
  ['{n} мин назад', '{n} min ago', '{n} хв тому'],
  ['{n} ч назад', '{n} h ago', '{n} год тому'],
  ['{n} дн назад', '{n} d ago', '{n} дн тому'],
];

const DICT: Record<'en' | 'uk', Map<string, string>> = { en: new Map(), uk: new Map() };
for (const [ru, en, uk] of T) { DICT.en.set(ru, en); DICT.uk.set(ru, uk); }

export const I18N_TABLE = T; // for tests

export function setLang(l: Lang) { lang = l; }
export function getLang(): Lang { return lang; }

export function systemLang(): Lang {
  try {
    const code = (getLocales()[0]?.languageCode || '').toLowerCase();
    if (code === 'uk') return 'uk';
    if (code === 'ru' || code === 'be' || code === 'kk') return 'ru';
    return 'en';
  } catch { return 'ru'; }
}

export function resolveLang(pref: 'system' | Lang | undefined): Lang {
  return !pref || pref === 'system' ? systemLang() : pref;
}

export function t(ru: string, params?: Record<string, string | number>): string {
  let s = lang === 'ru' ? ru : DICT[lang].get(ru) ?? ru;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

export function daysPhrase(n: number): string {
  if (lang === 'en') return `${n} ${n === 1 ? 'day' : 'days'}`;
  if (lang === 'uk') return `${n} ${plural(n, 'день', 'дні', 'днів')}`;
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('только что');
  const m = Math.round(s / 60);
  if (m < 60) return t('{n} мин назад', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n} ч назад', { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t('{n} дн назад', { n: d });
  const locale = lang === 'en' ? 'en-GB' : lang === 'uk' ? 'uk-UA' : 'ru-RU';
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

// Language switch remounts the UI; reopen Settings afterwards.
let reopen = false;
export function markReopenSettings() { reopen = true; }
export function consumeReopenSettings(): boolean { const r = reopen; reopen = false; return r; }
