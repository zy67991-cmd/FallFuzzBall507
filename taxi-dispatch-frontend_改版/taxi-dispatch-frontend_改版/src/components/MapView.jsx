import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
  CircleMarker,
  Popup,
  Tooltip,
} from 'react-leaflet'
import L from 'leaflet'
import { useMemo, useEffect, useRef, useState, useCallback } from 'react'
import { taxiIcon, passengerIcon, dropoffIcon } from '../mapIcons'
import { t } from '../i18n'
import { apiFetch as defaultApiFetch } from '../apiBase.js'
import { snapRoad } from '../utils/roadSnap.js'

// ====== 設定 ======
const DEFAULT_CENTER = [40.758, -73.9855]
const DEFAULT_ZOOM = 11
const STEP_MS = 60
const HEADER_OFFSET_PX = 64

const FALLBACK_SPEED_KPH = 30
const ICON_HEADING_OFFSET_DEG = 0
const MIN_TRIP_DURATION_SEC = 45
const MAX_TRIP_DURATION_SEC = 75 * 60

const ORDER_START_PREFIX = 'orderStart:'
const ORDER_ROUTE_PREFIX = 'orderRoute:'
const SUMO_TRACE_URL = import.meta.env?.VITE_SUMO_TRACE_URL || '/sumo_traces/demo.json'
const ENABLE_SUMO_TRACE = String(import.meta.env?.VITE_ENABLE_SUMO_TRACE || '').trim() === '1'
const HOTSPOT_MOVE_TASK_KEY = 'hotspotMoveTaskV1'
const HOTSPOT_MOVE_EVT = 'hotspotMoveTaskChanged'
const DRIVER_LIVE_STATE_PREFIX = 'driverLiveState:'
const DRIVER_POS_EVT = 'driverPositionChanged'

function hotspotMoveTaskKey(driverId) {
  return `${HOTSPOT_MOVE_TASK_KEY}:${driverId ?? 'na'}`
}

// ====== 物理參數（fallback physics sim 用） ======
const CAR_ACCEL = 3.5
const CAR_DECEL = 4.0
const INITIAL_V = 2.0
const ARRIVAL_THRESHOLD_METERS = 15.0

const HEADING_LOOKAHEAD_METERS = 18
const HEADING_SMOOTH_TAU_MS = 0

const ACTIVE_STATUS_SET = new Set([
  'assigned', 'accepted', 'en_route', 'enroute',
  'picked_up', 'in_progress', 'on_trip', 'ongoing',
])

// ====== ✅ Playback Factor Shared Sync (driver/passenger 即時同步) ======
const PLAYBACK_LS_KEY = 'simPlaybackFactor'
const PLAYBACK_EVT = 'simPlaybackFactorChanged'

function readPlaybackFactor() {
  try {
    const v = Number(localStorage.getItem(PLAYBACK_LS_KEY) || '1')
    return Number.isFinite(v) && v > 0 ? v : 1
  } catch {
    return 1
  }
}

function writePlaybackFactor(v) {
  const x = Number(v)
  const val = Number.isFinite(x) && x > 0 ? x : 1
  try {
    localStorage.setItem(PLAYBACK_LS_KEY, String(val))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(PLAYBACK_EVT, { detail: { value: val } }))
  } catch {}
  return val
}

function usePlaybackFactorSync() {
  const [factor, setFactor] = useState(() => readPlaybackFactor())

  useEffect(() => {
    const onStorage = (e) => {
      if (e?.key !== PLAYBACK_LS_KEY) return
      const v = readPlaybackFactor()
      setFactor(v)
    }
    const onCustom = (e) => {
      const v = Number(e?.detail?.value)
      if (Number.isFinite(v) && v > 0) setFactor(v)
      else setFactor(readPlaybackFactor())
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(PLAYBACK_EVT, onCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(PLAYBACK_EVT, onCustom)
    }
  }, [])

  const update = useCallback((v) => {
    const val = writePlaybackFactor(v)
    setFactor(val)
  }, [])

  return [factor, update]
}

// ====== Utils ======
function sameId(a, b) {
  const A = Number(a)
  const B = Number(b)
  return Number.isFinite(A) && Number.isFinite(B) && A === B
}

function isValidLatLng(ll) {
  if (!ll) return false
  const lat = Number(ll.lat)
  const lng = Number(ll.lng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false

  return true
}

function isActiveStatus(status) {
  return ACTIVE_STATUS_SET.has(String(status || '').toLowerCase())
}
function getOrderDriverId(order) {
  return order?.driverId ?? order?.assignedDriverId ?? order?.driver_id ?? null
}
function getOrderKey(order) {
  if (order?._routeCacheKey) return String(order._routeCacheKey)

  const id = Number(order?.id)
  if (!Number.isFinite(id)) return null

  const driverId =
    order?._routeOwnerDriverId ??
    getOrderDriverId(order) ??
    'na'

  const createdAt = order?.createdAt || order?.created_at || ''

  return `sim_order_${id}_driver_${driverId}_${createdAt}`
}

function getRuntimeTrackKey(order) {
  return getOrderKey(order) || `order_${order?.id ?? 'na'}_driver_${getOrderDriverId(order) ?? 'na'}`
}

function canShowPassengerRoute(order) {
  const driverId = getOrderDriverId(order)
  if (driverId == null) return false

  const s = String(order?.status || '').toLowerCase()
  return [
    'assigned',
    'accepted',
    'en_route',
    'enroute',
    'picked_up',
    'in_progress',
    'on_trip',
    'ongoing',
  ].includes(s)
}
function canShowPassengerPlannedRoute(order) {
  const pickup = order?.pickupLocation
  const dropoff = order?.dropoffLocation

  return Boolean(
    pickup &&
    dropoff &&
    Number.isFinite(Number(pickup.lat)) &&
    Number.isFinite(Number(pickup.lng)) &&
    Number.isFinite(Number(dropoff.lat)) &&
    Number.isFinite(Number(dropoff.lng))
  )
}

// ====== Order Start LocalStorage ======
function readOrderStart(orderKey) {
  try {
    if (!orderKey) return null
    const raw = localStorage.getItem(`${ORDER_START_PREFIX}${orderKey}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeOrderStart(orderKey, latlng) {
  if (!orderKey || !latlng) return
  try {
    const k = `${ORDER_START_PREFIX}${orderKey}`
    localStorage.setItem(k, JSON.stringify(latlng))
  } catch {}
}
function writeOrderStartOnce(orderKey, latlng) {
  if (!orderKey || !latlng) return
  try {
    const k = `${ORDER_START_PREFIX}${orderKey}`
    if (localStorage.getItem(k)) return
    localStorage.setItem(k, JSON.stringify(latlng))
  } catch {}
}

function readOrderRoute(orderKey) {
  try {
    if (!orderKey) return null
    const raw = localStorage.getItem(`${ORDER_ROUTE_PREFIX}${orderKey}`)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed) || parsed.length < 2) return null
    const coords = parsed
      .map(p => {
        if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])]
        if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
          return [Number(p.lat), Number(p.lng)]
        }
        return null
      })
      .filter(Boolean)
    return coords.length >= 2 ? coords : null
  } catch {
    return null
  }
}
function writeOrderRoute(orderKey, coords) {
  try {
    if (!orderKey || !Array.isArray(coords) || coords.length < 2) return
    const normalized = coords
      .map(p => {
        if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])]
        if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
          return [Number(p.lat), Number(p.lng)]
        }
        return null
      })
      .filter(Boolean)
    if (normalized.length < 2) return
    localStorage.setItem(`${ORDER_ROUTE_PREFIX}${orderKey}`, JSON.stringify(normalized))
  } catch {}
}

function areRouteCoordsEqual(a, b, eps = 1e-7) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const pa = a[i]
    const pb = b[i]
    if (!Array.isArray(pa) || !Array.isArray(pb)) return false
    if (Math.abs(Number(pa[0]) - Number(pb[0])) > eps) return false
    if (Math.abs(Number(pa[1]) - Number(pb[1])) > eps) return false
  }

  return true
}

function mergeStableRoutes(prev, incoming) {
  const next = {}
  let changed = false

  for (const [key, route] of Object.entries(incoming || {})) {
    if (areRouteCoordsEqual(prev?.[key], route)) {
      next[key] = prev[key]
    } else {
      next[key] = route
      changed = true
    }
  }

  const prevKeys = Object.keys(prev || {})
  if (prevKeys.length !== Object.keys(next).length) changed = true
  else {
    for (const key of prevKeys) {
      if (!(key in next)) {
        changed = true
        break
      }
    }
  }

  return changed ? next : prev
}

function clearOrderRuntimeStorage(orderKey) {
  if (!orderKey) return
  try {
    localStorage.removeItem(`${ORDER_START_PREFIX}${orderKey}`)
    localStorage.removeItem(`${ORDER_ROUTE_PREFIX}${orderKey}`)
    localStorage.removeItem(simKey(orderKey))
  } catch {}
}

function emptyDashboardInfo() {
  return { speed: 0, sumoTime: 0, isSumo: false }
}

function readHotspotMoveTask() {
  try {
    const raw = localStorage.getItem(HOTSPOT_MOVE_TASK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function emitHotspotMoveTaskChanged(task) {
  try {
    window.dispatchEvent(new CustomEvent(HOTSPOT_MOVE_EVT, { detail: { task } }))
  } catch {}
}

function clearHotspotMoveTask(taskId = null, driverId = null) {
  try {
    if (driverId == null) return

    const raw = localStorage.getItem(hotspotMoveTaskKey(driverId))
    const cur = raw ? JSON.parse(raw) : null

    if (taskId != null && cur && Number(cur.taskId) !== Number(taskId)) return

    localStorage.removeItem(hotspotMoveTaskKey(driverId))

    window.dispatchEvent(
      new CustomEvent(HOTSPOT_MOVE_EVT, {
        detail: { task: null, driverId },
      })
    )
  } catch {}
}

function readDriverLiveState(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(`${DRIVER_LIVE_STATE_PREFIX}${driverId}`)
    if (!raw) return null
    const p = JSON.parse(raw)
    const lat = Number(p?.lat)
    const lng = Number(p?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      lat,
      lng,
      heading: Number(p?.heading ?? 0),
      speedKph: Number(p?.speedKph ?? 0),
    }
  } catch {
    return null
  }
}

function readDriverLoc(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(`driverLoc:${driverId}`)
    if (!raw) return null
    const p = JSON.parse(raw)
    const lat = Number(p?.lat)
    const lng = Number(p?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng, heading: 0, speedKph: 0 }
  } catch {
    return null
  }
}

function readDisplayDriverState(driver, usePersistedDriverLoc = true) {
  if (!driver) return null

  const driverId = driver?.id
  const persisted = usePersistedDriverLoc
    ? (readDriverLiveState(driverId) || readDriverLoc(driverId))
    : null

  const lat = Number(persisted?.lat ?? driver?.lat)
  const lng = Number(persisted?.lng ?? driver?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return {
    lat,
    lng,
    heading: Number(persisted?.heading ?? driver?.heading ?? 0),
    speedKph: Number(persisted?.speedKph ?? driver?.speedKph ?? 0),
  }
}

function writeDriverLiveState(driverId, payload) {
  try {
    if (driverId == null || !payload) return

    const lat = Number(payload.lat)
    const lng = Number(payload.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const next = {
      lat,
      lng,
      heading: Number(payload.heading ?? 0),
      speedKph: Number(payload.speedKph ?? 0),
      ts: Date.now(),
    }

    localStorage.setItem(`${DRIVER_LIVE_STATE_PREFIX}${driverId}`, JSON.stringify(next))
    localStorage.setItem(`driverLoc:${driverId}`, JSON.stringify({ lat, lng }))
    localStorage.setItem(`driverLocTs:${driverId}`, String(Date.now()))
    localStorage.setItem(`driverLocConfirmed:${driverId}`, '1')

    window.dispatchEvent(
      new CustomEvent(DRIVER_POS_EVT, {
        detail: { driverId: Number(driverId), pos: next },
      })
    )
  } catch {}
}

// ====== Driver Click Handler ======
function DriverClickHandler({ enabled, driverId, onLocationChange, apiFetch, onReject }) {
  const busyRef = useRef(false)

  useMapEvents({
    async click(e) {
      if (!enabled || driverId == null || typeof onLocationChange !== 'function') return
      if (busyRef.current) return
      busyRef.current = true
      const { lat, lng } = e.latlng
      const f = apiFetch || defaultApiFetch

      try {
        const snapped = await snapRoad(lat, lng, { apiFetch: f })
        if (!snapped.ok) {
          onReject?.('公園或非道路區域不能設定司機位置。')
          return
        }

        const payload = {
          id: driverId,
          lat: snapped.lat,
          lng: snapped.lng,
          roadName: snapped.roadName || '',
          snapDistanceM: snapped.distanceM ?? 0,
        }

        onReject?.('')
        onLocationChange(payload)

        f(`/api/drivers/${driverId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: snapped.lat, lng: snapped.lng }),
        }).catch(() => {})

        writeDriverLiveState(driverId, {
          lat: snapped.lat,
          lng: snapped.lng,
          heading: 0,
          speedKph: 0,
        })
      } finally {
        busyRef.current = false
      }
    },
  })
  return null
}

