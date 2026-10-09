# Полка

Android-приложение (Expo SDK 57 / React Native, TypeScript) — органайзер постов из соцсетей в стиле Pinterest.

## Что умеет
- Появляется в меню «Поделиться»: ссылка из Instagram, TikTok, YouTube/Shorts, X, Reddit или с любого сайта сохраняется сразу, после чего приложение возвращает тебя назад.
- Подтягивает превью: oEmbed / OpenGraph / embed-страницы. Если сайт заблокировал доступ, ссылка всё равно сохраняется.
- Gemini пишет короткое описание на русском, ставит теги и кладёт пост на доску: существующую или новую.
- Без сети пост встаёт в очередь, ИИ-обработка повторяется с backoff.
- Лента-плитка, доски, поиск по заголовку, описанию и тегам, карточка поста: открыть оригинал, сменить доску, править теги, удалить.
- Локальное напоминание о посте, который сохранён 7+ дней назад и ни разу не открыт.
- Всё хранится только на телефоне (SQLite).

## Структура
- `src/core/` — логика без React Native (url, metadata, ai), её можно тестировать в node.
- `src/db.ts` — SQLite; `src/processor.ts` — очередь (метаданные → кэш превью → Gemini); `src/reminders.ts` — уведомления.
- `src/ui/` — экраны; `App.tsx` — корень, приём share-intent.
- `scripts/test-pipeline.ts` — проверка метаданных и Gemini на реальных ссылках.
- `scripts/configure-android.sh` — локальные настройки gradle после prebuild: подпись, R8, только arm64, сжатые .so.

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
npx tsx scripts/test-pipeline.ts                 # метаданные + Gemini на реальных ссылках
npx tsx scripts/test-pipeline.ts --no-ai <url>   # только метаданные
```

## Сборка APK (локально, без EAS)
```bash
npx expo prebuild --platform android --clean --no-install
./scripts/configure-android.sh
cd android && NODE_ENV=production ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk (~14 МБ)
```
Ключ Gemini вшивается в APK (`extra.geminiApiKey`), так что APK не стоит публиковать.

## Модель
По умолчанию `gemini-3.5-flash`, запасные — `gemini-flash-lite-latest` и `gemini-flash-latest` (`src/core/ai.ts`).
