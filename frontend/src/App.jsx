// src/App.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import './App.css'
import { languages, t } from './i18n'
import RiderView from './views/RiderView.jsx'
import DriverView from './views/DriverView.jsx'
import AuthPage from './views/AuthPage.jsx'
import LandingPage from './LandingPage.jsx'
import { resolveLocation } from './locationResolver.js'
import DriverPage from './DriverPage.jsx'
import { apiFetch } from './apiBase.js'
import { API_CONFIG_ERROR } from './config/apiBase.js'

const DEFAULT_PASSENGER_USER = { username: '乘客1', role: 'passenger' }

const PRESET_DRIVER_GROUPS = {
  GREEN: [
    { id: 1, username: 'GREEN 司機1', carType: 'GREEN' },
    { id: 2, username: 'GREEN 司機2', carType: 'GREEN' },
  ],
  YELLOW: [
    { id: 3, username: 'YELLOW 司機1', carType: 'YELLOW' },
    { id: 4, username: 'YELLOW 司機2', carType: 'YELLOW' },
  ],
  FHV: [
    { id: 5, username: 'FHV 司機1', carType: 'FHV' },
    { id: 6, username: 'FHV 司機2', carType: 'FHV' },
  ],
}

const DEFAULT_DRIVER_USER = { username: 'GREEN 司機1', role: 'driver', carType: 'GREEN' }
const ORDER_SYNC_KEY = 'orderSyncEventV1'
const ORDER_SYNC_EVT = 'orderSyncEventChanged'

const APP_BOOT_KEY = 'appBootSessionV1'

function clearAllDriverRuntimePosition() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (
        k?.startsWith('driverLoc:') ||
        k?.startsWith('driverLiveState:') ||
        k?.startsWith('driverLocTs:') ||
        k?.startsWith('driverLocConfirmed:')
      ) {
        localStorage.removeItem(k)
      }
    }
  } catch {}
}

function emitOrderSync(reason = 'orders-updated', detail = {}) {
  const payload = { reason, ts: Date.now(), ...(detail || {}) }
  try {
    localStorage.setItem(ORDER_SYNC_KEY, JSON.stringify(payload))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(ORDER_SYNC_EVT, { detail: payload }))
  } catch {}
}

// ------------------------------
// URL helpers
// ------------------------------
function getInitialModeFromUrl() {
  // 初始不靠 URL 決定顯示哪頁：一律 Landing
  return 'rider'
}

function getInitialShowLandingFromUrl() {
  return true
}

function getInitialShowAuthFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search)
    const auth = params.get('auth')
    if (!auth) return false
    return auth === '1' || auth.toLowerCase() === 'true' || auth.toLowerCase() === 'yes'
  } catch {
    return false
  }
}

function setUrlParams({ role, auth }) {
  try {
    const url = new URL(window.location.href)
    if (role === 'driver') url.searchParams.set('role', 'driver')
    else if (role === 'passenger') url.searchParams.set('role', 'passenger')
    else url.searchParams.delete('role')

    if (auth) url.searchParams.set('auth', '1')
    else url.searchParams.delete('auth')

    window.history.replaceState({}, '', url.toString())
  } catch {}
}

// ------------------------------
// Error stringify helper
// ------------------------------
function toMessage(x) {
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'number' || typeof x === 'boolean') return String(x)
  if (Array.isArray(x)) return x.map(toMessage).filter(Boolean).join(', ')
  if (typeof x === 'object') {
    if (typeof x.message === 'string') return x.message
    try {
      return JSON.stringify(x)
    } catch {
      return String(x)
    }
  }
  return String(x)
}

// ------------------------------
// ID + compatibility helpers
// ------------------------------
function sameId(a, b) {
  const A = Number(a)
  const B = Number(b)
  return Number.isFinite(A) && Number.isFinite(B) && A === B
}

function getOrderDriverId(order) {
  return order?.driverId ?? order?.assignedDriverId ?? order?.driver_id ?? null
}

function normalizeOrderDriverId(o) {
  if (!o || typeof o !== 'object') return o
  const did = getOrderDriverId(o)
  if (did == null) return o
  return { ...o, driverId: did }
}

// ------------------------------
// ✅ Auth persistence (driver/passenger 分離)
// ------------------------------
const AUTH_PASSENGER_CRED_KEY = 'auth:passenger:credV1' // { username, password }
const AUTH_PASSENGER_USER_KEY = 'auth:passenger:userV1' // { username, role:'passenger' }

const AUTH_DRIVER_CRED_KEY = 'auth:driver:credV1' // { username, carType }
const AUTH_DRIVER_USER_KEY = 'auth:driver:userV1' // { username, role:'driver' }
const AUTH_DRIVER_ID_KEY = 'auth:driver:driverIdV1' // number

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
function writeJson(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj || {}))
  } catch {}
}
function removeKey(key) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