// ====== Resize Fixer ======
function MapSizeFixer({ deps = [] }) {
  const map = useMap()
  useEffect(() => {
    const run = () => { try { map.invalidateSize(true) } catch {} }
    const timer = requestAnimationFrame(() => {
      run()
      requestAnimationFrame(run)
    })
    return () => cancelAnimationFrame(timer)
  }, deps)
  return null
}

// ====== Map State Persistence ======
function mapStateKey({ mode, driverId, previewEnabled }) {
  return `mapState:${mode}:${driverId ?? 'na'}:${previewEnabled ? 'p1' : 'p0'}`
}
function writeMapState(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function readMapState(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function MapStateTracker({ storageKey, disabled = false, minIntervalMs = 800 }) {
  const map = useMap()
  const lastWriteRef = useRef(0)

  const tryWrite = useCallback(() => {
    if (disabled) return
    const now = Date.now()
    if (now - lastWriteRef.current < minIntervalMs) return
    const c = map.getCenter()
    writeMapState(storageKey, { lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    lastWriteRef.current = now
  }, [disabled, map, minIntervalMs, storageKey])

  useMapEvents({ moveend: tryWrite, zoomend: tryWrite })
  return null
}

function MapViewInitializer({ storageKey, streetViewMode, getInitialTarget }) {
  const map = useMap()

  useEffect(() => {
    try {
      if (streetViewMode) {
        const target = getInitialTarget?.()
        if (isValidLatLng(target)) {
          map.setView([Number(target.lat), Number(target.lng)], 18, { animate: false })
        } else {
          map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
        }
        return
      }

      const s = readMapState(storageKey)
      if (
        s &&
        Number.isFinite(Number(s.lat)) &&
        Number.isFinite(Number(s.lng)) &&
        Number.isFinite(Number(s.zoom)) &&
        !(Math.abs(Number(s.lat)) < 1e-9 && Math.abs(Number(s.lng)) < 1e-9)
      ) {
        map.setView([Number(s.lat), Number(s.lng)], Number(s.zoom), { animate: false })
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
      }
    } catch {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    }
  }, [storageKey, streetViewMode, map, getInitialTarget])

  return null
}

// ====== Route via backend ======
const routeSegmentCache = new Map()
const routeSegmentMetaCache = new Map()
function routeSegmentKey(from, to) {
  return [from?.lat, from?.lng, to?.lat, to?.lng].map(v => Number(v).toFixed(6)).join(',')
}

async function fetchRouteSegment(from, to, { signal } = {}) {
  const key = routeSegmentKey(from, to)
  const cached = routeSegmentCache.get(key)
  if (cached && Array.isArray(cached) && cached.length >= 2) return cached

const res = await defaultApiFetch('/api/route', {
  query: {
    fromLat: from.lat,
    fromLng: from.lng,
    toLat: to.lat,
    toLng: to.lng,
  },
  timeoutMs: 30000,
  signal,
  dedupe: false,
})

  if (!res.ok) throw new Error(`route api ${res.status}`)

  const data = await res.json()
  const coords = Array.isArray(data?.coords) ? data.coords : []

  if (coords.length < 2) throw new Error('route api no route')

  const parsed = coords.map(p => [Number(p[0]), Number(p[1])])
  const durationSec = Number(data?.duration_sec ?? data?.durationSec ?? data?.duration)
  const distanceKm = Number(data?.dist ?? data?.distance_km ?? data?.distanceKm)

  routeSegmentCache.set(key, parsed)
  routeSegmentMetaCache.set(key, {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
    distanceKm: Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null,
  })

  if (routeSegmentCache.size > 300) {
    const firstKey = routeSegmentCache.keys().next().value
    routeSegmentCache.delete(firstKey)
    routeSegmentMetaCache.delete(firstKey)
  }
  return parsed
}

async function fetchOsrmRoute(points, { signal } = {}) {
  if (!Array.isArray(points) || points.length < 2) return null

  const merged = []
  let durationSec = 0
  let hasDuration = false

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const seg = await fetchRouteSegment(from, to, { signal })
    const meta = routeSegmentMetaCache.get(routeSegmentKey(from, to))
    if (Number.isFinite(Number(meta?.durationSec)) && Number(meta.durationSec) > 0) {
      durationSec += Number(meta.durationSec)
      hasDuration = true
    }

    if (i === 0) merged.push(...seg)
    else merged.push(...seg.slice(1))
  }

  if (merged.length < 2) throw new Error('route api no route')
  return {
    coords: merged,
    durationSec: hasDuration ? durationSec : null,
  }
}

// ====== Waypoints Builder ======
function isSameLL(a, b, eps = 1e-6) {
  if (!a || !b) return false
  return Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps
}

function buildCarWaypoints(order, mode, drivers, currentDriverId, frozenStartPos = null) {
  const pickup = order?.pickupLocation
  const dropoff = order?.dropoffLocation
  const stops = Array.isArray(order?.stops) ? order.stops : []
  if (!pickup || !dropoff) return null

  const active = isActiveStatus(order.status)
  const driverId = getOrderDriverId(order)

  const visibleToThisView =
    mode === 'passenger' ||
    (mode === 'driver' &&
      driverId != null &&
      currentDriverId != null &&
      sameId(driverId, currentDriverId))

  const waypoints = []

  if (
    frozenStartPos &&
    Number.isFinite(Number(frozenStartPos.lat)) &&
    Number.isFinite(Number(frozenStartPos.lng))
  ) {
    waypoints.push({
      lat: Number(frozenStartPos.lat),
      lng: Number(frozenStartPos.lng),
    })
  } else if (visibleToThisView && driverId != null) {
    const liveDriver = drivers.find(x => sameId(x.id, driverId))
    if (
      liveDriver &&
      Number.isFinite(Number(liveDriver.lat)) &&
      Number.isFinite(Number(liveDriver.lng))
    ) {
      waypoints.push({
        lat: Number(liveDriver.lat),
        lng: Number(liveDriver.lng),
      })
    } else if (active) {
      return null
    } else {
      return null
    }
  } else {
    return null
  }

  if (!isSameLL(waypoints[waypoints.length - 1], pickup)) {
    waypoints.push({ lat: pickup.lat, lng: pickup.lng })
  }

  for (const s of stops) {
    const lat = Number(s?.lat)
    const lng = Number(s?.lng ?? s?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const type = String(s?.type || '').toLowerCase()
    if (type === 'driver' || type === 'pickup') continue

    const p = { lat, lng }
    if (isSameLL(p, pickup) || isSameLL(p, dropoff)) continue
    if (!isSameLL(waypoints[waypoints.length - 1], p)) waypoints.push(p)
  }

  if (!isSameLL(waypoints[waypoints.length - 1], dropoff)) {
    waypoints.push({ lat: dropoff.lat, lng: dropoff.lng })
  }

  return waypoints
}

function buildPlannedWaypoints(order) {
  const pickup = order?.pickupLocation
  const dropoff = order?.dropoffLocation
  const stops = Array.isArray(order?.stops) ? order.stops : []

  if (!pickup || !dropoff) return null

  const waypoints = [
    { lat: Number(pickup.lat), lng: Number(pickup.lng) }
  ]

  for (const s of stops) {
    const lat = Number(s?.lat)
    const lng = Number(s?.lng ?? s?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const type = String(s?.type || '').toLowerCase()
    if (type === 'driver' || type === 'pickup') continue

    waypoints.push({ lat, lng })
  }

  waypoints.push({
    lat: Number(dropoff.lat),
    lng: Number(dropoff.lng),
  })

  return waypoints
}

// ====== Simulation Logic ======
function simKey(k) { return `sim:${k}` }
function readSim(k) { try { return JSON.parse(localStorage.getItem(simKey(k))) } catch { return null } }
function writeSim(k, o) { try { localStorage.setItem(simKey(k), JSON.stringify(o)) } catch {} }

function resetSim(k) {
  const init = { elapsedMs: 0, startedAt: Date.now(), running: true, stepMs: STEP_MS, completed: false }
  writeSim(k, init)
  return init
}
function ensureSim(k) {
  const c = readSim(k)
  if (c) return c
  return resetSim(k)
}
function pauseSim(k) {
  const c = readSim(k)
  if (!c || !c.running || c.completed) return
  writeSim(k, {
    ...c,
    elapsedMs: (c.elapsedMs || 0) + Math.max(0, Date.now() - c.startedAt),
    running: false,
    startedAt: Date.now(),
  })
}
function resumeSim(k) {
  const c = readSim(k)
  if (!c || c.running || c.completed) return
  writeSim(k, { ...c, running: true, startedAt: Date.now() })
}
function computeElapsedMs(k) {
  const now = Date.now()
  const c = ensureSim(k)
  const total = (c.elapsedMs || 0) + (c.running ? Math.max(0, now - (c.startedAt || now)) : 0)
  return { elapsedMs: total, sim: c }
}
function completeSim(k) {
  const c = readSim(k) || {}
  writeSim(k, { ...c, running: false, completed: true, startedAt: Date.now() })
}

// ====== Math & Geo Utils ======
function toRad(d) { return (d * Math.PI) / 180 }
function normDeg(d) { return ((d % 360) + 360) % 360 }
function smoothLerpFactor(dtMs, tauMs) { return 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs)) }
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
function buildCumDist(coords) {
  if (!coords || coords.length < 2) return null
  const cum = new Array(coords.length).fill(0)
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
  }
  return cum
}
function positionAtDistance(coords, cum, d) {
  if (!coords || !cum) return null
  const total = cum[cum.length - 1]
  const dist = Math.max(0, Math.min(d, total))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < dist) i++
  const seg = (cum[i + 1] - cum[i])
  const ratio = seg > 1e-9 ? ((dist - cum[i]) / seg) : 0
  const [lat0, lng0] = coords[i]
  const [lat1, lng1] = coords[i + 1]
  return { lat: lat0 + (lat1 - lat0) * ratio, lng: lng0 + (lng1 - lng0) * ratio }
}

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function estimateFallbackDurationSec(routeLenM) {
  const km = Math.max(0, Number(routeLenM || 0) / 1000)
  const speedKph =
    km < 1.5 ? 18 :
    km < 4 ? 24 :
    km < 10 ? 30 :
    38

  return (km / Math.max(1, speedKph)) * 3600
}

function resolveRouteDurationSec(routeLenM, routeDurationSec, order) {
  const explicitSpeed = Number(order?.simSpeedKph)
  if (Number.isFinite(explicitSpeed) && explicitSpeed > 0 && routeLenM > 1) {
    return clampNumber((routeLenM / 1000 / explicitSpeed) * 3600, MIN_TRIP_DURATION_SEC, MAX_TRIP_DURATION_SEC)
  }

  const fromRoute = Number(routeDurationSec)
  if (Number.isFinite(fromRoute) && fromRoute > 0) {
    return clampNumber(fromRoute, MIN_TRIP_DURATION_SEC, MAX_TRIP_DURATION_SEC)
  }

  return clampNumber(estimateFallbackDurationSec(routeLenM), MIN_TRIP_DURATION_SEC, MAX_TRIP_DURATION_SEC)
}

function easeTripProgress(p) {
  const x = clampNumber(p, 0, 1)
  return x * x * (3 - 2 * x)
}

function easeTripDerivative(p) {
  const x = clampNumber(p, 0, 1)
  return 6 * x * (1 - x)
}

function computeHeadingDeg(from, to) {
  if (!from || !to) return null
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLng = toRad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

// ====== SUMO Utils ======
function resolveSumoVehicleId(json, order) {
  const v = json?.vehicles
  if (!v) return null

  const ids = Object.keys(v)
  if (!ids.length) return null

  const driverId = getOrderDriverId(order)

  const candidates = [
    order?.sumoVehicleId,
    order?.sumo_vehicle_id,
    order?.vehicleId,
    order?.vehicle_id,
    order?.taxiId,
    order?.taxi_id,
    driverId != null ? String(driverId) : null,
    driverId != null ? `taxi_${driverId}` : null,
    driverId != null ? `veh_${driverId}` : null,
    driverId != null ? `vehicle_${driverId}` : null,
    driverId != null ? `driver_${driverId}` : null,
  ]
    .map(x => (x == null ? null : String(x).trim()))
    .filter(Boolean)

  for (const id of candidates) {
    if (v[id]?.points?.length) return id
  }

  if (ids.length === 1 && v[ids[0]]?.points?.length) {
    return ids[0]
  }

  return null
}

function pickVehiclePoints(json, { order } = {}) {
  const v = json?.vehicles
  if (!v) return null

  const resolvedId = resolveSumoVehicleId(json, order)
  if (!resolvedId) return null

  const pts = v[resolvedId]?.points
  if (!Array.isArray(pts) || pts.length < 2) return null

  return [...pts].sort((a, b) => Number(a.t) - Number(b.t))
}

function buildSpeedProfile(points) {
  const times = []
  const speeds = []
  for (const p of points) {
    times.push(Number(p.t))
    speeds.push(Math.max(0, Number(p.speedMps ?? p.speed_mps)))
  }
  if (times.length < 2) return null

  const prefix = new Array(times.length).fill(0)
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1]
    prefix[i] = prefix[i - 1] + (speeds[i - 1] + speeds[i]) * 0.5 * dt
  }
  const totalTime = times[times.length - 1]
  const totalDist = prefix[prefix.length - 1]
  const startT = times[0]

  function distAt(t) {
    if (t <= startT) return 0
    if (t >= totalTime) return totalDist
    let l = 0
    let h = times.length - 1
    while (l + 1 < h) {
      const m = (l + h) >> 1
      times[m] <= t ? l = m : h = m
    }
    const i = l
    const ratio = (t - times[i]) / (times[i + 1] - times[i])
    const vAt = speeds[i] + (speeds[i + 1] - speeds[i]) * ratio
    return prefix[i] + (speeds[i] + vAt) * 0.5 * (t - times[i])
  }
  function speedAt(t) {
    if (t <= startT) return speeds[0]
    if (t >= totalTime) return speeds[speeds.length - 1]
    let l = 0
    let h = times.length - 1
    while (l + 1 < h) {
      const m = (l + h) >> 1
      times[m] <= t ? l = m : h = m
    }
    const ratio = (t - times[l]) / (times[l + 1] - times[l])
    return speeds[l] + (speeds[l + 1] - speeds[l]) * ratio
  }
  function angleAt(t) {
    let best = null
    let minD = Infinity
    for (const p of points) {
      const d = Math.abs(p.t - t)
      if (d < minD) {
        minD = d
        best = p
      }
    }
    return best ? Number(best.angle ?? best.heading) : null
  }

  return { totalTime, totalDist, startT, distAt, speedAt, angleAt }
}

