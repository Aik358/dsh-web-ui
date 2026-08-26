import test from 'node:test'
import assert from 'node:assert/strict'

import viewer from '../market/telemetry-view/src/index.js'
import { renderDashboard, PAGE_CSP } from '../market/telemetry-view/src/page.js'

function context() { return { waitUntil() {} } }

test('telemetry-view refuses to serve until Access secrets are configured', async () => {
  const response = await viewer.fetch(new Request('https://tv.dsh-market.com/'), {}, context())
  assert.equal(response.status, 503)
  assert.match(await response.text(), /setup required/)
})

test('telemetry-view rejects requests without a valid Access JWT', async () => {
  const env = { ACCESS_TEAM: 'team', ACCESS_AUD: 'aud', TELEMETRY_READ_KEY: 'key' }
  const page = await viewer.fetch(new Request('https://tv.dsh-market.com/'), env, context())
  assert.equal(page.status, 401)
  const data = await viewer.fetch(new Request('https://tv.dsh-market.com/data?days=7'), env, context())
  assert.equal(data.status, 401)
})

test('dashboard document inlines CSP-safe boot data and the paginated shell', () => {
  const html = renderDashboard({
    days: 30,
    sizes: { paths: 10, items: 10 },
    data: {
      ok: true,
      range: { days: 30, since: '2026-07-28' },
      site: {
        totals: { pv: 3, uv_daily_sum: 2 },
        daily: [{ day: '2026-08-25', pv: 1, uv: 1 }, { day: '2026-08-26', pv: 2, uv: 1 }],
        top_paths: [{ path: '/</script><script>alert(1)</script>', pv: 2 }],
        paths_total: 1,
        paths_page: { offset: 0, limit: 10 },
      },
      plugins: { totals: { uv_daily_sum: 0, items: 0 }, daily: [], items_page: { offset: 0, limit: 10 }, items: [] },
    },
  })
  // The embedded JSON must not be able to terminate its script element.
  const scripts = html.split('<script data-cfasync="false">').slice(1)
  assert.equal(scripts.length, 2)
  for (const block of scripts) {
    assert.ok(!block.slice(0, block.indexOf('</' + 'script>')).includes('</' + 'script>'), 'script block must not self-terminate')
  }
  assert.ok(html.includes('\\u003c/script>'), 'angle brackets in data are unicode-escaped')
  assert.ok(html.includes('id="paths-pager"'))
  assert.ok(html.includes('id="items-pager"'))
  assert.match(PAGE_CSP, /script-src 'unsafe-inline'/)
  assert.match(PAGE_CSP, /connect-src 'self'/)
})
