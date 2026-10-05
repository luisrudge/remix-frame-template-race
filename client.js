let { id, runtimeBase, items } = window.__repro
let { run } = await import(runtimeBase + 'index.js')

let app = run({
  // This page has no client entries.
  async loadModule() {
    throw new Error('no client entries on this page')
  },
})
await app.ready()
fetch('/booted?id=' + id)

// Show what the frame rendered against what the server sent.
let status = document.getElementById('status')
function report() {
  let rendered = document.querySelectorAll('[data-item]').length
  let fallback = document.getElementById('fallback') !== null
  let state = fallback ? 'pending' : rendered === items ? 'ok' : 'BROKEN'
  status.dataset.state = state
  status.dataset.rendered = rendered
  status.textContent = `${state}: rendered ${rendered} of ${items} items sent (${runtimeBase})`
  status.style.color = state === 'BROKEN' ? 'crimson' : state === 'ok' ? 'green' : 'gray'
}
report()
setInterval(report, 50)
