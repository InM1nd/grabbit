# Grabbit

Grabbit is an Android app for saving posts from Instagram, TikTok, YouTube, X, Reddit and any website, Pinterest-style. Share a link to Grabbit and it is saved in one tap. The app fetches a preview, and AI (Google Gemini) writes a short description, adds tags and files the post on a board. Everything is stored on your phone.

Built with Expo / React Native and TypeScript. UI languages: Russian, English, Ukrainian.

## Features
- Save from the system **Share** menu: links, or screenshots that AI reads for you.
- Previews from oEmbed, OpenGraph, JSON-LD and embed pages.
- AI titles, descriptions, tags, board suggestions and semantic search via a small rate-limited proxy (`server/`). You can also use your own Gemini key.
- Optional Instagram login, only for private posts. It happens on the official instagram.com page, and the session stays on the phone.
- Boards, search, notes, reminders, JSON export/import, light and dark themes.
- In-app updates from this repository's GitHub Releases.

## Privacy
See [docs/PRIVACY.md](docs/PRIVACY.md). There are no accounts, ads or analytics; only anonymous crash reports (Sentry) without post content.

## Development
Developer notes (in Russian) are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Release history is in [RELEASE_NOTES.md](RELEASE_NOTES.md).

## License
**All rights reserved.** The source code is published for reference only. You may not use, copy, modify, distribute it, or publish builds of it without prior written permission from the author. See [LICENSE](LICENSE).