// ====== Icons ======
const MAP_LANDMARKS = [
  { label: 'Times Sq', sub: '劇院區', lat: 40.758, lng: -73.9855 },
  { label: 'Penn', sub: '車站', lat: 40.7506, lng: -73.9935 },
  { label: 'Grand Central', sub: '車站', lat: 40.7527, lng: -73.9772 },
  { label: 'Central Park', sub: '公園', lat: 40.7812, lng: -73.9665 },
  { label: 'Wall St', sub: '金融區', lat: 40.706, lng: -74.0086 },
  { label: 'SoHo', sub: '商圈', lat: 40.7233, lng: -74.003 },
  { label: 'JFK', sub: '機場', lat: 40.6413, lng: -73.7781 },
  { label: 'LGA', sub: '機場', lat: 40.7769, lng: -73.874 },
]

const MAP_ROAD_SIGNS = [
  { label: 'I-495', lat: 40.7468, lng: -73.9294 },
  { label: 'FDR', lat: 40.7483, lng: -73.9658 },
  { label: '9A', lat: 40.7614, lng: -74.0028 },
  { label: 'I-278', lat: 40.7048, lng: -73.9958 },
  { label: 'BQE', lat: 40.6982, lng: -73.9825 },
  { label: 'Queens Blvd', lat: 40.7366, lng: -73.8772 },
]

function makeMapLabelIcon(label, sub = '') {
  const html = `
    <div class="map-landmark-badge">
      <span class="map-landmark-badge__label">${label}</span>
      ${sub ? `<span class="map-landmark-badge__sub">${sub}</span>` : ''}
    </div>`
  return L.divIcon({ className: '', html, iconSize: [96, 44], iconAnchor: [48, 22] })
}

function makeRoadShieldIcon(label) {
  const html = `<div class="map-road-shield">${label}</div>`
  return L.divIcon({ className: '', html, iconSize: [54, 28], iconAnchor: [27, 14] })
}

