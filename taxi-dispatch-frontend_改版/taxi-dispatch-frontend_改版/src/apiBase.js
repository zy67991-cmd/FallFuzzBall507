// src/apiBase.js
import { apiConfigMessage, apiUrl } from './config/apiBase'

// -------------------------
// helpers
// -------------------------
function normalizePath(path) {
  const p = String(path || '').trim()
  if (!p) return '/api/health'
  // 已經是完整 URL
  if (/^https?:\/\//i.test(p)) return p
  // 保證前面有 /
  const withSlash = p.startsWith('/') ? p : `/${p}`
  // 若不是 /api 開頭，預設加上 /api
  if (!withSlash.startsWith('/api/')) return withSlash === '/api' ? '/api' : `/api${withSlash}`
  return withSlash
}

function buildUrl(path, query) {
  // apiUrl(path) 由你既有的 config/apiBase 決定 base（local/render）
  const raw = apiUrl(normalizePath(path))
  if (!raw) {
    throw new Error(apiConfigMessage() || 'API is not configured.')
  }

  if (!query) return raw

  // ✅ 兼容 raw 是相對路徑或絕對 URL
  const u = new URL(raw, window.location.origin)
  const qs = new URLSearchParams(u.search)

  if (typeof query === 'string') {
    new URLSearchParams(query).forEach((v, k) => qs.set(k, v))
  } else if (query instanceof URLSearchParams) {
    query.forEach((v, k) => qs.set(k, v))
  } else if (query && typeof query === 'object') {
    Object.entries(query).forEach(([k, v]) => {
      if (v == null) return
      qs.set(k, String(v))
    })
  }

  u.search = qs.toString()
  return u.toString()
}

function mergeHeaders(base, extra) {
  const h = new Headers(base || {})
  const e = new Headers(extra || {})
  e.forEach((v, k) => h.set(k, v))
  return h
}

function isJsonResponse(res) {
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') || ct.includes('+json')
}

async function safeReadText(res) {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// ✅ 非 async（避免不必要的 microtask）
function withTimeoutSignal(externalSignal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return { signal: externalSignal ?? null, cancel: null }

  const controller = new AbortController()
  const t = setTimeout(() => {
    try {
      controller.abort(new Error('timeout'))
    } catch {
      controller.abort()
    }
  }, timeoutMs)

  const onAbort = () => {
    try {
      controller.abort(externalSignal?.reason)
    } catch {
      controller.abort()
    }
  }

  if (externalSignal) {
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(t)
      if (externalSignal) {
        try {
          externalSignal.removeEventListener('abort', onAbort)
        } catch {}
      }
    },
  }
}

// -------------------------
// anti-stacking (核心)
// -------------------------
// ✅ 同一個 method+url 的新請求會 abort 舊請求，避免 setInterval 堆疊
const inflight = new Map()
function makeInflightKey(method, url) {
  return `${String(method || 'GET').toUpperCase()} ${url}`
}

// -------------------------
// core
// -------------------------

/**
 * 統一走這裡呼叫後端：
 * - apiFetch('/api/xxx', { method, headers, body, ... })
 * - apiFetch('orders', { query: { wrap: true } })
 *
 * options 額外支援：
 * - query: object|string|URLSearchParams
 * - timeoutMs: number (預設 12000ms)
 * - credentials: 'omit'|'include'|'same-origin' (預設 omit)
 * - dedupe: boolean (預設 true：同 key 會 abort 前一個)
 * - dedupeKey: string (可自訂 key；不給就用 method+url)
 */
export async function apiFetch(path, options = {}) {
  const {
    headers,
    cache,
    mode,
    credentials,
    query,
    timeoutMs,
    signal,
    dedupe,
    dedupeKey,
    ...rest
  } = options || {}

  const url = buildUrl(path, query)

  // ✅ 避免 304 / cache 汙染（前後端雙保險）
  const baseHeaders = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  }

  // 只在需要時加 JSON header（避免 FormData/Blob 被強行改掉）
  const method = String(rest?.method || 'GET').toUpperCase()
  const body = rest?.body

  const wantsJson =
    body != null &&
    typeof body === 'string' &&
    method !== 'GET' &&
    !String(headers?.['Content-Type'] || headers?.get?.('Content-Type') || '').includes('multipart/form-data')

  const jsonHeaders = wantsJson ? { 'Content-Type': 'application/json' } : {}
  const merged = mergeHeaders(baseHeaders, mergeHeaders(jsonHeaders, headers))

  // ✅ 預設 timeout：避免卡死
  const effectiveTimeout = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 12000
  const { signal: s2, cancel } = withTimeoutSignal(signal, effectiveTimeout)

  // ✅ 防堆疊：同 key 先 abort 舊的
  const key = dedupeKey || makeInflightKey(method, url)
  const shouldDedupe = dedupe !== false

  if (shouldDedupe) {
    const prev = inflight.get(key)
    if (prev && prev.controller) {
      try {
        prev.controller.abort(new Error('replaced by newer request'))
      } catch {
        try {
          prev.controller.abort()
        } catch {}
      }
    }
  }

  // 讓每個 request 都有自己的 controller，方便被新請求 abort
  const localController = new AbortController()
  const linkAbort = () => {
    try {
      localController.abort(s2?.reason)
    } catch {
      localController.abort()
    }
  }
  if (s2) {
    if (s2.aborted) linkAbort()
    else s2.addEventListener('abort', linkAbort, { once: true })
  }

  inflight.set(key, { controller: localController, startedAt: Date.now() })

  try {
    const res = await fetch(url, {
      ...rest,
      headers: merged,
      cache: cache || 'no-store',
      mode: mode || 'cors',
      credentials: credentials || 'omit',
      signal: localController.signal,
    })
    return res
  } catch (e) {
    // ✅ 統一 AbortError 行為：給更清楚的訊息（利於你 debug）
    if (e?.name === 'AbortError') throw e
    throw e
  } finally {
    if (cancel) cancel()
    if (s2) {
      try {
        s2.removeEventListener('abort', linkAbort)
      } catch {}
    }
    // 只清掉自己那筆（避免 race 清到新請求）
    const cur = inflight.get(key)
    if (cur?.controller === localController) inflight.delete(key)
  }
}

/**
 * 方便：拿文字（自動丟錯）
 */
export async function apiText(path, options = {}) {
  const res = await apiFetch(path, options)
  const text = await safeReadText(res)

  if (!res.ok) {
    const msg = `API ${res.status} ${res.statusText} @ ${res.url}\n${text || ''}`.trim()
    throw new Error(msg)
  }

  return text
}

/**
 * 方便：拿 JSON（自動丟錯）
 * - 會先讀 text，再 parse，避免後端回非 JSON 時直接炸掉
 * - 若回 204 / 空字串 -> 回 null
 */
export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options)
  const text = await safeReadText(res)

  if (!res.ok) {
    const msg = `API ${res.status} ${res.statusText} @ ${res.url}\n${text || ''}`.trim()
    throw new Error(msg)
  }

  if (res.status === 204 || !text) return null

  if (isJsonResponse(res)) {
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/**
 * 方便：送 JSON body + 拿 JSON（常用）
 * e.g. apiJsonBody('/api/orders', { customer:'x' }, { method:'POST' })
 */
export async function apiJsonBody(path, bodyObj, options = {}) {
  return apiJson(path, {
    ...options,
    method: options?.method || 'POST',
    headers: {
      ...(options?.headers || {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyObj ?? {}),
  })
}
