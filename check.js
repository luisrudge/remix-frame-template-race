// Loads the page in headless Chromium and asserts that the frame rendered every item the
// server sent, in both scenarios (observer and hydrate), RUNS times each.
//
//   pnpm check            stock runtime, split template  -> FAILS today (half the items)
//   SPLIT=0 pnpm check    template sent in one chunk     -> passes
//   NESTED=1 pnpm check   items inside one <div>: observer still fails, hydrate passes
//   BROWSER=firefox|webkit  another engine (needs `pnpm exec playwright install <name>`)
import { spawn } from 'node:child_process'
import * as playwright from 'playwright'

const PORT = Number(process.env.PORT ?? 3123)
const runs = Number(process.env.RUNS ?? 3)
let params = new URLSearchParams()
if (process.env.SPLIT === '0') params.set('split', '0')
if (process.env.NESTED === '1') params.set('nested', '1')

let server = spawn(process.execPath, ['server.js'], {
  cwd: import.meta.dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => server.stdout.once('data', resolve))

let browser
let failures = 0
try {
  browser = await playwright[process.env.BROWSER ?? 'chromium'].launch()
  for (let scenario of ['observer', 'hydrate']) {
    for (let run = 0; run < runs; run++) {
      let query = new URLSearchParams(params)
      query.set('scenario', scenario)
      let page = await browser.newPage()
      let errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://localhost:${PORT}/?${query}`, { waitUntil: 'load' })
      // Leave time for any late render after the page loads.
      await page.waitForTimeout(300)
      let { rendered, sent } = await page.evaluate(() => ({
        rendered: document.querySelectorAll('[data-item]').length,
        sent: window.__repro.items,
      }))
      let ok = rendered === sent && errors.length === 0
      if (!ok) failures++
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  /?${query}  rendered ${rendered} of ${sent} items` +
          (errors.length ? `  page errors: ${errors.join('; ')}` : ''),
      )
      await page.close()
    }
  }
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