function makeTaxiIcon() {
  const svg = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 8C12 5.79086 13.7909 4 16 4H28C30.2091 4 32 5.79086 32 8V36C32 38.2091 30.2091 40 28 40H16C13.7909 40 12 38.2091 12 36V8Z" fill="black" fill-opacity="0.3" transform="translate(2, 2)"/><path d="M12 8C12 5.79086 13.7909 4 16 4H28C30.2091 4 32 5.79086 32 8V36C32 38.2091 30.2091 40 28 40H16C13.7909 40 12 38.2091 12 36V8Z" fill="#F4C430" stroke="#E6B800" stroke-width="1"/><path d="M14 10H30V16H14V10Z" fill="#333"/><path d="M14 30H30V34H14V30Z" fill="#333"/><rect x="18" y="20" width="8" height="4" rx="1" fill="#FFD700" stroke="#D4AF37" stroke-width="0.5"/><path d="M13 5H15V6H13V5Z" fill="#FFF" /><path d="M29 5H31V6H29V5Z" fill="#FFF" /><path d="M13 38H15V39H13V38Z" fill="#F00" /><path d="M29 38H31V39H29V38Z" fill="#F00" /></svg>`
  const html = `
    <div class="taxi-icon-root"
      style="
        width:44px;height:44px;
        display:flex;align-items:center;justify-content:center;
        transform-origin:22px 22px;
        transform: rotate(var(--rot, 0deg));
        will-change: transform;
      ">
      ${svg}
    </div>`
  return L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] })
}

function RotatedTaxiMarker({ position, opacity = 1, heading = 0 }) {
  const markerRef = useRef(null)

  useEffect(() => {
    const el = markerRef.current?.getElement?.()
    const iconRoot = el?.querySelector?.('.taxi-icon-root')
    if (iconRoot) iconRoot.style.transform = `rotate(${normDeg(Number(heading) || 0)}deg)`
  }, [heading, position])

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={makeTaxiIcon()}
      opacity={opacity}
    />
  )
}

function makeStopNumberIcon(n) {
  const num = String(n)
  const html = `
    <div style="
      width:28px;height:28px;border-radius:14px;
      background:#1976d2;color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:14px;
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 3px 10px rgba(0,0,0,0.35);
    ">${num}</div>`
  return L.divIcon({ className: '', html, iconSize: [28, 28], iconAnchor: [14, 14] })
}

// ====== Controls ======
function RecenterControl({ onClick, t, lang }) {
  return (
    <div
      className="leaflet-bottom leaflet-right"
      style={{ pointerEvents: 'none', marginBottom: '160px', marginRight: '10px', zIndex: 9999 }}
    >
      <div className="leaflet-control" style={{ pointerEvents: 'auto' }}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()

            // ✅ 只重新啟用跟車視角
            onClick?.()
          }}
          style={{
            backgroundColor: 'white',
            border: '2px solid rgba(0,0,0,0.2)',
            borderRadius: '24px',
            padding: '10px 20px',
            cursor: 'pointer',
            fontWeight: 'bold',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#333',
            fontSize: '14px',
          }}
        >
          <span style={{ fontSize: '18px' }}>⌖</span> {t(lang, 'recenter')}
        </button>
      </div>
    </div>
  )
}

function ReplaySpeedControl({ factor, onChange, debugInfo, autoOpen = false, autoOpenKey = null, lang }) {
  const [collapsed, setCollapsed] = useState(true)
  const [hasAutoOpened, setHasAutoOpened] = useState(false)

  const opts = [1, 2, 4, 8, 12, 16]
  const speed = Number(debugInfo?.speed ?? 0)
  const sumoTime = Number(debugInfo?.sumoTime ?? 0)
  const isSumo = Boolean(debugInfo?.isSumo)

  useEffect(() => {
    setHasAutoOpened(false)
  }, [autoOpenKey])

  useEffect(() => {
    if (autoOpen && !hasAutoOpened) {
      setCollapsed(false)
      setHasAutoOpened(true)
    }
  }, [autoOpen, hasAutoOpened])

  return (
    <div
      className="leaflet-top leaflet-left"
      style={{
        marginTop: `${HEADER_OFFSET_PX + 12}px`,
        marginLeft: '10px',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        className="leaflet-control"
        style={{
          pointerEvents: 'auto',
          background: 'rgba(255,255,255,0.92)',
          padding: collapsed ? '8px 10px' : '10px 12px',
          borderRadius: '12px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          fontSize: '12px',
          color: '#111',
          minWidth: collapsed ? 120 : 220,
          transition: 'all 0.25s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 800 }}>{t(lang, 'replaySpeedTitle')}</div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCollapsed(v => !v)
            }}
            style={{
              border: '1px solid rgba(0,0,0,0.15)',
              background: '#fff',
              borderRadius: '999px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '12px',
            }}
            aria-label={collapsed ? t(lang, 'expand') : t(lang, 'collapse')}
            title={collapsed ? t(lang, 'expand') : t(lang, 'collapse')}
          >
            {collapsed ? t(lang, 'expand') : t(lang, 'collapse')}
          </button>
        </div>

        {!collapsed && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {opts.map(v => {
                const active = Math.abs(v - Number(factor || 1)) < 1e-9
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onChange?.(v)
                    }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: active ? '2px solid rgba(0,0,0,0.65)' : '1px solid rgba(0,0,0,0.2)',
                      background: active ? '#111' : '#fff',
                      color: active ? '#fff' : '#111',
                      cursor: 'pointer',
                      fontWeight: 800,
                    }}
                    aria-label={`${v}x`}
                    title={`${v}x`}
                  >
                    {v}x
                  </button>
                )
              })}
            </div>

            <div style={{ marginTop: 6, color: '#111' }}>
              {t(lang, 'replaySpeedCurrent')} <b>{Number(factor || 1).toFixed(2)}x</b>
            </div>

            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid rgba(0,0,0,0.12)',
                fontFamily: 'monospace',
              }}
            >
              <div>
                <strong>{t(lang, 'traceLabel')}</strong>{' '}
                <span style={{ color: '#111' }}>{t(lang, 'replayLabel')}</span>
              </div>
              <div>
                {t(lang, 'sourceLabel')}{' '}
                <span style={{ fontWeight: 800, color: isSumo ? '#0a0' : '#c60' }}>
                  {isSumo ? t(lang, 'sumoLabel') : t(lang, 'physicsLabel')}
                </span>
              </div>
              <div>{t(lang, 'speedLabel')} {Math.round(speed)} {t(lang, 'speedUnit')}</div>
              <div>{t(lang, 'timeShortLabel')} {Number.isFinite(sumoTime) ? sumoTime.toFixed(2) : '0.00'} {t(lang, 'timeSecondUnit')}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CarFollowController({ enabled, getActiveCarState, onUserInteraction }) {
  const map = useMap()
  const getActiveCarStateRef = useRef(getActiveCarState)
  const camRef = useRef({ lat: null, lng: null })
  const lastPerfRef = useRef(0)
  const lastMapSetRef = useRef(0)

  useEffect(() => {
    getActiveCarStateRef.current = getActiveCarState
  }, [getActiveCarState])

  useMapEvents({
    dragstart: () => onUserInteraction && onUserInteraction(),
    zoomstart: () => onUserInteraction && onUserInteraction(),
  })

  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      const s = getActiveCarStateRef.current?.()
      if (
        !s ||
        !Number.isFinite(Number(s.lat)) ||
        !Number.isFinite(Number(s.lng)) ||
        (Math.abs(Number(s.lat)) < 1e-9 && Math.abs(Number(s.lng)) < 1e-9)
      ) return

      const dt = Math.max(0, t - (lastPerfRef.current || t))
      lastPerfRef.current = t

      if (camRef.current.lat == null) {
        camRef.current = { lat: Number(s.lat), lng: Number(s.lng) }
        map.setView([s.lat, s.lng], map.getZoom(), { animate: false })
        return
      }

      const kPos = smoothLerpFactor(dt, 40)
      camRef.current.lat += (Number(s.lat) - camRef.current.lat) * kPos
      camRef.current.lng += (Number(s.lng) - camRef.current.lng) * kPos

      if (t - Number(lastMapSetRef.current || 0) >= 33) {
        lastMapSetRef.current = t
        map.setView([camRef.current.lat, camRef.current.lng], map.getZoom(), {
          animate: false,
          noMoveStart: true,
        })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [enabled, map])

  return null
}

