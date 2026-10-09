# Pinbox

Android-приложение (Expo SDK 57 / React Native, TypeScript) — органайзер постов из соцсетей в стиле Pinterest. Название английское, интерфейс на русском.

## Что умеет
- Появляется в меню «Поделиться»: ссылка из Instagram, TikTok, YouTube/Shorts, X, Reddit или с любого сайта сохраняется сразу. Внизу появляется строка «Сохранено → доска · Изменить», затем приложение возвращает тебя назад (задержку можно настроить).
- Подтягивает превью: oEmbed / OpenGraph / JSON-LD / embed-страницы. Если сайт закрыл доступ, ссылка всё равно сохраняется.
- Gemini пишет короткое описание (на русском, английском или языке поста), ставит теги и кладёт пост на доску: существующую или новую. Если подпись пустая, может разобрать картинку превью.
- **Закрытые посты Instagram**: в настройках есть «Войти в Instagram» (обычный вход через WebView, cookie хранятся только на телефоне). Если пост недоступен публично, приложение открывает его в скрытом WebView с твоей сессией, достаёт подпись, автора и превью (API / встроенный JSON / og-теги / DOM) и отдаёт ИИ. Запасной вариант — заметка к посту.
- Без сети пост встаёт в очередь, ИИ-обработка повторяется с backoff.
- Минималистичная лента-плитка: свайп влево удаляет (с «Отменить»). Ещё есть доски, поиск по заголовку, описанию, тегам и заметкам, карточка поста.
- Настройки:
  - тема (системная / светлая / тёмная);
  - ИИ вкл/выкл, язык описаний, анализ превью;
  - доска по умолчанию;
  - автовозврат;
  - напоминания (время, частота, возраст поста);
  - Instagram;
  - экспорт и импорт JSON;
  - очистка кэша.
- Всё хранится только на телефоне (SQLite).

## Структура
- `src/core/` — логика без React Native (url, metadata, ai, igExtract), её можно тестировать в node.
- `src/db.ts` — SQLite.
- `src/processor.ts` — очередь: метаданные → сессия Instagram → кэш превью → Gemini.
- `src/settings.ts` — настройки.
- `src/reminders.ts` — уведомления.
- `src/backup.ts` — экспорт и импорт.
- `src/igSession.ts` и `src/ui/InstagramWeb.tsx` — вход в Instagram и скрытый загрузчик.
- `src/ui/` — экраны.
- `App.tsx` — корень приложения, приём share-intent.
- `tests/` — тесты извлечения из Instagram на сохранённом HTML/JSON.
- `scripts/test-pipeline.ts` — проверка метаданных и Gemini на реальных ссылках.
- `scripts/inject-smoke.ts` — прогон инжект-скрипта в headless Chrome.
- `scripts/configure-android.sh` — настройки gradle после prebuild: подпись, R8, только arm64, сжатые .so.

## Подготовка
Нужны Node 20+, JDK 17 и Android SDK (platform 36, build-tools 36, NDK 27).
```bash
npm install
cp .env.example .env          # впиши GEMINI_API_KEY
export $(grep -v '^#' .env | xargs)
```
Ключ подписи положи в `keystore/` (см. `keystore/README.md`).

## Проверка логики
```bash
npx tsc --noEmit
npx tsx --test tests/igExtract.test.ts
npx tsx scripts/test-pipeline.ts                 # метаданные + Gemini на реальных ссылках
npx tsx scripts/test-pipeline.ts --no-ai <url>   # только метаданные
```

## Сборка APK (локально, без EAS)
```bash
npx expo prebuild --platform android --clean --no-install
./scripts/configure-android.sh
cd android && NODE_ENV=production ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```
Пакет — `com.zabolotny.polka`, поэтому новая версия ставится поверх старой «Полки» (подпись та же).
Ключ Gemini вшивается в APK (`extra.geminiApiKey`), так что APK нельзя публиковать открыто.

## Модель
По умолчанию `gemini-3.5-flash`, запасные — `gemini-flash-lite-latest` и `gemini-flash-latest` (`src/core/ai.ts`).