function readPassengerUser() {
  const obj = readJson(AUTH_PASSENGER_USER_KEY)
  const username = String(obj?.username || '').trim()
  const role = obj?.role === 'passenger' ? 'passenger' : null
  if (!username || !role) return null
  return { username, role }
}
function writePassengerUser(user) {
  writeJson(AUTH_PASSENGER_USER_KEY, user)
}
function readPassengerCred() {
  const obj = readJson(AUTH_PASSENGER_CRED_KEY)
  const username = String(obj?.username || '').trim()
  const password = String(obj?.password || '')
  if (!username) return null
  return { username, password }
}
function writePassengerCred(cred) {
  writeJson(AUTH_PASSENGER_CRED_KEY, cred)
}

function readDriverUser() {
  const obj = readJson(AUTH_DRIVER_USER_KEY)
  const username = String(obj?.username || '').trim()
  const role = obj?.role === 'driver' ? 'driver' : null
  if (!username || !role) return null
  return { username, role }
}
function writeDriverUser(user) {
  writeJson(AUTH_DRIVER_USER_KEY, user)
}
function readDriverCred() {
  const obj = readJson(AUTH_DRIVER_CRED_KEY)
  const username = String(obj?.username || '').trim()
  const carType = obj?.carType != null ? String(obj.carType) : null
  if (!username) return null
  return { username, carType }
}
function writeDriverCred(cred) {
  writeJson(AUTH_DRIVER_CRED_KEY, cred)
}

