# Credits

Kinwall is built on other people's open-source work and open data. Thank you to everyone behind these projects. This page lists the ones you'd recognize and everything whose license asks for credit; the full dependency list is in `server/package.json` and `web/package.json`.

## Typefaces

Bundled in `web/src/fonts/` (each folder holds its license), from the [Fontsource](https://fontsource.org) builds. All are under the [SIL Open Font License 1.1](https://openfontlicense.org).

| Typeface | By |
|---|---|
| [Nunito](https://github.com/googlefonts/nunito) (Default) | Vernon Adams, Jacques Le Bailly and Manvel Shmavonyan |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (Hyperlegible) | [Braille Institute of America](https://www.brailleinstitute.org/freefont/) |
| [Lexend](https://www.lexend.com) (Dyslexia-friendly) | Bonnie Shaver-Troup and Thomas Jockin |
| [Figtree](https://github.com/erikdkennedy/figtree) (Modern) | Erik Kennedy |
| [Fredoka](https://github.com/hafontia/Fredoka-One) (Playful) | Milena Brandão |
| [Literata](https://github.com/googlefonts/literata) (Storybook) | TypeTogether |
| [Kalam](https://github.com/itfoundry/kalam) (Handwritten) | Indian Type Foundry |

## Icons

Several of Kinwall's icons (the gear, book, person, cart, basket, pill, cloud-off and eye) are drawn from or after [Lucide](https://lucide.dev), under the ISC License:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Emoji are your device's own.

## Data sources

Each is off until a family turns it on, and [Privacy](../your-data/privacy.md#leaving-your-server) says what's sent.

| Source | Used for | License |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) | Weather forecasts and place search | Data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Wikipedia](https://www.wikipedia.org), through the [Wikimedia API](https://api.wikimedia.org) | **On this day** on the quote card | Text under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [Open Trivia DB](https://opentdb.com) | **Trivia question** on the quote card | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [The Metropolitan Museum of Art Open Access](https://metmuseum.github.io/) | **Art** on the Night screen | Public-domain images, [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Lorem Picsum](https://picsum.photos) by David Marby and Nijiko Yonskai | **Nature** on the Night screen, and photos in the demo | Photos from [Unsplash](https://unsplash.com), under the [Unsplash License](https://unsplash.com/license) |

## Server

| Project | What it does in Kinwall | License |
|---|---|---|
| [Hono](https://hono.dev) | The web framework, on Node and Cloudflare Workers | MIT |
| [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) and [Zod](https://zod.dev) | Route schemas and the OpenAPI spec | MIT |
| [Swagger UI](https://github.com/swagger-api/swagger-ui) (through [@hono/swagger-ui](https://github.com/honojs/middleware/tree/main/packages/swagger-ui)) | The interactive API docs at `/docs` | Apache-2.0 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | The [MCP server](../integrations/mcp.md) | MIT |
| [ical.js](https://github.com/kewisch/ical.js) by Philipp Kewisch | Reading ICS feeds | MPL-2.0 |
| [tsdav](https://github.com/natelindev/tsdav) by Nate Lin | iCloud and CalDAV sync | MIT |
| [rrule](https://github.com/jkbrzt/rrule) by Jakub Roztočil | Repeating events | BSD-3-Clause |
| [SimpleWebAuthn](https://simplewebauthn.dev) by Matthew Miller | Passkeys | MIT |

## Web app

| Project | What it does in Kinwall | License |
|---|---|---|
| [React](https://react.dev) | The UI | MIT |
| [Vite](https://vite.dev) | Building the web app | MIT |
| [date-fns](https://date-fns.org) | Dates and times | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla | Reading recipe cards from PDFs | Apache-2.0 |
| [uqr](https://github.com/unjs/uqr) by UnJS | QR codes for pairing devices | MIT |

## Works with

Kinwall connects to these open-source projects; they're credited where they come up in the docs too.

* [Home Assistant](https://www.home-assistant.io) and [HACS](https://hacs.xyz), for the [Kinwall integration and add-on](../integrations/home-assistant.md).
* The [HelloFresh integration](https://github.com/kedube/ha-hellofresh) for Home Assistant by Katherine Dubé, behind the [meal kit blueprints](../integrations/home-assistant.md#meal-kits).
* [n8n](https://n8n.io), for [workflows](../integrations/n8n.md).

## Supporters

* [GitBook](https://www.gitbook.com) hosts these docs through its program for open-source projects.

## Something missing?

If Kinwall uses your work and it isn't credited here, please [open an issue](https://github.com/JohnDuprey/kinwall/issues) and we'll fix it.
