# tatarverse.cc

Private Astro catalog of Tatar, Bashkir, and Crimean Tatar communities.
All rights reserved. Source code and project materials are not licensed for redistribution.

## Development

```sh
bun install
bun run dev
bun run check
bun run build
```

## Каталог из API (форк)

Центры живут в базе каталога на **api.tatarverse.cc** (заявки людей, модерация, история каждого центра), сайт
собирается из неё. Описание API — https://api.tatarverse.cc/docs/ (OpenAPI — https://api.tatarverse.cc/openapi.json).

- **Сборка.** `bun run build` сначала зовёт `bun run centers:sync` (`scripts/centers-from-api.ts`): все опубликованные
  центры на русском и английском (`GET /centers/export`, один запрос на язык) переписываются в
  `src/data/centers_formatted/*.mdx` и `src/data/centers_i18n/en/*.mdx` в том же виде, в каком их писали руками.
  Страницы, поиск, фильтры, RSS, статический API v1 и OG-картинки работают как раньше. Центр скрыли в модерации —
  его файл удаляется. API недоступно или пусто — остаются файлы прошлой выгрузки (предупреждение в логе);
  `TATARVERSE_API_STRICT=1` — падать. Выгрузка — не правка: после сборки эти файлы коммитить не обязательно.
- **Адрес API** — `TATARVERSE_API` для выгрузки и `PUBLIC_TATARVERSE_API` для браузера (по умолчанию оба —
  `https://api.tatarverse.cc`). Своя копия API для разработки: `TATARVERSE_API=http://localhost:5080/api/tatarverse`
  и `PUBLIC_TATARVERSE_API=http://localhost:5080/api/tatarverse`.
- **«Добавить центр»** — `/centers/suggest`, **«Предложить правку»** — `/centers/suggest?code=tbk-N` (кнопка в карточке
  центра): форма уходит в API заявкой с капчей Google (ключ — из `GET /config`), её проверяет модератор. При правке
  тексты сохраняются на языке страницы, остальные языки карточки не меняются. Код — `src/components/submit/`,
  `src/lib/client/submitForm.ts`, `src/lib/client/catalogApi.ts`.
- **«Мои заявки»** — `/my-submissions`: ключи заявок хранятся в браузере (localStorage), статус, причина отказа и
  отзыв — через API (`src/lib/client/mySubmissions.ts`).
- **Новые центры появляются после сборки**: одобрили заявку — центр есть в API сразу, а на сайте — со следующей
  сборкой и выкладкой.
- Правила места (`src/content.config.ts`): незнакомый регион России или новая страна из заявки — предупреждение в
  логе сборки, а не ошибка: данные проверены при модерации, справочник можно дополнить отдельно.

## Structure

- `src/pages/` — routes and static API endpoints
- `src/components/` — UI grouped by purpose
- `src/layouts/` — shared page layouts
- `src/lib/` — catalog logic, browser scripts, SEO and build integrations
- `src/data/` — catalog content and reference data
- `src/i18n/` — Russian and English UI dictionaries
- `src/styles/` — Tailwind v4 tokens, palettes and component styles
- `functions/` — Cloudflare Pages runtime handlers
- `public/` — public static assets
- `scripts/centers-from-api.ts` — выгрузка центров из API перед сборкой

Keep stable `tbk-*` URLs, localized routes and source references intact.
The static catalog API is documented in [docs/API.md](docs/API.md).
