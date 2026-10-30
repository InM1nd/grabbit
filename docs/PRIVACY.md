# Grabbit — Политика конфиденциальности / Privacy Policy

_Обновлено / Updated: 2026-10-29 · версия приложения 1.7.0_

## Русский

**Что хранится на телефоне.** Все сохранённые посты, доски, заметки, теги, превью и скриншоты хранятся только в памяти приложения на твоём устройстве (SQLite и файлы приложения). У нас нет серверной базы с твоими постами и нет аккаунтов.

**ИИ через прокси Grabbit.** Чтобы придумать название, описание, теги и сделать умный поиск, приложение отправляет на наш прокси (`grabbit-ai-proxy.vercel.app`, хостинг Vercel) текст поста (заголовок, описание, твою заметку) и, если текста мало или ты прикрепил скриншот, — картинку поста/скриншот. Прокси пересылает запрос в Google Gemini и возвращает ответ. Вместе с запросом передаётся случайный идентификатор устройства (UUID, создаётся при первом запуске) — только для дневных лимитов. Прокси не сохраняет тексты и картинки; хранятся лишь счётчики запросов на идентификатор за сутки. Данные обрабатывает Google по условиям Gemini API.

**Свой ключ Gemini (необязательно).** Если ты укажешь свой ключ, он хранится в защищённом хранилище телефона, а запросы идут напрямую в Google, минуя прокси.

**Вход в Instagram (необязательно).** Нужен только для чтения закрытых постов; публичные читаются без входа. Вход происходит на официальной странице instagram.com во встроенном браузере. Мы не видим и не получаем пароль. Cookie сессии хранятся только в браузере приложения на телефоне и используются только для загрузки постов, которые ты сам сохранил. Кнопка «Выйти из Instagram» в настройках удаляет cookie и данные браузера приложения.

**Прочее.** Нет рекламы, аналитики и трекеров. Уведомления — локальные. Проверка обновлений обращается к GitHub Releases. Удаление приложения удаляет все его данные.

### Отчёты о сбоях (Sentry)
Начиная с версии 1.9.0 приложение отправляет в Sentry (sentry.io) отчёты только о сбоях и ошибках: тип ошибки, текст ошибки (ссылки и e-mail вырезаются), стек вызовов, версию приложения, модель устройства и версию Android. Не отправляются: содержимое постов, подписи, ссылки, заметки, скриншоты, история действий и навигации, IP-адрес (не сохраняется), идентификатор пользователя или устройства. Замеры производительности и запись сессий выключены.

## English

**Stored on your phone.** All saved posts, boards, notes, tags, previews and screenshots live only in the app's storage on your device (SQLite and app files). There is no server database of your posts and no accounts.

**AI via the Grabbit proxy.** To generate titles, descriptions, tags and semantic search, the app sends the post text (title, description, your note) and — when text is scarce or you attached a screenshot — the post image/screenshot to our proxy (`grabbit-ai-proxy.vercel.app`, hosted on Vercel). The proxy forwards it to Google Gemini and returns the answer. A random device ID (UUID created on first launch) is sent along, used only for daily limits. The proxy does not store texts or images; only per-ID daily request counters are kept. Google processes the data under the Gemini API terms.

**Your own Gemini key (optional).** If you set one, it is kept in the phone's secure storage and requests go directly to Google, bypassing the proxy.

**Instagram login (optional).** Only needed to read private posts; public posts work without it. You log in on the official instagram.com page in an in-app web view. We never see or receive your password. Session cookies stay only in the app's web view on your phone and are used only to load posts you saved. "Log out of Instagram" in Settings deletes the cookies and the app's web data.

**Other.** No ads, analytics or trackers. Notifications are local. Update checks contact GitHub Releases. Uninstalling the app deletes all its data.

### Crash reports (Sentry)
Since 1.9.0 the app sends crash and error reports only to Sentry (sentry.io): error type, error message (URLs and e-mails stripped), stack trace, app version, device model and Android version. Not sent: post content, captions, links, notes, screenshots, action/navigation history, IP address (not stored), any user or device ID. Performance tracing and session replay are disabled.

