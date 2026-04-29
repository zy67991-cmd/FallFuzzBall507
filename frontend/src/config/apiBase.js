// src/config/apiBase.js

const LOCAL_API_ORIGIN = 'http://127.0.0.1:8000'
const envApiBase = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '')

function isLocalBrowserOrigin() {
  if (typeof window === 'undefined') return false
  const { protocol, hostname } = window.location
  return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export const API_ORIGIN = envApiBase || (isLocalBrowserOrigin() ? LOCAL_API_ORIGIN : '')
export const API_BASE = API_ORIGIN
export const API_CONFIG_ERROR = API_ORIGIN
  ? ''
  : 'API 尚未設定。請在 Render 前端服務設定 VITE_API_BASE=https://你的後端服務.onrender.com'

export function isApiConfigured() {
  return Boolean(API_ORIGIN)
}

export function apiConfigMessage() {
  return API_CONFIG_ERROR
}

export function apiUrl(path = '') {
  if (/^https?:\/\//i.test(path)) return path
  if (!API_ORIGIN) return ''

  if (!path) return API_ORIGIN
  const p = path.startsWith('/') ? path : `/${path}`
  return `${API_ORIGIN}${p}`
}