function readAuthDriverId() {
  try {
    const raw = localStorage.getItem(AUTH_DRIVER_ID_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
function writeAuthDriverId(id) {
  try {
    if (id == null) localStorage.removeItem(AUTH_DRIVER_ID_KEY)
    else localStorage.setItem(AUTH_DRIVER_ID_KEY, String(id))
  } catch {}
}

// ------------------------------
// Driver last position local override
// ------------------------------
function loadDriverLivePos(driverId) {
  if (driverId == null) return null
  try {
    const raw = localStorage.getItem(`driverLiveState:${driverId}`)
    if (!raw) return null

    const obj = JSON.parse(raw)
    const lat = Number(obj?.lat)
    const lng = Number(obj?.lng)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

function persistDriverFinalPos(driverId, pos) {
  if (driverId == null || !pos) return

  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

  const payload = {
    lat,
    lng,
    heading: Number(pos.heading ?? 0),
    speedKph: Number(pos.speedKph ?? 0),
    ts: Date.now(),
  }

  try {
    localStorage.setItem(`driverLoc:${driverId}`, JSON.stringify({ lat, lng }))
    localStorage.setItem(`driverLiveState:${driverId}`, JSON.stringify(payload))
    localStorage.setItem(`driverLocTs:${driverId}`, String(Date.now()))
    localStorage.setItem(`driverLocConfirmed:${driverId}`, '1')
  } catch {}
}

function loadLocalDriverPos(driverId) {
  if (driverId == null) return null
  try {
    const raw = localStorage.getItem(`driverLoc:${driverId}`)
    if (!raw) return null
    const obj = JSON.parse(raw)
    const lat = Number(obj?.lat)
    const lng = Number(obj?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

function normalizeDriverLatLng(d) {
  const lat = d?.lat
  const lng = d?.lng
  const nLat = typeof lat === 'number' ? lat : Number(lat)
  const nLng = typeof lng === 'number' ? lng : Number(lng)
  if (Number.isFinite(nLat) && Number.isFinite(nLng)) return { ...d, lat: nLat, lng: nLng }
  return { ...d }
}

function enforceManualDriverPos(driversRows, currentDriverId) {
  if (currentDriverId == null) return driversRows
  const lp = loadLocalDriverPos(currentDriverId)

  return (driversRows || []).map(d => {
    if (!sameId(d?.id, currentDriverId)) return d
    if (lp) return { ...d, lat: lp.lat, lng: lp.lng }
    return { ...d, lat: null, lng: null }
  })
}

// ------------------------------
// Global sim state
// ------------------------------
const SIM_GLOBAL_KEY = 'simGlobal:running'
function readGlobalSimRunning() {
  try {
    const v = localStorage.getItem(SIM_GLOBAL_KEY)
    if (v == null) return true
    return v === '1' || v === 'true' || v === 'yes'
  } catch {
    return true
  }
}
function writeGlobalSimRunning(v) {
  try {
    localStorage.setItem(SIM_GLOBAL_KEY, v ? '1' : '0')
  } catch {}
}

// ------------------------------
// ✅ 車輛 replay pause/resume（避免切回來重跑）
// 使用 MapView 同一套 sim 結構：localStorage key = `sim:${orderKey}`
// ------------------------------
function simStorageKey(orderKey) {
  return `sim:${orderKey}`
}
function readSim(orderKey) {
  try {
    const raw = localStorage.getItem(simStorageKey(orderKey))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeSim(orderKey, obj) {
  try {
    localStorage.setItem(simStorageKey(orderKey), JSON.stringify(obj || {}))
  } catch {}
}
function pauseSim(orderKey) {
  const c = readSim(orderKey)
  if (!c || !c.running || c.completed) return
  writeSim(orderKey, {
    ...c,
    elapsedMs: (c.elapsedMs || 0) + Math.max(0, Date.now() - (c.startedAt || Date.now())),
    running: false,
    startedAt: Date.now(),
  })
}
function resumeSim(orderKey) {
  const c = readSim(orderKey)
  if (!c || c.running || c.completed) return
  writeSim(orderKey, { ...c, running: true, startedAt: Date.now() })
}

// ------------------------------
// Completed orders (local override)
// ------------------------------
const COMPLETED_META_KEY = 'completedOrdersMetaV2'

function makeCompletedKeyFromOrder(o) {
  const id = Number(o?.id)
  if (!Number.isFinite(id)) return null
  const createdAt = o?.createdAt || o?.created_at || o?.updatedAt || o?.updated_at || ''
  return `${id}::${String(createdAt)}`
}

function loadCompletedMeta() {
  try {
    const raw = localStorage.getItem(COMPLETED_META_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}
function saveCompletedMeta(meta) {
  try {
    localStorage.setItem(COMPLETED_META_KEY, JSON.stringify(meta || {}))
  } catch {}
}

function ApiConfigErrorScreen() {
  return (
    <div className="api-config-screen">
      <section className="api-config-panel" aria-live="polite">
        <p className="api-config-kicker">SmartDispatch</p>
        <h1>API 尚未設定</h1>
        <p>
          手機外網版必須在 Render 前端服務設定
          <code>VITE_API_BASE</code>
          ，並指向 Render 後端公開網址。
        </p>
        <div className="api-config-command">VITE_API_BASE=https://你的後端服務.onrender.com</div>
        <p className="api-config-note">{API_CONFIG_ERROR}</p>
      </section>
    </div>
  )
}

function MainApp() {
    useEffect(() => {
    const bootId = String(Date.now())
    const oldBoot = sessionStorage.getItem(APP_BOOT_KEY)

    if (!oldBoot) {
      clearAllDriverRuntimePosition()
      sessionStorage.setItem(APP_BOOT_KEY, bootId)
    }
  }, [])

  const [lang, setLang] = useState('zh')
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])

  const [mode, setMode] = useState(getInitialModeFromUrl)
  const [showLanding, setShowLanding] = useState(getInitialShowLandingFromUrl)
  const [showAuth, setShowAuth] = useState(getInitialShowAuthFromUrl)
  const [showHeatmap, setShowHeatmap] = useState(false)

  const [authReturnTo, setAuthReturnTo] = useState('landing')

  const [riderDraft, setRiderDraft] = useState({
    pickupText: '',
    dropoffText: '',
    pickupLoc: null,
    dropoffLoc: null,
    stops: [],
    composerLocked: false,
    composeMode: false,
    selectedOrderId: null,
  })

  // ✅ 分離狀態：乘客/司機各自一套
  const [passengerUser, setPassengerUser] = useState(DEFAULT_PASSENGER_USER)
  const [driverUser, setDriverUser] = useState(DEFAULT_DRIVER_USER)
  
  // UI 仍然需要 currentUser（給 RiderView/DriverView 用），但它是「依 mode 派生」
  const currentUser = useMemo(() => {
    if (mode === 'driver') return driverUser
    return passengerUser
  }, [mode, driverUser, passengerUser])

  const [drivers, setDrivers] = useState([])
  const [orders, setOrders] = useState([])
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [zonesError, setZonesError] = useState('')

  const [currentDriverId, setCurrentDriverId] = useState(1)  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [simulateVehicles, setSimulateVehicles] = useState(() => readGlobalSimRunning())
  const [driverHotspotPosById, setDriverHotspotPosById] = useState({})

  // no-op props
  const streetFollowOpen = false
  const openStreetFollow = () => {}
  const closeStreetFollow = () => {}
  const handleCarPosChange = () => {}

  const completedMetaRef = useRef(loadCompletedMeta())

  const ordersRef = useRef([])
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  // ✅ 用這個避免「回到分頁」時 syncFromUrl 把你導回首頁
  const allowUrlSyncRef = useRef(true)

  const openAuth = (returnTo = 'landing', targetRole = null) => {
    setAuthReturnTo(returnTo)
    setShowAuth(true)
    setShowLanding(false)

    setUrlParams({
      role: targetRole === 'driver' ? 'driver' : targetRole === 'passenger' ? 'passenger' : null,
      auth: true,
    })
  }

  const closeAuth = (forceReturnTo = null) => {
    const dest = forceReturnTo || authReturnTo

    setShowAuth(false)
    setShowLanding(dest === 'landing')

    if (dest === 'driver') setMode('driver')
    if (dest === 'rider') setMode('rider')

    if (dest === 'driver') setUrlParams({ role: 'driver', auth: false })
    else if (dest === 'rider') setUrlParams({ role: 'passenger', auth: false })
    else setUrlParams({ role: null, auth: false })
  }

  // ✅ URL 不自動導頁到 rider/driver；
  // ✅ 但「只在 popstate」才會同步（避免分頁回來就被重置）
  useEffect(() => {
    const syncFromUrl = () => {
      if (!allowUrlSyncRef.current) return

      const params = new URLSearchParams(window.location.search)
      const auth = params.get('auth')
      const shouldAuth =
        auth === '1' ||
        (typeof auth === 'string' && (auth.toLowerCase() === 'true' || auth.toLowerCase() === 'yes'))

      if (shouldAuth) {
        setShowAuth(true)
        setShowLanding(false)
        return
      }

      // ✅ 沒有 auth=1：一律回 Landing（只在使用者真的按返回/前進時才做）
      setShowAuth(false)
      setShowLanding(true)
      setShowHeatmap(false)
      setUrlParams({ role: null, auth: false })
    }

    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  // ✅ 切出/切回分頁：不要跳首頁 + 不要讓 sim 重跑
  const getAllOrderSimKeys = useCallback(() => {
    const arr = ordersRef.current || []
    const keys = []
    for (const o of arr) {
      const id = Number(o?.id)
      if (!Number.isFinite(id)) continue
      const did = getOrderDriverId(o) ?? 'na'
      const createdAt = o?.createdAt || o?.created_at || ''
      keys.push(`sim_order_${id}_driver_${did}_${createdAt}`)
    }
    return keys
  }, [])

  useEffect(() => {
    const onHidden = () => {
      // 只要頁面被 background，就暫停 replay 計時
      if (document.visibilityState !== 'hidden') return
      allowUrlSyncRef.current = false
      const keys = getAllOrderSimKeys()
      for (const k of keys) pauseSim(k)
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // 回到頁面：恢復 replay 計時（不重置 elapsed）
      const keys = getAllOrderSimKeys()
      for (const k of keys) resumeSim(k)

      // 解除阻擋（延一點點，避免某些瀏覽器回來時觸發奇怪 popstate）
      setTimeout(() => {
        allowUrlSyncRef.current = true
      }, 300)
    }

    const onBlur = () => {
      allowUrlSyncRef.current = false
      const keys = getAllOrderSimKeys()
      for (const k of keys) pauseSim(k)
    }

    const onFocus = () => {
      const keys = getAllOrderSimKeys()
      for (const k of keys) resumeSim(k)
      setTimeout(() => {
        allowUrlSyncRef.current = true
      }, 300)
    }

    document.addEventListener('visibilitychange', () => {
      onHidden()
      onVisible()
    })
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)

    return () => {
      document.removeEventListener('visibilitychange', () => {
        onHidden()
        onVisible()
      })
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [getAllOrderSimKeys])

  useEffect(() => {
    const onStorage = e => {
      if (e.key === SIM_GLOBAL_KEY) {
        setSimulateVehicles(readGlobalSimRunning())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleSimulateVehicles = () => {
    setSimulateVehicles(prev => {
      const next = !prev
      writeGlobalSimRunning(next)
      return next
    })
  }

  const markOrderCompleted = async (orderId, lastPos = null) => {
    if (orderId == null) return
    const idNum = Number(orderId)
    if (!Number.isFinite(idNum)) return

    const targetRaw = (ordersRef.current || []).find(o => Number(o?.id) === idNum)
    if (!targetRaw) return

    const target = normalizeOrderDriverId(targetRaw)
    const did = getOrderDriverId(target)

    const finalPos =
      lastPos &&
      Number.isFinite(Number(lastPos.lat)) &&
      Number.isFinite(Number(lastPos.lng))
        ? lastPos
        : target?.dropoffLocation &&
          Number.isFinite(Number(target.dropoffLocation.lat)) &&
          Number.isFinite(Number(target.dropoffLocation.lng))
        ? {
            lat: Number(target.dropoffLocation.lat),
            lng: Number(target.dropoffLocation.lng),
            heading: 0,
            speedKph: 0,
          }
        : null

    if (did && finalPos) {
      persistDriverFinalPos(did, finalPos)
      handleDriverLocationChange({ id: did, ...finalPos })

      try {
        await apiFetch(`/api/drivers/${did}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: Number(finalPos.lat),
            lng: Number(finalPos.lng),
          }),
        })
      } catch {}
    }

    const nowISO = new Date().toISOString()
    const orderKey = makeCompletedKeyFromOrder(target)
    if (!orderKey) return

    const meta = { ...(completedMetaRef.current || {}) }
    if (!meta[orderKey]) meta[orderKey] = { completedAtISO: nowISO }
    completedMetaRef.current = meta
    saveCompletedMeta(meta)

    setOrders(prev =>
      prev.map(o => {
        if (Number(o?.id) !== idNum) return o
        return { ...normalizeOrderDriverId(o), status: 'completed', completedAt: o.completedAt || nowISO }
      })
    )

    try {
      const simKey = `sim_order_${idNum}_driver_${did ?? 'na'}_${target.createdAt || target.created_at || ''}`
      writeSim(simKey, {
        elapsedMs: 0,
        startedAt: Date.now(),
        running: false,
        completed: true,
      })
    } catch {}

    emitOrderSync('order-completed')

    try {
      const doneRes = await apiFetch(`/api/orders/${idNum}/complete`, { method: 'POST' })
      const doneData = await doneRes.json().catch(() => ({}))

      if (Array.isArray(doneData?.drivers)) {
        setDrivers(doneData.drivers.map(normalizeDriverLatLng).map(d => {
          const live = loadDriverLivePos(d.id)
          const lp = loadLocalDriverPos(d.id)

          if (sameId(d.id, did) && finalPos) {
            return {
              ...d,
              lat: Number(finalPos.lat),
              lng: Number(finalPos.lng),
            }
          }

          if (live) return { ...d, lat: live.lat, lng: live.lng }
          if (lp) return { ...d, lat: lp.lat, lng: lp.lng }
          return d
        }))
      }

      if (Array.isArray(doneData?.orders)) {
        setOrders(doneData.orders.map(normalizeOrderDriverId))
      }

      emitOrderSync('order-completed-backend')
      fetchAll()
    } catch (e) {
      console.warn('markOrderCompleted: backend update failed', e)
    }
  }

  const fetchAllInFlightRef = useRef(false)
  const fetchAllQueuedRef = useRef(false)

  const fetchAll = async () => {
    if (fetchAllInFlightRef.current) {
      fetchAllQueuedRef.current = true
      return
    }

    fetchAllInFlightRef.current = true
    try {
      setError('')
      const [dRes, oRes] = await Promise.all([apiFetch('/api/drivers'), apiFetch('/api/orders')])
      if (!dRes.ok || !oRes.ok) throw new Error(`API error: drivers=${dRes.status}, orders=${oRes.status}`)

      const dDataRaw = await dRes.json()
      const oDataRaw = await oRes.json()

      const dRows0 = Array.isArray(dDataRaw?.rows) ? dDataRaw.rows : Array.isArray(dDataRaw) ? dDataRaw : []
      const oRows0 = Array.isArray(oDataRaw?.rows) ? oDataRaw.rows : Array.isArray(oDataRaw) ? oDataRaw : []

      let mergedDrivers = dRows0.map(normalizeDriverLatLng)
      mergedDrivers = (mergedDrivers || []).map(d => {
        const confirmed = localStorage.getItem(`driverLocConfirmed:${d.id}`) === '1'
        const live = confirmed ? loadDriverLivePos(d.id) : null
        const lp = confirmed ? loadLocalDriverPos(d.id) : null

        if (live) return { ...d, lat: live.lat, lng: live.lng }
        if (lp) return { ...d, lat: lp.lat, lng: lp.lng }

        return { ...d, lat: null, lng: null }
      })

      const oRows = oRows0.map(normalizeOrderDriverId)

      const meta = completedMetaRef.current || {}
      const mergedOrders = oRows.map(o => {
        const key = makeCompletedKeyFromOrder(o)
        if (!key || !meta[key]) return o
        return {
          ...o,
          status: 'completed',
          completedAt: o.completedAt || meta[key]?.completedAtISO || new Date().toISOString(),
        }
      })

      setDrivers(mergedDrivers)
      setOrders(mergedOrders)
    } catch (err) {
  const msg = String(err?.message || err || '')

  // ✅ 忽略「被新 request 取代」的錯誤（這是正常行為）
  if (msg.includes('replaced by newer request')) {
    return
  }

  console.error(err)
  setError(toMessage(t(langRef.current, 'cannotConnectServer')) || 'Cannot connect server')
}finally {
      fetchAllInFlightRef.current = false

      if (fetchAllQueuedRef.current) {
        fetchAllQueuedRef.current = false
        setTimeout(() => fetchAll(), 0)
      }
    }
  }

    const fetchZones = async () => {
    try {
      setZonesLoading(true)
      setZonesError('')

      const res = await apiFetch('/api/zone-hotspots', { timeoutMs: 60000 })
      if (!res.ok) throw new Error(`zone-hotspots ${res.status}`)

      const data = await res.json()
      const rows = Array.isArray(data?.rows) ? data.rows : []

      const formatted = rows
        .map(r => ({
          ...r,
          PULocationID: Number(r.PULocationID ?? r.zone_id ?? 0),
          lat: Number(r.lat_wgs),
          lon: Number(r.lon_wgs),
          pred_rides: Number(r.pred_rides ?? 0),
          priority: Number(r.priority ?? 0),
          zone_supply: Number(r.zone_supply ?? r.ZoneSupply ?? 0),
          local_supply: Number(r.local_supply ?? r.LocalSupply ?? 0),
          DemandN: Number(r.DemandN ?? 0),
          PriorityN: Number(r.PriorityN ?? 0),
          ZoneSupplyN: Number(r.ZoneSupplyN ?? 0),
          LocalSupplyN: Number(r.LocalSupplyN ?? 0),
          hotspot_score: Number(r.hotspot_score ?? 0),
        }))
        .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))

      setZones(formatted)
        } catch (err) {
      const msg = String(err?.message || err || '')
      if (msg.includes('replaced by newer request')) {
        return
      }
      console.error('load zones failed', err)
      setZonesError(msg.includes('timeout') ? '熱點資料載入逾時' : '熱點資料載入失敗')
    } finally {
      setZonesLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
    fetchZones()

const timer = setInterval(() => {
  if (!fetchAllInFlightRef.current) {
    fetchAll()
  }
}, 5000)
    const handleOrderSync = () => {
      fetchAll()
    }

    const handleStorage = e => {
      if (e.key === ORDER_SYNC_KEY) fetchAll()
    }

    window.addEventListener(ORDER_SYNC_EVT, handleOrderSync)
    window.addEventListener('storage', handleStorage)

    return () => {
      clearInterval(timer)
      window.removeEventListener(ORDER_SYNC_EVT, handleOrderSync)
      window.removeEventListener('storage', handleStorage)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ------------------------------
  // ✅ 固定展示帳號：不再登入 / 註冊 / 自動還原舊帳號
  // ------------------------------
  useEffect(() => {
    setPassengerUser(DEFAULT_PASSENGER_USER)
    setDriverUser(DEFAULT_DRIVER_USER)
    setCurrentDriverId(1)
    writeAuthDriverId(1)
  }, [])

  const ordersWithLocations = useMemo(
    () =>
      orders.map(o0 => {
        const o = normalizeOrderDriverId(o0)
        const hasPickupObj =
          o?.pickupLocation &&
          Number.isFinite(Number(o.pickupLocation?.lat)) &&
          Number.isFinite(Number(o.pickupLocation?.lng))
        const hasDropObj =
          o?.dropoffLocation &&
          Number.isFinite(Number(o.dropoffLocation?.lat)) &&
          Number.isFinite(Number(o.dropoffLocation?.lng))

        const pickupLocation = hasPickupObj
          ? { lat: Number(o.pickupLocation.lat), lng: Number(o.pickupLocation.lng) }
          : typeof o.pickupLat === 'number' && typeof o.pickupLng === 'number'
          ? { lat: o.pickupLat, lng: o.pickupLng }
          : resolveLocation(o.pickup)

        const dropoffLocation = hasDropObj
          ? { lat: Number(o.dropoffLocation.lat), lng: Number(o.dropoffLocation.lng) }
          : typeof o.dropoffLat === 'number' && typeof o.dropoffLng === 'number'
          ? { lat: o.dropoffLat, lng: o.dropoffLng }
          : resolveLocation(o.dropoff)

        const stops = Array.isArray(o.stops)
          ? o.stops
              .map(s => {
                const lat = Number(s?.lat)
                const lng = Number(s?.lng)
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ...s }
                return { ...s, lat, lng }
              })
              .filter(Boolean)
          : []

        return { ...o, pickupLocation, dropoffLocation, stops }
      }),
    [orders]
  )

  const passengerOrders = useMemo(() => {
    if (!passengerUser) return []
    return orders.filter(o => o.customer === passengerUser.username)
  }, [orders, passengerUser])

  const passengerOrdersWithLoc = useMemo(() => {
    if (!passengerUser) return []
    return ordersWithLocations.filter(o => o.customer === passengerUser.username)
  }, [ordersWithLocations, passengerUser])

  const driverOrdersWithLoc = ordersWithLocations

  const createOrder = async (pickup, dropoff, pickupLoc, dropoffLoc, fareInfo, stops = []) => {
    if (!pickup.trim() || !dropoff.trim()) return

    const activePassenger = passengerUser || DEFAULT_PASSENGER_USER

    const safeStops = Array.isArray(stops) ? stops : []
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: activePassenger.username,          pickup,
          dropoff,
          pickupLocation: { lat: Number(pickupLoc?.lat), lng: Number(pickupLoc?.lng) },
          dropoffLocation: { lat: Number(dropoffLoc?.lat), lng: Number(dropoffLoc?.lng) },
          stops: safeStops,
          vehicleType: fareInfo?.vehicleType || null,
          estimatedPrice: fareInfo?.price ?? null,
          distanceKm: fareInfo?.distanceKm ?? null,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`)

      const order = normalizeOrderDriverId(data?.order || data)
      setOrders(prev => [...prev, order])
    } catch (err) {
      console.error(err)
      setError(toMessage(t(lang, 'createOrderFailed')) || 'Create order failed')
    } finally {
      setLoading(false)
    }
  }

  const acceptOrder = async orderId => {
    // 固定 6 位司機，不再導向登入頁
    if (currentDriverId == null) {
      alert(t(lang, 'needBindDriverVehicle') || '請先綁定司機車輛')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/orders/${orderId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: currentDriverId }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`)

      const updatedOrder = normalizeOrderDriverId(data?.order || data)
      const did = getOrderDriverId(updatedOrder) ?? currentDriverId

      setOrders(prev => prev.map(o => (sameId(o.id, updatedOrder.id) ? { ...o, ...updatedOrder } : o)))
      setDrivers(prev => prev.map(d => (sameId(d.id, did) ? { ...d, status: 'busy' } : d)))

      emitOrderSync('order-accepted-confirm', {
        orderId: updatedOrder.id,
        driverId: did,
        order: { ...updatedOrder, driverId: did },
      })
      fetchAll()
    } catch (err) {
      console.error(err)
      setError(toMessage(t(lang, 'acceptOrderFailed')) || 'Accept order failed')
    } finally {
      setLoading(false)
    }
  }

  const bindDriverFromLoginResponse = driverObj => {
    if (!driverObj) return
    const driver0 = normalizeDriverLatLng(driverObj)
    const lp = loadLocalDriverPos(driver0.id)
    const driver = lp != null ? { ...driver0, lat: lp.lat, lng: lp.lng } : { ...driver0, lat: null, lng: null }

    setCurrentDriverId(driver.id)
    writeAuthDriverId(driver.id)

    setDrivers(prev => {
      const exists = prev.some(d => sameId(d.id, driver.id))
      return exists ? prev.map(d => (sameId(d.id, driver.id) ? driver : d)) : [...prev, driver]
    })

    if (lp) setDriverHotspotPosById(prev => ({ ...prev, [driver.id]: { lat: lp.lat, lng: lp.lng } }))
  }

    const switchPresetDriver = driverInfo => {
    if (!driverInfo?.id) return

    setCurrentDriverId(driverInfo.id)
    writeAuthDriverId(driverInfo.id)

    setDriverUser({
      username: driverInfo.username,
      role: 'driver',
      carType: driverInfo.carType,
    })

    setDrivers(prev =>
      prev.map(d =>
        sameId(d.id, driverInfo.id)
          ? { ...d, name: driverInfo.username, username: driverInfo.username, carType: driverInfo.carType }
          : d
      )
    )
  }

  const handleDriverLocationChange = ({ id, lat, lng }) => {
    setDrivers(prev => prev.map(d => (sameId(d.id, id) ? { ...d, lat, lng } : d)))
    setDriverHotspotPosById(prev => ({ ...prev, [id]: { lat, lng } }))
  }

    const registerUser = async ({ username, password, role, carType }) => {
    try {
      const res = await apiFetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role, carType: role === 'driver' ? carType : null }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, message: toMessage(data?.detail || data?.error || t(lang, 'registerFailed')) }

      if (role === 'driver') {
        setDriverUser({ username, role: 'driver' })
        writeDriverUser({ username, role: 'driver' })
        writeDriverCred({ username, carType: carType || null })

        const dRes = await apiFetch('/api/driver-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: username, carType }),
        })
        const dData = await dRes.json().catch(() => ({}))
        if (dRes.ok) bindDriverFromLoginResponse(dData)
      } else {
        const user = data?.user || data
        setPassengerUser({ username: user.username, role: 'passenger' })
        writePassengerUser({ username: user.username, role: 'passenger' })
        writePassengerCred({ username: user.username, password })
      }

      setShowLanding(false)
      setShowAuth(false)
      setShowHeatmap(false)

      if (role === 'driver') {
        setMode('driver')
        setUrlParams({ role: 'driver', auth: false })
      } else {
        setMode('rider')
        setUrlParams({ role: 'passenger', auth: false })
      }

      fetchAll()
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, message: toMessage(t(lang, 'networkError')) || 'Network error' }
    }
  }

    const loginUser = async ({ username, password, role }) => {
    try {
      const isDriverLogin = role === 'driver'
      const res = await apiFetch(isDriverLogin ? '/api/driver-login' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isDriverLogin ? { name: username, carType: null } : { username, password }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, message: toMessage(data?.detail || data?.error || t(lang, 'loginFailed')) }

      if (isDriverLogin) {
        setDriverUser({ username, role: 'driver' })
        writeDriverUser({ username, role: 'driver' })
        writeDriverCred({ username, carType: null })
        bindDriverFromLoginResponse(data)
      } else {
        const user = data?.user || data
        setPassengerUser({ username: user.username, role: 'passenger' })
        writePassengerUser({ username: user.username, role: 'passenger' })
        writePassengerCred({ username: user.username, password })
      }

      setShowLanding(false)
      setShowAuth(false)
      setShowHeatmap(false)

      if (isDriverLogin) {
        setMode('driver')
        setUrlParams({ role: 'driver', auth: false })
      } else {
        setMode('rider')
        setUrlParams({ role: 'passenger', auth: false })
      }

      fetchAll()
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, message: toMessage(t(lang, 'networkError')) || 'Network error' }
    }
  }

  // ------------------------------
  // ✅ 登出（只登出目前 mode 的那一端）
  // ------------------------------
  const logoutCurrentMode = () => {
    if (mode === 'driver') {
      try {
        if (currentDriverId != null) localStorage.removeItem(`driverLocConfirmed:${currentDriverId}`)
      } catch {}
      removeKey(AUTH_DRIVER_USER_KEY)
      removeKey(AUTH_DRIVER_CRED_KEY)
      removeKey(AUTH_DRIVER_ID_KEY)
      setDriverUser(null)
      setCurrentDriverId(null)
      setShowHeatmap(false)
    } else {
      removeKey(AUTH_PASSENGER_USER_KEY)
      removeKey(AUTH_PASSENGER_CRED_KEY)
      setPassengerUser(null)
    }

    setShowAuth(false)
    setShowLanding(true)
    setUrlParams({ role: null, auth: false })
  }

  const baseProps = {
    lang,
    loading,
    error,
    currentDriverId,
    setCurrentDriverId,
    createOrder,
    acceptOrder,
    refresh: fetchAll,
    currentUser,
    simulateVehicles,
    onOpenAuth: openAuth,
    onOrderCompleted: markOrderCompleted,
    onCarPosChange: handleCarPosChange,
    openStreetFollow,
    closeStreetFollow,
    streetFollowOpen,
    presetDriverGroups: PRESET_DRIVER_GROUPS,
    onSelectPresetDriver: switchPresetDriver,
  }

  // 初始 Landing
  if (showLanding) {
    return (
      <LandingPage
        lang={lang}
        onChangeLang={setLang}
        onPassengerClick={draft => {
          if (draft) {
            setRiderDraft(prev => ({
              ...prev,
              ...draft,
              stops: Array.isArray(draft.stops) ? draft.stops : prev.stops,
              composerLocked: false,
              composeMode: true,
              selectedOrderId: null,
            }))
          }
          setMode('rider')
          setShowLanding(false)
          setUrlParams({ role: 'passenger', auth: false })
        }}
        onDriverClick={() => {
          setMode('driver')
          setShowLanding(false)
          setUrlParams({ role: 'driver', auth: false })
        }}
        onAuthClick={() => openAuth('landing')}
      />
    )
  }

  const authDefaultRole = mode === 'driver' ? 'driver' : 'passenger'

  if (showAuth) {
    return (
      <div className="app-root">
        <header className="top-bar">
          <div className="top-bar-left">
            <span className="app-title">{t(lang, 'appTitle')}</span>
          </div>
          <div className="top-bar-center" />
          <div className="top-bar-right">
            <button type="button" className="header-back-btn" onClick={() => closeAuth()}>
              {t(lang, 'backHome')}
            </button>



            <button type="button" className="sim-toggle-btn" onClick={toggleSimulateVehicles}>
              {simulateVehicles ? t(lang, 'stopVehicleSim') : t(lang, 'startVehicleSim')}
            </button>
          </div>
        </header>

        <main className="auth-main">
          <AuthPage
            lang={lang}
            defaultRole={authDefaultRole}
            onBack={() => closeAuth()}
            onRegister={registerUser}
            onLogin={loginUser}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-root" style={{ position: 'relative' }}>
      <header className="app-header">
        <div className="app-title">{t(lang, 'appTitle')}</div>

        <div className="app-header-controls">
          {currentUser && (
            <span className="header-user-label">
              {mode === 'driver'
                ? `${t(lang, 'driverPrefix')}${currentUser.username}`
                : `${t(lang, 'passengerPrefix')}${currentUser.username}`}
            </span>
          )}

          {mode === 'driver' && (
            <button
              className="ghost-btn"
              style={{ marginLeft: 8 }}
              onClick={() => {
                if (currentDriverId == null) return
                setShowHeatmap(true)
              }}
            >
              AI 熱點建議
            </button>
          )}

          {/* ✅ 回首頁：不 reload */}
          <button
            className="header-back-btn"
            type="button"
            onClick={() => {
              setShowHeatmap(false)
              setShowAuth(false)
              setShowLanding(true)
              setUrlParams({ role: null, auth: false })
            }}
            style={{ marginLeft: 8 }}
          >
            {t(lang, 'backHome')}
          </button>

        </div>
      </header>

      <main className="app-main">
        {mode === 'rider' ? (
          <RiderView
            {...baseProps}
            drivers={drivers}
            orders={passengerOrders}
            ordersWithLocations={passengerOrdersWithLoc}
            initialDraft={riderDraft}
            onDraftChange={setRiderDraft}
          />
        ) : (
          <DriverView
            {...baseProps}
            drivers={drivers}
            orders={orders}
            ordersWithLocations={driverOrdersWithLoc}
            onDriverLocationChange={handleDriverLocationChange}
            hotspots={zones}
            showHotspots={false}
          />
        )}
      </main>

      {showHeatmap && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 9999, background: '#ffffff' }}>
          <DriverPage
            onBack={() => setShowHeatmap(false)}
            driverId={currentDriverId}
            drivers={drivers}
            orders={driverOrdersWithLoc}
            simulateVehicles={simulateVehicles}
            zones={zones}
            zonesLoading={zonesLoading}
            zonesError={zonesError}
          />
        </div>
      )}
    </div>
  )
}

export default function App() {
  if (API_CONFIG_ERROR) return <ApiConfigErrorScreen />
  return <MainApp />
}