function CarRuntimeLayer({
  order,
  routeCoords,
  cumDist,
  sumoJson,
  simulateVehicles,
  completedOrderIds,
  completedOnceRef,
  lastCarPosRef,
  stashCarPos,
  onOrderArrived,
  onOrderCompleted,
  setDebugInfo,
  onDashboardUpdate,
  mode,
  driverStartPos,
  playbackFactor = 1,
  routeDurationSec = null,
}) {
  const map = useMap()
  const groupRef = useRef(null)
  const markerRef = useRef(null)
  const aheadRef = useRef(null)
  const rafRef = useRef(0)

  const orderRef = useRef(order)
  const routeRef = useRef(routeCoords)
  const cumRef = useRef(cumDist)
  const simRef = useRef(simulateVehicles)

  const playbackRef = useRef(Number(playbackFactor) || 1)
  const routeDurationRef = useRef(Number(routeDurationSec) || null)
  const lastDriverPersistRef = useRef({ driverId: null, ts: 0 })

  const currentDistRef = useRef(0)
  const currentSpeedRef = useRef(INITIAL_V)
  const lastTimeRef = useRef(0)
  const routeLenRef = useRef(0)

  const headingRef = useRef(0)

  function shortestAngleDeltaDeg(a, b) {
    return ((b - a + 540) % 360) - 180
  }

  function computeRouteHeadingDeg(routeCoords_, cumDist_, distM, lookaheadM) {
    if (!routeCoords_ || !cumDist_) return null

    const total = Number(cumDist_[cumDist_.length - 1])
    if (!(total > 1)) return null

    const look = Math.max(8, Number(lookaheadM) || 18)
    const cur = Math.max(0, Math.min(Number(distM) || 0, total))

    let d0 = cur
    let d1 = Math.min(cur + look, total)

    // 接近終點時，前方沒有距離可看，改用後方一小段推車頭方向
    if (d1 - d0 < 2) {
      d1 = cur
      d0 = Math.max(0, cur - look)
    }

    if (d1 - d0 < 2) return null

    const p0 = positionAtDistance(routeCoords_, cumDist_, d0)
    const p1 = positionAtDistance(routeCoords_, cumDist_, d1)
    if (!p0 || !p1) return null

    const moved = haversineMeters(p0.lat, p0.lng, p1.lat, p1.lng)
    if (!(moved > 1)) return null

    const h = computeHeadingDeg(p0, p1)
    return Number.isFinite(h) ? h : null
  }

  useEffect(() => { orderRef.current = order }, [order])
  useEffect(() => { routeRef.current = routeCoords }, [routeCoords])
  useEffect(() => { cumRef.current = cumDist }, [cumDist])
  useEffect(() => { simRef.current = simulateVehicles }, [simulateVehicles])
  useEffect(() => { playbackRef.current = Number(playbackFactor) || 1 }, [playbackFactor])
  useEffect(() => {
    const n = Number(routeDurationSec)
    routeDurationRef.current = Number.isFinite(n) && n > 0 ? n : null
  }, [routeDurationSec])

  useEffect(() => {
    if (cumDist && cumDist.length > 0) routeLenRef.current = cumDist[cumDist.length - 1]
    else routeLenRef.current = 0
  }, [cumDist])

  const shouldRender = useMemo(() => {
    if (!order?.id) return false
    if (completedOrderIds?.has(order.id)) return false
    if (mode === 'passenger' && !getOrderDriverId(order)) return false
    return true
  }, [order, mode, completedOrderIds])

  useEffect(() => {
    if (!shouldRender) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g

    const route0 = Array.isArray(routeCoords) && routeCoords.length ? routeCoords[0] : null
    const startLL =
      (Array.isArray(driverStartPos) && driverStartPos.length === 2)
        ? driverStartPos
        : (route0 ? [route0[0], route0[1]] : [map.getCenter().lat, map.getCenter().lng])

    markerRef.current = L.marker(startLL, { icon: makeTaxiIcon() })
      .bindTooltip('0 km/h', {
        permanent: true,
        direction: 'right',
        offset: [20, 0],
        className: 'speed-tooltip',
      })
      .addTo(g)

    aheadRef.current = L.polyline([startLL, startLL], {
      weight: 2,
      color: 'rgba(0,0,0,0.2)',
    }).addTo(g)

    return () => {
      try { map.removeLayer(g) } catch {}
    }
  }, [map, shouldRender, order?.id])

  const profileRef = useRef(null)

  useEffect(() => {
    const ok = getOrderKey(orderRef.current)
    if (!ok) return

    ensureSim(ok)

    const { elapsedMs } = computeElapsedMs(ok)
    currentDistRef.current = (elapsedMs / 1000) * (FALLBACK_SPEED_KPH / 3.6)
    currentSpeedRef.current = INITIAL_V
    lastTimeRef.current = 0
    headingRef.current = 0

    if (!sumoJson) {
      profileRef.current = null
      return
    }

    const pts = pickVehiclePoints(sumoJson, { order: orderRef.current })
    profileRef.current = pts ? buildSpeedProfile(pts) : null
  }, [sumoJson, order?.id])

  useEffect(() => {
    if (!shouldRender) return
    const oid = order.id
    const ok = getOrderKey(order)
    const trackKey = getRuntimeTrackKey(order)
    if (!ok || !trackKey) return

    ensureSim(ok)

    const restored = computeElapsedMs(ok)
    const restoredElapsedMs = Number(restored?.elapsedMs ?? 0)
    const restoredSpeedMps = FALLBACK_SPEED_KPH / 3.6
    currentDistRef.current = Math.max(0, (restoredElapsedMs / 1000) * restoredSpeedMps)
    lastTimeRef.current = 0

    const loop = (time) => {
      rafRef.current = requestAnimationFrame(loop)
      if (!lastTimeRef.current) lastTimeRef.current = time
      const dtMs = Math.max(0, time - lastTimeRef.current)
      lastTimeRef.current = time

      if (!simRef.current || !isActiveStatus(orderRef.current?.status)) return

      const { elapsedMs } = computeElapsedMs(ok)
      const pf = playbackRef.current || 1

      const tSec = (elapsedMs / 1000) * pf

      let lat = 0
      let lng = 0
      let speedKph = 0
      let heading = 0
      const profile = profileRef.current
      let isSumoActive = false
      let distOnRoute = null
      let sumoAngle = null

      if (profile && routeLenRef.current > 1 && profile.totalDist > 0) {
        isSumoActive = true

        const traceSec = profile.startT + tSec
        const rawDist = profile.distAt(traceSec)
        const rawSpeedMps = profile.speedAt(traceSec)
        sumoAngle = profile.angleAt(traceSec)

        const scale = routeLenRef.current / Math.max(1, profile.totalDist)
        distOnRoute = rawDist * scale

        const shownSpeedMps = rawSpeedMps * scale
        speedKph = Math.round(shownSpeedMps * 3.6)
      } else {
        if (routeRef.current && routeRef.current.length >= 2) {
          const simState = readSim(ok)
          const totalDist = cumRef.current ? Number(cumRef.current[cumRef.current.length - 1]) : 0
          const durationSec = resolveRouteDurationSec(totalDist, routeDurationRef.current, orderRef.current)

          if (!simState || !simState.running || !(totalDist > 1)) {
            speedKph = 0
            distOnRoute = currentDistRef.current
          } else {
            const progress = clampNumber(tSec / Math.max(1, durationSec), 0, 1)
            const eased = easeTripProgress(progress)
            const targetDist = Math.min(totalDist, totalDist * eased)
            const rawSpeedMps = (totalDist / Math.max(1, durationSec)) * easeTripDerivative(progress)
            const minCruiseMps = Math.min(FALLBACK_SPEED_KPH / 3.6, totalDist / Math.max(1, durationSec))

            distOnRoute = targetDist
            currentDistRef.current = targetDist
            currentSpeedRef.current = progress >= 1 ? 0 : Math.max(0, rawSpeedMps || minCruiseMps)
            speedKph = progress >= 1 ? 0 : Math.round(currentSpeedRef.current * 3.6)
          }
        }
      }

      let pos = null
      if (distOnRoute != null && cumRef.current) {
        pos = positionAtDistance(routeRef.current, cumRef.current, distOnRoute)
      } else if (!isSumoActive) {
        const idx = Math.min(Math.floor(elapsedMs / STEP_MS), (routeRef.current?.length ?? 1) - 1)
        const p = routeRef.current?.[idx]
        if (p) pos = { lat: p[0], lng: p[1] }
      }

      if (pos) {
        lat = pos.lat
        lng = pos.lng

        const safeDist = Number.isFinite(distOnRoute) ? distOnRoute : 0
        const routeHeading = computeRouteHeadingDeg(
          routeRef.current,
          cumRef.current,
          safeDist,
          HEADING_LOOKAHEAD_METERS
        )

        let rawHeading = null
        if (Number.isFinite(routeHeading)) rawHeading = routeHeading
        else if (isSumoActive && Number.isFinite(sumoAngle)) rawHeading = normDeg(sumoAngle)
        else {
        const prev = lastCarPosRef.current.get(trackKey)          
        const h = prev ? computeHeadingDeg(prev, { lat, lng }) : null
          rawHeading = Number.isFinite(h) ? h : (prev?.heading || 0)
        }

        const cur = Number(headingRef.current || 0)
        const raw = normDeg(rawHeading)
        const headingOut = HEADING_SMOOTH_TAU_MS > 0
          ? normDeg(cur + shortestAngleDeltaDeg(cur, raw) * smoothLerpFactor(dtMs, HEADING_SMOOTH_TAU_MS))
          : raw

        headingRef.current = headingOut
        heading = headingOut
      }

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        !(Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9)
      ) {
        const posData = { lat, lng, heading, speedKph }
        lastCarPosRef.current.set(trackKey, posData)
        stashCarPos(trackKey, posData, oid)

        const movingDriverId = getOrderDriverId(orderRef.current)
        if (movingDriverId != null) {
          const nowPersist = Date.now()
          const lastPersist = lastDriverPersistRef.current
          const shouldPersist =
            lastPersist.driverId !== movingDriverId ||
            nowPersist - Number(lastPersist.ts || 0) >= 300

          // 地圖動畫每幀只更新 Leaflet marker；localStorage / 自訂事件降頻同步，避免縮放時被大量同步寫入卡住。
          if (shouldPersist) {
            writeDriverLiveState(movingDriverId, posData)
            lastDriverPersistRef.current = { driverId: movingDriverId, ts: nowPersist }
          }
        }
      }

      if (markerRef.current && lat !== 0) {
        markerRef.current.setLatLng([lat, lng])

        const tooltip = markerRef.current.getTooltip()
        if (tooltip) tooltip.setContent(`${speedKph} km/h`)

        const el = markerRef.current.getElement()
        const iconRoot = el?.querySelector?.('.taxi-icon-root')
        if (iconRoot) {
          const rot = normDeg(heading + ICON_HEADING_OFFSET_DEG)
          iconRoot.style.transform = `rotate(${rot}deg)`
        }
      }

      const rlen = Number(routeLenRef.current || 0)
      const routeReadyForCompletion =
        Array.isArray(routeRef.current) &&
        routeRef.current.length >= 2 &&
        cumRef.current &&
        rlen > ARRIVAL_THRESHOLD_METERS * 2

      const isCompletedCheck =
        routeReadyForCompletion &&
        !completedOrderIds?.has(oid) &&
        !completedOnceRef.current.has(ok) &&
        Number.isFinite(distOnRoute) &&
        distOnRoute >= Math.max(0, rlen - ARRIVAL_THRESHOLD_METERS)

      if (isCompletedCheck) {
        const routeNow = routeRef.current
        const endPoint =
          Array.isArray(routeNow) && routeNow.length >= 2
            ? routeNow[routeNow.length - 1]
            : null

        const finalLat = Array.isArray(endPoint) ? Number(endPoint[0]) : Number(lat)
        const finalLng = Array.isArray(endPoint) ? Number(endPoint[1]) : Number(lng)

        const finalPayload = {
          lat: finalLat,
          lng: finalLng,
          heading,
          speedKph: 0,
        }

        completedOnceRef.current.add(ok)
        completeSim(ok)

        const movingDriverId = getOrderDriverId(orderRef.current)
        if (
          movingDriverId != null &&
          Number.isFinite(finalLat) &&
          Number.isFinite(finalLng)
        ) {
          writeDriverLiveState(movingDriverId, finalPayload)
          try {
            localStorage.setItem(
              `driverLoc:${movingDriverId}`,
              JSON.stringify({ lat: finalLat, lng: finalLng })
            )
            localStorage.setItem(`driverLocTs:${movingDriverId}`, String(Date.now()))
            localStorage.setItem(`driverLocConfirmed:${movingDriverId}`, '1')
          } catch {}
        }

        lastCarPosRef.current.set(trackKey, finalPayload)
        stashCarPos(trackKey, finalPayload, oid, { force: true })

        if (onDashboardUpdate) onDashboardUpdate(ok, emptyDashboardInfo(), { force: true })
        else if (setDebugInfo) setDebugInfo(emptyDashboardInfo())

        if (onOrderCompleted) onOrderCompleted(oid, finalPayload)

        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = 0
        }
        return
        }

      if (onDashboardUpdate) {
        onDashboardUpdate(ok, { speed: speedKph, sumoTime: tSec, isSumo: isSumoActive })
      } else if (setDebugInfo) {
        setDebugInfo({ speed: speedKph, sumoTime: tSec, isSumo: isSumoActive })
      }
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [order?.id, stashCarPos, shouldRender, completedOrderIds, onOrderCompleted, setDebugInfo, onDashboardUpdate])

  return null
}

