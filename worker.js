/**
 * Cloudflare Worker：Yahoo Finance 股價代理
 * ------------------------------------------------------------
 * 用途：讓部署在 GitHub Pages 的靜態網站可以抓到即時股價，
 *       同時不依賴不穩定的公開 CORS proxy（allorigins 之類）。
 *
 * 做了三件事：
 *   1. 伺服器對伺服器呼叫 Yahoo Finance，瀏覽器端完全不會碰到 CORS 問題。
 *   2. 只允許你自己網站的 Origin 呼叫（CORS 白名單），避免被別人當公開代理濫用。
 *   3. 用 Cloudflare 邊緣快取把同一個股票代碼快取 60 秒，
 *      大幅降低打到 Yahoo 的次數、也降低被 Yahoo 擋的機率。
 *
 * 部署方式請見 DEPLOY.md。
 */

// 部署前請改成你自己的 GitHub Pages 網址（結尾不要加斜線）
const ALLOWED_ORIGIN = 'https://joshyen0716.github.io';

// 白名單：只允許代理這幾支，避免這個 Worker 被當成任意網址的公開代理濫用
const ALLOWED_SYMBOLS = new Set(['0050.TW', '^GSPC', 'QQQ', 'TWD=X']);

const CACHE_SECONDS = 60;

function corsHeaders(origin) {
  const allowOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname !== '/quote') {
      return json({ error: 'not found, use /quote?symbol=...' }, 404, origin);
    }

    const symbol = url.searchParams.get('symbol') || '';
    if (!ALLOWED_SYMBOLS.has(symbol)) {
      return json({ error: 'symbol not allowed' }, 403, origin);
    }

    // 邊緣快取：同一個 symbol 60 秒內重複打進來就直接吃快取，不用再打 Yahoo
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

    let upstream;
    try {
      upstream = await fetch(yahooUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
    } catch (e) {
      return json({ error: 'upstream fetch failed', detail: String(e) }, 502, origin);
    }

    if (!upstream.ok) {
      return json({ error: 'upstream error', status: upstream.status }, 502, origin);
    }

    let data;
    try {
      data = await upstream.json();
    } catch (e) {
      return json({ error: 'upstream returned non-json' }, 502, origin);
    }

    const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') {
      return json({ error: 'no data for symbol' }, 502, origin);
    }

    const payload = {
      symbol,
      price: meta.regularMarketPrice,
      prevClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      currency: meta.currency || null,
      time: meta.regularMarketTime || null,
    };

    const response = json(payload, 200, origin);
    response.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
