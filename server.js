// Renders one page with one non-blocking <Frame> using @remix-run/component's own
// renderToStream, then sends those exact bytes with controlled pacing, so the frame's
// <template> reaches the browser in two network chunks.
//
// Query params (all optional):
//   split=0           send the template in one chunk (default 1: split it in half)
//   scenario=hydrate  the runtime boots while the template is half-parsed, which exercises
//                     getEarlyFrameContent (default "observer": the runtime is already running
//                     and the MutationObserver sees the template arrive)
//   nested=1          wrap the items in one <div>, so the split lands inside an element rather
//                     than between the template's top-level children
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createElement as h, Frame } from '@remix-run/component'
import { jsx } from '@remix-run/component/jsx-runtime'
import { renderToStream } from '@remix-run/component/server'

const ITEMS = 40
const PORT = Number(process.env.PORT ?? 3000)
const root = import.meta.dirname
const dist = path.join(root, 'node_modules/@remix-run/component/dist')

function Page() {
  return () =>
    h(
      'html',
      {},
      h(
        'head',
        {},
        h('title', {}, 'frame template race'),
        // Like a typical app: an async module script that starts the runtime mid-parse.
        // (jsx() rather than createElement(), which would give the script a children array.)
        jsx('script', { type: 'module', async: true, src: '/client.js' }),
      ),
      h(
        'body',
        {},
        h('p', { id: 'status' }, 'runtime not started'),
        h(Frame, { src: '/items', fallback: h('p', { id: 'fallback' }, 'Loading items...') }),
      ),
    )
}

// The frame's content: ITEMS top-level siblings, or one <div> holding them.
function itemsHtml(nested) {
  let html = ''
  for (let i = 1; i <= ITEMS; i++) html += `<p data-item="${i}">Item ${i}</p>`
  return nested ? `<div>${html}</div>` : html
}

async function renderChunks(nested) {
  let stream = renderToStream(h(Page, {}), { resolveFrame: () => itemsHtml(nested) })
  let chunks = []
  let decoder = new TextDecoder()
  for await (let chunk of stream) chunks.push(decoder.decode(chunk))
  // renderToStream emits the shell (fallback + #rmx-data) and then the resolved frame as
  // `<template id="f...">...</template>`.
  let html = chunks.join('')
  let start = html.indexOf('<template id="')
  return { shell: html.slice(0, start), template: html.slice(start) }
}

// The server waits for this before sending the next part, so the split always lands where we
// want it, whatever the machine's speed.
let bootWaiters = new Map()
function waitForBoot(id) {
  return new Promise((resolve) => bootWaiters.set(id, resolve))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function servePage(req, res, url) {
  let split = url.searchParams.get('split') !== '0'
  let scenario = url.searchParams.get('scenario') === 'hydrate' ? 'hydrate' : 'observer'
  let id = Math.random().toString(36).slice(2)

  let { shell, template } = await renderChunks(url.searchParams.get('nested') === '1')
  // Cut the template between two items, halfway through.
  let cut = template.indexOf(`<p data-item="${ITEMS / 2 + 1}"`)
  let first = template.slice(0, cut)
  let second = template.slice(cut)

  let runtimeBase = '/rt/stock/'
  let config = `<script>window.__repro=${JSON.stringify({ id, runtimeBase, items: ITEMS })}</script>`

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.write('<!DOCTYPE html>' + shell.replace('<head>', '<head>' + config))
  // The client reports once run() is up and app.ready() has resolved.
  let booted = waitForBoot(id)

  if (scenario === 'observer') {
    await booted // The runtime is running and watching the document.
    if (split) {
      res.write(first)
      await sleep(100) // The parser parses the first half and yields; the observer runs.
      res.write(second)
    } else {
      res.write(template)
    }
  } else {
    if (split) {
      res.write(first)
      await booted // The runtime hydrated while only the first half had arrived.
      await sleep(100)
      res.write(second)
    } else {
      res.write(template)
      await booted
    }
  }
  res.end()
}

function serveFile(res, file) {
  res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
  res.end(fs.readFileSync(file))
}

http
  .createServer(async (req, res) => {
    let url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/') return servePage(req, res, url)
    if (url.pathname === '/client.js') return serveFile(res, path.join(root, 'client.js'))
    if (url.pathname === '/booted') {
      bootWaiters.get(url.searchParams.get('id'))?.()
      bootWaiters.delete(url.searchParams.get('id'))
      return res.end('ok')
    }
    let rt = url.pathname.match(/^\/rt\/stock\/(.+\.js)$/)
    if (rt) {
      let [, file] = rt
      let full = path.join(dist, path.normalize(file))
      if (full.startsWith(dist) && fs.existsSync(full)) return serveFile(res, full)
    }
    res.writeHead(404).end()
  })
  .listen(PORT, () => {
    console.log(`http://localhost:${PORT}/            bug: frame renders half the items`)
    console.log(`http://localhost:${PORT}/?split=0    template sent in one chunk`)
    console.log(`add &scenario=hydrate to hit getEarlyFrameContent instead of the observer`)
  })