function VisibilitySimSync({ orders = [], simulateVehicles }) {
  useEffect(() => {
    const onVis = () => {
      const hidden = document.visibilityState !== 'visible'
      for (const o of orders) {
        const k = getOrderKey(o)
        if (!k) continue
        if (hidden) pauseSim(k)
        else if (simulateVehicles) resumeSim(k)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [orders, simulateVehicles])
  return null
}

export default function MapView({
  lang,
  mode,
  drivers = [],
  orders = [],
  currentDriverId,
  onDriverLocationChange,
  simulateVehicles = true,
  apiFetch,
  onCarPosChange,
  previewEnabled = false,
  previewWaypoints = null,
  previewMarkers = null,
  onHotspotSelect = null,
  selectedHotspot = null,
  completedOrderIds,
  onOrderArrived,
  onOrderCompleted,
  usePersistedDriverLoc = true,
  followActiveCar = null,
  hotspots = [],
  driverClickEnabled = true,
  rotateMapWithHeading = true,
}) {
  const isDriverMode = mode === 'driver'
  const useApiFetch = apiFetch || defaultApiFetch

  const [playbackFactor, setPlaybackFactor] = usePlaybackFactorSync()

  const [debugInfo, setDebugInfo] = useState(() => emptyDashboardInfo())
  const [sumoJson, setSumoJson] = useState(null)
  const [visualRoutes, setVisualRoutes] = useState({})
  const [driverPickWarning, setDriverPickWarning] = useState('')
  const routeMetaRef = useRef(new Map())

  useEffect(() => {
    if (!driverClickEnabled) setDriverPickWarning('')
  }, [driverClickEnabled, currentDriverId])

    useEffect(() => {
    setVisualRoutes({})
    try {
      cumRef.current.clear()
      lastCarPosRef.current.clear()
      latestCarStateRef.current.clear()
      arrivedOnceRef.current.clear()
      routeMetaRef.current.clear()
    } catch {}
  }, [mode, currentDriverId])
  
  useEffect(() => {
    if (!ENABLE_SUMO_TRACE) {
      setSumoJson(null)
      return
    }

    fetch(SUMO_TRACE_URL)
      .then(res => res.json())
      .then(data => setSumoJson(data))
      .catch(err => console.warn('SUMO Trace load failed:', err))
  }, [])

  const streetViewMode = useMemo(() => {
    if (previewEnabled) return false
    const o = orders[0]
    if (!o || !isActiveStatus(o.status)) return false
    const did = getOrderDriverId(o)
    if (!isDriverMode) return did != null
    return currentDriverId != null && did != null && sameId(did, currentDriverId)
  }, [previewEnabled, orders, isDriverMode, currentDriverId])

  const [isFollowing, setIsFollowing] = useState(true)

  const [tileUrl, setTileUrl] = useState('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png')

  const cumRef = useRef(new Map())
  const lastCarPosRef = useRef(new Map())
  const latestCarStateRef = useRef(new Map())
  const arrivedOnceRef = useRef(new Set())
  const completedOnceRef = useRef(new Set())
  const [locallyCompletedOrderIds, setLocallyCompletedOrderIds] = useState(() => new Set())
  const dashboardByOrderRef = useRef(new Map())
  const lastDashboardSetRef = useRef(0)
  const lastExternalCarPosEmitRef = useRef(new Map())
  const runtimeOrdersRef = useRef([])
  const ordersRefForDashboard = useRef([])

  const updateDashboardInfo = useCallback((orderKey, info, opts = {}) => {
    if (!orderKey) return
    const next = {
      speed: Number(info?.speed ?? 0),
      sumoTime: Number(info?.sumoTime ?? 0),
      isSumo: Boolean(info?.isSumo),
    }
    dashboardByOrderRef.current.set(orderKey, next)

    const now = Date.now()
    if (!opts.force && now - lastDashboardSetRef.current < 250) return
    lastDashboardSetRef.current = now

    const active = runtimeOrdersRef.current?.[0] || ordersRefForDashboard.current?.[0] || null
    const activeKey = active ? getOrderKey(active) : null
    setDebugInfo(activeKey ? (dashboardByOrderRef.current.get(activeKey) || emptyDashboardInfo()) : emptyDashboardInfo())
  }, [])

  const stashCarPos = useCallback((trackKey, val, orderId = null, opts = {}) => {
    const now = Date.now()
    latestCarStateRef.current.set(trackKey, { ...val, ts: now })
    if (orderId != null) {
      latestCarStateRef.current.set(orderId, { ...val, ts: now })
    }

    const emitKey = orderId ?? trackKey
    const last = Number(lastExternalCarPosEmitRef.current.get(emitKey) || 0)
    if (opts.force || now - last >= 300) {
      lastExternalCarPosEmitRef.current.set(emitKey, now)
      onCarPosChange?.(emitKey, val)
    }
  }, [onCarPosChange])

  const runtimeOrders = useMemo(() => {
    const result = []
    const seenDriverIds = new Set()

    const sorted = [...orders].sort((a, b) => {
      const ta = Date.parse(a?.updatedAt || a?.updated_at || a?.createdAt || a?.created_at || 0) || 0
      const tb = Date.parse(b?.updatedAt || b?.updated_at || b?.createdAt || b?.created_at || 0) || 0
      if (ta !== tb) return tb - ta
      return Number(b?.id || 0) - Number(a?.id || 0)
    })

    for (const o of sorted) {
      if (!o?.id) continue
      if (completedOrderIds?.has?.(o.id) || locallyCompletedOrderIds.has(Number(o.id))) continue

      const driverId = getOrderDriverId(o)

      if (driverId == null) continue
      if (!isActiveStatus(o?.status)) continue
      if (mode === 'passenger' && !canShowPassengerRoute(o)) continue

      if (
        mode === 'driver' &&
        currentDriverId != null &&
        !sameId(driverId, currentDriverId)
      ) {
        continue
      }

      const key = Number(driverId)
      if (seenDriverIds.has(key)) continue
      seenDriverIds.add(key)

      result.push(o)
    }

    return result
  }, [orders, completedOrderIds, locallyCompletedOrderIds, mode, currentDriverId])

  useEffect(() => {
    runtimeOrdersRef.current = runtimeOrders
    ordersRefForDashboard.current = orders
    const active = runtimeOrders[0] || orders?.[0] || null
    const activeKey = active ? getOrderKey(active) : null
    setDebugInfo(activeKey ? (dashboardByOrderRef.current.get(activeKey) || emptyDashboardInfo()) : emptyDashboardInfo())
  }, [runtimeOrders, orders])

  const frozenStartPosByOrderId = useMemo(() => {
    const out = new Map()

    for (const o of orders) {
      const orderKey = getOrderKey(o)
      if (!orderKey) continue

      let start = readOrderStart(orderKey)

      if (
        !start ||
        !Number.isFinite(Number(start.lat)) ||
        !Number.isFinite(Number(start.lng))
      ) {
        const drvId = getOrderDriverId(o)
        const hasAssignedDriver = drvId != null && isActiveStatus(o?.status)
        if (!hasAssignedDriver) continue

        const livePersisted =
          usePersistedDriverLoc && drvId != null
            ? (() => {
                try {
                  const raw = localStorage.getItem(`driverLoc:${drvId}`)
                  if (!raw) return null
                  const parsed = JSON.parse(raw)
                  const lat = Number(parsed?.lat)
                  const lng = Number(parsed?.lng)
                  if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    return { lat, lng }
                  }
                  return null
                } catch {
                  return null
                }
              })()
            : null

        if (livePersisted) {
          start = { lat: Number(livePersisted.lat), lng: Number(livePersisted.lng) }
          writeOrderStartOnce(orderKey, start)
        } else {
          const drv = drivers.find(d => sameId(d.id, drvId))
          if (
            drv &&
            Number.isFinite(Number(drv.lat)) &&
            Number.isFinite(Number(drv.lng))
          ) {
            start = { lat: Number(drv.lat), lng: Number(drv.lng) }
            writeOrderStartOnce(orderKey, start)
          }
        }
      }

      if (
        start &&
        Number.isFinite(Number(start.lat)) &&
        Number.isFinite(Number(start.lng))
      ) {
        out.set(o.id, start)
      }
    }

    return out
  }, [orders, drivers, usePersistedDriverLoc])

const hasTrackTarget = useMemo(() => {
  const active = runtimeOrders[0] || orders?.[0]
  if (!active?.id) return false

  const did = getOrderDriverId(active)
  if (isValidLatLng(readDriverLiveState(did))) return true
  if (isValidLatLng(readDriverLoc(did))) return true

  const frozenStart = frozenStartPosByOrderId.get(active.id)
  if (isValidLatLng(frozenStart)) return true

  const route = readOrderRoute(getOrderKey(active))
  return Array.isArray(route) && route.length >= 2
}, [runtimeOrders, orders, frozenStartPosByOrderId])

  useEffect(() => {
    const canFollow = !previewEnabled && (streetViewMode || (followActiveCar && hasTrackTarget))
    if (canFollow) setIsFollowing(true)
  }, [streetViewMode, followActiveCar, hasTrackTarget, previewEnabled])

  const shouldFollow = useMemo(() => {
    if (!isFollowing) return false
    if (previewEnabled) return false
    return Boolean(streetViewMode || (followActiveCar && hasTrackTarget))
  }, [isFollowing, streetViewMode, followActiveCar, hasTrackTarget, previewEnabled])

  const storageKey = mapStateKey({ mode, driverId: currentDriverId, previewEnabled })

  const getActiveCarState = useCallback(() => {
    const active = runtimeOrders[0] || orders?.[0]
    if (!active?.id) return null

    const activeTrackKey = getRuntimeTrackKey(active)
    const live = latestCarStateRef.current.get(activeTrackKey) || latestCarStateRef.current.get(active.id)
    if (isValidLatLng(live)) {
      return {
        ...live,
        lat: Number(live.lat),
        lng: Number(live.lng),
      }
    }

    const did = getOrderDriverId(active)

    const liveDriver = readDriverLiveState(did)
    if (isValidLatLng(liveDriver)) {
      return liveDriver
    }

    const persistedDriver = readDriverLoc(did)
    if (isValidLatLng(persistedDriver)) {
      return persistedDriver
    }

    const frozenStart = frozenStartPosByOrderId.get(active.id)
    if (isValidLatLng(frozenStart)) {
      return {
        lat: Number(frozenStart.lat),
        lng: Number(frozenStart.lng),
        heading: 0,
        speedKph: 0,
      }
    }

    const route = readOrderRoute(getOrderKey(active))
    if (Array.isArray(route) && route.length >= 2) {
      return {
        lat: Number(route[0][0]),
        lng: Number(route[0][1]),
        heading: 0,
        speedKph: 0,
      }
    }

    return null
  }, [runtimeOrders, orders, frozenStartPosByOrderId])

  const handleRecenter = useCallback(() => {
    setIsFollowing(true)
  }, [])
  const activeTrackedOrder = runtimeOrders[0] || null

  const shouldAutoOpenReplayCard = useMemo(() => {
    return Boolean(
      shouldFollow &&
      activeTrackedOrder?.id != null &&
      mode === 'driver'
    )
  }, [shouldFollow, activeTrackedOrder, mode])

  const replayCardAutoOpenKey = activeTrackedOrder?.id ?? null

    const handleLocalOrderCompleted = useCallback((oid, lastPos) => {
    setLocallyCompletedOrderIds(prev => {
      const id = Number(oid)
      if (!Number.isFinite(id) || prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })

    const order = orders.find(o => sameId(o.id, oid))
    const drvId = getOrderDriverId(order)
    const orderKey = getOrderKey(order)

    const dropoff = order?.dropoffLocation
    const payload =
      lastPos &&
      Number.isFinite(Number(lastPos.lat)) &&
      Number.isFinite(Number(lastPos.lng))
        ? {
            lat: Number(lastPos.lat),
            lng: Number(lastPos.lng),
            heading: Number(lastPos.heading ?? 0),
            speedKph: 0,
          }
        : dropoff &&
          Number.isFinite(Number(dropoff.lat)) &&
          Number.isFinite(Number(dropoff.lng))
        ? {
            lat: Number(dropoff.lat),
            lng: Number(dropoff.lng),
            heading: 0,
            speedKph: 0,
          }
        : null

    if (drvId && payload) {
      onDriverLocationChange?.({ id: drvId, ...payload })

      try {
        localStorage.setItem(`driverLoc:${drvId}`, JSON.stringify({
          lat: payload.lat,
          lng: payload.lng,
        }))
        localStorage.setItem(`driverLocTs:${drvId}`, String(Date.now()))
        localStorage.setItem(`driverLocConfirmed:${drvId}`, '1')
      } catch {}

      writeDriverLiveState(drvId, payload)

      const f = apiFetch || defaultApiFetch
      f(`/api/drivers/${drvId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: payload.lat, lng: payload.lng }),
      }).catch(() => {})
    }

    if (order?._isHotspotMove) {
      if (drvId && payload) {
        writeDriverLiveState(drvId, payload)
      }

      clearHotspotMoveTask(order?._hotspotTaskId, drvId)

      try {
        if (orderKey) {
          clearOrderRuntimeStorage(orderKey)
        }
      } catch {}

      return
    }

    // 該訂單完成後，只清掉該訂單/該司機的模擬儀表板與路線快取，不影響其他訂單或其他司機。
    if (orderKey) {
      clearOrderRuntimeStorage(orderKey)
      dashboardByOrderRef.current.delete(orderKey)
      updateDashboardInfo(orderKey, emptyDashboardInfo(), { force: true })
    }

    const trackKey = order ? getRuntimeTrackKey(order) : null
    if (trackKey) {
      latestCarStateRef.current.delete(trackKey)
      lastCarPosRef.current.delete(trackKey)
      cumRef.current.delete(trackKey)
      lastExternalCarPosEmitRef.current.delete(oid)
      lastExternalCarPosEmitRef.current.delete(trackKey)
    }
    latestCarStateRef.current.delete(oid)

    onOrderCompleted?.(oid, payload)
    }, [orders, onDriverLocationChange, apiFetch, onOrderCompleted, updateDashboardInfo])

   useEffect(() => {
    let cancelled = false

    async function load() {
      const newRoutes = {}

      const visibleOrders = orders.filter(o =>
        o?.id &&
        !completedOrderIds?.has?.(o.id) &&
        !locallyCompletedOrderIds.has(Number(o.id))
      )

      const targetOrders =
        mode === 'passenger'
          ? (visibleOrders.length > 0 ? [visibleOrders[0]] : [])
          : (visibleOrders.length > 0 ? [visibleOrders[0]] : [])

      for (const o of targetOrders) {
        const orderKey = getOrderKey(o)
        const trackKey = getRuntimeTrackKey(o)
        const driverId = getOrderDriverId(o)
        const frozenStart = frozenStartPosByOrderId.get(o.id) || null
        const hasAssignedDriver = driverId != null && isActiveStatus(o?.status)

        if (hasAssignedDriver) {
          const sharedRoute = readOrderRoute(orderKey)
          if (sharedRoute && sharedRoute.length >= 2) {
            newRoutes[trackKey] = sharedRoute
            cumRef.current.set(trackKey, buildCumDist(sharedRoute))
            const routeLen = cumRef.current.get(trackKey)
            routeMetaRef.current.set(trackKey, {
              durationSec: resolveRouteDurationSec(
                routeLen ? routeLen[routeLen.length - 1] : 0,
                routeMetaRef.current.get(trackKey)?.durationSec,
                o
              ),
            })
            continue
          }
        }

        if (Array.isArray(o?._prebuiltRoute) && o._prebuiltRoute.length >= 2) {
          const cs = o._prebuiltRoute.map(p => [Number(p[0]), Number(p[1])])
          newRoutes[trackKey] = cs
          cumRef.current.set(trackKey, buildCumDist(cs))
          const routeLen = cumRef.current.get(trackKey)
          routeMetaRef.current.set(trackKey, {
            durationSec: resolveRouteDurationSec(routeLen ? routeLen[routeLen.length - 1] : 0, null, o),
          })
          continue
        }

        let wps = null
        if (mode === 'passenger') {
          if (hasAssignedDriver) {
            wps = buildCarWaypoints(o, mode, drivers, currentDriverId, frozenStart || null)
          } else {
            wps = buildPlannedWaypoints(o)
          }
        } else {
          wps = buildCarWaypoints(o, mode, drivers, currentDriverId, frozenStart || null)
        }

        if (!wps || wps.length < 2) continue

        try {
          const routeResult = await fetchOsrmRoute(wps)
          let cs = Array.isArray(routeResult) ? routeResult : routeResult?.coords
          let durationSec = Array.isArray(routeResult) ? null : routeResult?.durationSec
          if (cs && cs.length > 0 && o.dropoffLocation) {
            const lastPt = cs[cs.length - 1]
            const dropoff = [o.dropoffLocation.lat, o.dropoffLocation.lng]
            const dist = Math.sqrt(
              Math.pow(lastPt[0] - dropoff[0], 2) +
              Math.pow(lastPt[1] - dropoff[1], 2)
            )
            if (dist > 0.0001) cs.push(dropoff)
          }

          newRoutes[trackKey] = cs
          cumRef.current.set(trackKey, buildCumDist(cs))
          const routeLen = cumRef.current.get(trackKey)
          routeMetaRef.current.set(trackKey, {
            durationSec: resolveRouteDurationSec(routeLen ? routeLen[routeLen.length - 1] : 0, durationSec, o),
          })

          if (hasAssignedDriver) {
            writeOrderRoute(orderKey, cs)
          }
        } catch (err) {
  const msg = String(err?.message || err || '')
  if (!msg.includes('replaced by newer request')) {
    console.warn('route build failed', o?.id, err)
  }
}
      }

if (!cancelled) {
  setVisualRoutes(prev => mergeStableRoutes(prev, newRoutes))
}  }

    load()
    return () => {
      cancelled = true
    }
  }, [orders, completedOrderIds, locallyCompletedOrderIds, mode, currentDriverId, drivers, frozenStartPosByOrderId])
  
  
  useEffect(() => {
    orders.forEach(o => {
      const k = getOrderKey(o)
      if (k) simulateVehicles ? resumeSim(k) : pauseSim(k)
    })
  }, [simulateVehicles, orders])

  const getHotspotColor = (val) => {
    if (val > 50) return '#ff0000'
    if (val > 20) return '#ff8800'
    if (val > 5) return '#ffff00'
    return '#00c853'
  }

  const stopPinsByOrderId = useMemo(() => {
    const out = new Map()
    for (const o of orders) {
      const list = Array.isArray(o?.stops) ? o.stops : []
      const pins = []
      let n = 0
      for (const s of list) {
        const lat = Number(s?.lat)
        const lng = Number(s?.lng ?? s?.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

        const type = String(s?.type || '').toLowerCase()
        if (type === 'driver' || type === 'pickup') continue

        n += 1
        pins.push({
          n,
          lat,
          lng,
          label: s?.label || s?.name || `Stop ${n}`,
        })
      }
      out.set(o.id, pins)
    }
    return out
  }, [orders])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={shouldFollow ? 18 : DEFAULT_ZOOM}
        style={{ width: '100%', height: '100%' }}
        zoomControl={!shouldFollow}
        maxZoom={18}
      >
        <MapSizeFixer />
        <MapViewInitializer
          storageKey={storageKey}
          streetViewMode={shouldFollow}
          getInitialTarget={getActiveCarState}
        />
        <MapStateTracker
          storageKey={storageKey}
          disabled={shouldFollow}
        />

        <VisibilitySimSync orders={orders} simulateVehicles={simulateVehicles} />

        <TileLayer
          url={tileUrl}
          attribution="&copy; OpenStreetMap &copy; CARTO"
          maxZoom={18}
          maxNativeZoom={17}
        />

        {!previewEnabled && (
          <>
            {MAP_ROAD_SIGNS.map(sign => (
              <Marker
                key={`road-sign-${sign.label}`}
                position={[sign.lat, sign.lng]}
                icon={makeRoadShieldIcon(sign.label)}
                interactive={false}
                keyboard={false}
                zIndexOffset={-500}
              />
            ))}

            {MAP_LANDMARKS.map(place => (
              <Marker
                key={`landmark-${place.label}`}
                position={[place.lat, place.lng]}
                icon={makeMapLabelIcon(place.label, place.sub)}
                interactive={false}
                keyboard={false}
                zIndexOffset={-450}
              />
            ))}
          </>
        )}

        <CarFollowController
          enabled={shouldFollow}
          getActiveCarState={getActiveCarState}
          onUserInteraction={() => setIsFollowing(false)}
        />

        <RecenterControl
          onClick={handleRecenter}
          t={t}
          lang={lang}
        />

        <ReplaySpeedControl
          factor={playbackFactor}
          onChange={setPlaybackFactor}
          debugInfo={debugInfo}
          autoOpen={shouldAutoOpenReplayCard}
          autoOpenKey={replayCardAutoOpenKey}
          lang={lang}
        />

        {isDriverMode && currentDriverId && (
          <DriverClickHandler
            enabled={Boolean(driverClickEnabled)}
            driverId={currentDriverId}
            onLocationChange={onDriverLocationChange}
            apiFetch={useApiFetch}
            onReject={setDriverPickWarning}
          />
        )}

        {drivers.map(d => {
          const currentOrder = orders.find(o => sameId(getOrderDriverId(o), d.id))
          if (currentOrder) {
            const isOrderActive = isActiveStatus(currentOrder.status)
            if (isOrderActive) return null
          }

          const displayState = readDisplayDriverState(d, usePersistedDriverLoc)
          if (displayState) {
            return (
              <RotatedTaxiMarker
                key={`driver-${d.id}`}
                position={[Number(displayState.lat), Number(displayState.lng)]}
                heading={Number(displayState.heading ?? 0)}
                opacity={isDriverMode && sameId(d.id, currentDriverId) ? 1 : 0.7}
              />
            )
          }
          return null
        })}

        {isDriverMode && hotspots.length > 0 && hotspots.map((h, i) => {
          const isSel =
            selectedHotspot &&
            Math.abs(Number(selectedHotspot.lat) - Number(h.lat)) < 1e-9 &&
            Math.abs(Number(selectedHotspot.lon ?? selectedHotspot.lng) - Number(h.lon ?? h.lng)) < 1e-9

          return (
            <CircleMarker
              key={`hotspot-${i}`}
              center={[h.lat, h.lon]}
              radius={Math.min(50, (Number(h.pred_rides) || 0) * 1.5 + 5)}
              pathOptions={{
                color: getHotspotColor(Number(h.pred_rides) || 0),
                fillColor: getHotspotColor(Number(h.pred_rides) || 0),
                fillOpacity: isSel ? 0.75 : 0.4,
                weight: isSel ? 3 : 1,
              }}
              eventHandlers={{ click: () => onHotspotSelect?.(h) }}
            >
              <Popup>
                <div style={{ fontSize: '14px' }}>
                  <strong>{h.Zone}</strong> ({h.Borough})<br />
                  預測需求: <b>{Number(h.pred_rides ?? 0).toFixed(2)}</b> 單/時<br />
                  區域權重: <b>{Number(h.priority ?? 0).toFixed(3)}</b><br />
                  區域供給: <b>{Number(h.zone_supply ?? 0)}</b><br />
                  局部供給: <b>{Number(h.local_supply ?? 0)}</b><br />
                  熱點分數: <b>{Number(h.hotspot_score ?? 0).toFixed(3)}</b>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        {previewEnabled ? (
          <>
            {previewWaypoints && (
              <Polyline
                positions={previewWaypoints}
                pathOptions={{ color: 'blue', weight: 4, opacity: 0.6, dashArray: '10, 10' }}
              />
            )}
            {previewMarkers?.pickup && <Marker position={previewMarkers.pickup} icon={passengerIcon} />}
            {previewMarkers?.dropoff && <Marker position={previewMarkers.dropoff} icon={dropoffIcon} />}

            {previewMarkers?.stops?.map((s, idx) => (
              <Marker
                key={`pstop-${idx}`}
                position={[s.lat, s.lng]}
                icon={makeStopNumberIcon(idx + 1)}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95} permanent>
                  {idx + 1}
                </Tooltip>
              </Marker>
            ))}
          </>
        ) : (
          <>
            {orders.map(o => {
              const trackKey = getRuntimeTrackKey(o)
              return (
              <div key={trackKey}>
                {(
                  mode !== 'passenger'
                    ? Boolean(visualRoutes[trackKey])
                    : canShowPassengerPlannedRoute(o) && Boolean(visualRoutes[trackKey])
                ) && (
                  <Polyline positions={visualRoutes[trackKey]} pathOptions={{ color: '#999', weight: 5 }} />
                )}

                {!o._hidePickupMarker && o.pickupLocation && (
                  <Marker position={[o.pickupLocation.lat, o.pickupLocation.lng]} icon={passengerIcon} />
                )}
                {!o._hideDropoffMarker && o.dropoffLocation && (
                  <Marker position={[o.dropoffLocation.lat, o.dropoffLocation.lng]} icon={dropoffIcon} />
                )}

                {(stopPinsByOrderId.get(o.id) || []).map(p => (
                  <Marker
                    key={`stop-${o.id}-${p.n}`}
                    position={[p.lat, p.lng]}
                    icon={makeStopNumberIcon(p.n)}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={0.95} permanent>
                      {p.n}
                    </Tooltip>
                    <Popup>
                      <div style={{ fontSize: 14 }}>
                        <b>Stop {p.n}</b><br />
                        {p.label}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </div>
              )
            })}

            {runtimeOrders
              .filter(o => {
                const trackKey = getRuntimeTrackKey(o)
                return Array.isArray(visualRoutes[trackKey]) && visualRoutes[trackKey].length >= 2
              })
              .map(o => {
              const trackKey = getRuntimeTrackKey(o)
              const frozenStart = frozenStartPosByOrderId.get(o.id)
              const startPos =
                frozenStart &&
                Number.isFinite(Number(frozenStart.lat)) &&
                Number.isFinite(Number(frozenStart.lng))
                  ? [Number(frozenStart.lat), Number(frozenStart.lng)]
                  : null

              return (
                <CarRuntimeLayer
                  key={`run-${trackKey}-${currentDriverId ?? 'na'}-${o?._forceUpdate || ''}`}
                  order={o}
                  routeCoords={visualRoutes[trackKey]}
                  cumDist={cumRef.current.get(trackKey)}
                  sumoJson={sumoJson}
                  simulateVehicles={simulateVehicles}
                  completedOrderIds={completedOrderIds}
                  completedOnceRef={completedOnceRef}
                  lastCarPosRef={lastCarPosRef}
                  stashCarPos={stashCarPos}
                  onOrderArrived={onOrderArrived}
                  onOrderCompleted={handleLocalOrderCompleted}
                  setDebugInfo={setDebugInfo}
                  onDashboardUpdate={updateDashboardInfo}
                  mode={mode}
                  driverStartPos={startPos}
                  playbackFactor={playbackFactor}
                  routeDurationSec={routeMetaRef.current.get(trackKey)?.durationSec ?? null}
                />
              )
            })}
          </>
        )}
      </MapContainer>
      {driverPickWarning && (
        <div className="driver-pick-warning">
          {driverPickWarning}
        </div>
      )}
    </div>
  )
}

export { usePlaybackFactorSync, readPlaybackFactor, writePlaybackFactor, PLAYBACK_LS_KEY }
