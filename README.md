# remix-frame-template-race

A streamed `<Frame>` in `@remix-run/component@1.0.0` renders 20 of 40 items when its template arrives in two parts during the initial page load. The remaining items never appear, even after the page finishes loading. No JavaScript errors are reported.

This repro renders one page with one non-blocking `<Frame>` through the package's own `renderToStream`. It sends those exact bytes with the frame's template split in half.

## Run

```sh
pnpm install
pnpm exec playwright install chromium   # only needed for the automated check
pnpm start                              # http://localhost:3000
```

| URL | What you'll see |
| --- | --- |
| `/` | `BROKEN: rendered 20 of 40 items sent` (red) |
| `/?split=0` | `ok: rendered 40 of 40`: the same bytes, with the template in one chunk |
| add `&scenario=hydrate` | the runtime starts after the first half of the template arrives; 20 of 40 items render |
| add `&nested=1` | the items are wrapped in one `<div>`; observer renders 20 of 40, hydrate renders all 40 |

## Automated check

```sh
pnpm check              # stock runtime, split template: FAILS (20 of 40, both scenarios)
SPLIT=0 pnpm check      # unsplit template: passes
NESTED=1 pnpm check     # one wrapper element: observer fails, hydrate passes
BROWSER=firefox pnpm check   # also fails on Firefox (install it first)
```

`check.js` starts the server, loads the page in headless Playwright, and asserts that the frame rendered every item the server sent. By default it loads each scenario 3 times (`RUNS=n` changes that).

## How the split is made deterministic

- `server.js` writes the shell, which holds the fallback and `#rmx-data`. `client.js` then calls `run()`, waits for `app.ready()`, and calls `/booted`.
- **observer** (default): after `/booted`, the server writes the first half of the template, waits 100 ms, then writes the rest.
- **hydrate**: the server writes the first half before the runtime starts, and writes the rest only after `/booted`.

The `/booted` handshake makes the split repeatable. The browser uses the package's unmodified runtime from `node_modules`.

Playwright's WebKit did not run the async module script while the document was still loading, so this repro can't trigger the bug there.
