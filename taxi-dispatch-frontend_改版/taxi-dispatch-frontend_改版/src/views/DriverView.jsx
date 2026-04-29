//driver
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import MapView from '../components/MapView.jsx'
import OrderList from '../components/OrderList.jsx'
import { t } from '../i18n'
import { apiFetch } from '../apiBase.js'
const HOTSPOT_MOVE_TASK_KEY = 'hotspotMoveTaskV1'
const HOTSPOT_MOVE_EVT = 'hotspotMoveTaskChanged'
const DRIVER_LIVE_STATE_PREFIX = 'driverLiveState:'
const ORDER_SYNC_KEY = 'orderSyncEventV1'
const ORDER_SYNC_EVT = 'orderSyncEventChanged'

function emitInstantOrderAccepted(order, driverId) {
  if (!order?.id) return

  const payload = {
    reason: 'order-accepted-confirm',
    ts: Date.now(),
    orderId: order.id,
    driverId,
    order: {
      ...order,
      status: 'assigned',
      driverId,
      assignedDriverId: driverId,
      driver_id: driverId,
    },
  }

  try {
    localStorage.setItem(ORDER_SYNC_KEY, JSON.stringify(payload))
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent(ORDER_SYNC_EVT, { detail: payload }))
  } catch {}
}

function hotspotMoveTaskKey(driverId) {
  return `${HOTSPOT_MOVE_TASK_KEY}:${driverId ?? 'na'}`
}
const ORDER_RECOMMEND_MIN_GAIN = 0.2
const ORDER_W_EARNING = 1.2
const ORDER_W_DEMAND = 2.0
const ORDER_W_PRIORITY = 0.9
const ORDER_W_DISTANCE = 0.9
const ORDER_W_ZONE_SUPPLY = 0.45
const ORDER_W_LOCAL_SUPPLY = 0.20
const ORDER_LOCAL_RADIUS_KM = 2.0
const ORDER_DISTANCE_CIRCUITY_FACTOR = 1.3
const ORDER_ROUTE_PREFETCH_TOP_N = 5

function readHotspotMoveTask(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(hotspotMoveTaskKey(driverId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readDriverLiveState(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(`${DRIVER_LIVE_STATE_PREFIX}${driverId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const lat = Number(parsed?.lat)
    const lng = Number(parsed?.lng)
    const heading = Number(parsed?.heading ?? 0)
    const speedKph = Number(parsed?.speedKph ?? 0)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng, heading, speedKph }
  } catch {
    return null
  }
}

const ORDER_START_PREFIX = 'orderStart:'
const ORDER_ROUTE_PREFIX = 'orderRoute:'

function getDriverOrderKey(order, driverId) {
  const id = Number(order?.id)
  if (!Number.isFinite(id)) return null
  const createdAt = order?.createdAt || order?.created_at || ''
  return `sim_order_${id}_driver_${driverId ?? 'na'}_${createdAt}`
}

function getDriverOrderRouteKey(order, driverId, driverLoc) {
  const baseKey = getDriverOrderKey(order, driverId)
  if (!baseKey || !driverLoc) return baseKey

  const lat = round6(driverLoc.lat)
  const lng = round6(driverLoc.lng)

  if (lat == null || lng == null) return baseKey

  return `${baseKey}_from_${lat}_${lng}`
}

function writeOrderStartOnce(orderKey, latlng) {
  if (!orderKey || !latlng) return
  try {
    const k = `${ORDER_START_PREFIX}${orderKey}`
    if (localStorage.getItem(k)) return
    localStorage.setItem(k, JSON.stringify(latlng))
  } catch {}
}

function writeOrderRoute(orderKey, coords) {
  try {
    if (!orderKey || !Array.isArray(coords) || coords.length < 2) return
    localStorage.setItem(`${ORDER_ROUTE_PREFIX}${orderKey}`, JSON.stringify(coords))
  } catch {}
}

async function fetchRouteSegment(from, to) {
const res = await apiFetch('/api/route', {
  query: {
    fromLat: from.lat,
    fromLng: from.lng,
    toLat: to.lat,
    toLng: to.lng,
  },
  timeoutMs: 30000,
  dedupe: false,
})

  if (!res.ok) throw new Error(`route api ${res.status}`)
  const data = await res.json()
  const coords = Array.isArray(data?.coords) ? data.coords : []
  if (coords.length < 2) throw new Error('route no coords')
  return coords.map(p => [Number(p[0]), Number(p[1])])
}

async function buildAndCacheOrderRoute(order, driverId, driverLoc) {
  const orderKey =
    order?._routeCacheKey ||
    getDriverOrderRouteKey(order, driverId, driverLoc) ||
    getDriverOrderKey(order, driverId)
  if (!orderKey || !driverLoc) return

  const pickup = getPickupLoc(order)
  const dropoff = getDropoffLoc(order)
  if (!pickup || !dropoff) return

  writeOrderStartOnce(orderKey, {
    lat: Number(driverLoc.lat),
    lng: Number(driverLoc.lng),
  })

  const points = [
    { lat: Number(driverLoc.lat), lng: Number(driverLoc.lng) },
    { lat: Number(pickup.lat), lng: Number(pickup.lng) },
    ...getOrderIntermediateStops(order).map(s => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    { lat: Number(dropoff.lat), lng: Number(dropoff.lng) },
  ]
    // 先立刻寫入粗略路線，讓司機端/乘客端馬上有 shared route 可畫
  writeOrderRoute(
    orderKey,
    points.map(p => [Number(p.lat), Number(p.lng)])
  )

  const merged = []
  for (let i = 0; i < points.length - 1; i++) {
    const seg = await fetchRouteSegment(points[i], points[i + 1])
    if (i === 0) merged.push(...seg)
    else merged.push(...seg.slice(1))
  }

  const last = merged[merged.length - 1]
  if (last && dropoff) {
    const d = Math.sqrt(
      Math.pow(Number(last[0]) - Number(dropoff.lat), 2) +
      Math.pow(Number(last[1]) - Number(dropoff.lng), 2)
    )
    if (d > 0.0001) merged.push([Number(dropoff.lat), Number(dropoff.lng)])
  }

  writeOrderRoute(orderKey, merged)
}

// --- 工具函數 ---
function normalizeVehicleType(value) {
  if (value == null) return null
  const s = String(value).trim().toUpperCase()
  if (!s) return null
  if (s === 'YELLOW' || s.includes('YELLOW')) return 'YELLOW'
  if (s === 'GREEN' || s.includes('GREEN')) return 'GREEN'
  if (s === 'FHV' || s.includes('FHV')) return 'FHV'
  if (s.includes('黃')) return 'YELLOW'
  if (s.includes('綠')) return 'GREEN'
  if (s.includes('多元')) return 'FHV'
  return null
}

function sameId(a, b) {
  const A = Number(a)
  const B = Number(b)
  return Number.isFinite(A) && Number.isFinite(B) && A === B
}

function isPendingStatus(status) {
  return String(status || '').trim().toLowerCase() === 'pending'
}

function normStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function getAnyDriverId(o) {
  return o?.driverId ?? o?.assignedDriverId ?? o?.driver_id ?? null
}

function getPickupLoc(o) {
  const p = o?.pickupLocation
  if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
    return { lat: Number(p.lat), lng: Number(p.lng) }
  }
  const lat = Number(o?.pickupLat)
  const lng = Number(o?.pickupLng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  return null
}

function getDropoffLoc(o) {
  const p = o?.dropoffLocation
  if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
    return { lat: Number(p.lat), lng: Number(p.lng) }
  }
  const lat = Number(o?.dropoffLat)
  const lng = Number(o?.dropoffLng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  return null
}

function getOrderPrice(o) {
  const candidates = [
    o?.price,
    o?.estimatedFare,
    o?.estimated_fare,
    o?.fare,
    o?.estimatedPrice,
    o?.estimated_price,
    o?.amount,
    o?.totalFare,
    o?.total_fare,
  ]

  for (const v of candidates) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function makeOrderKey(o) {
  const id = Number(o?.id)
  if (!Number.isFinite(id)) return null
  const createdAt = o?.createdAt || o?.created_at || o?.updatedAt || o?.updated_at || ''
  return `${id}::${String(createdAt)}`
}

async function osrmDistanceKm(from, to) {
  const res = await apiFetch('/api/route', {
    query: {
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
    },
    timeoutMs: 15000,
  })

  if (!res.ok) throw new Error(`route api ${res.status}`)

  const data = await res.json()
  const dist = Number(data?.dist)

  if (!Number.isFinite(dist)) throw new Error('route no distance')
  return dist
}

function round6(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1e6) / 1e6
}

function haversineKm(a, b) {
  if (!a || !b) return Infinity
  const lat1 = Number(a.lat)
  const lng1 = Number(a.lng)
  const lat2 = Number(b.lat)
  const lng2 = Number(b.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity

  const R = 6371
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

function getOrderIntermediateStops(o) {
  const stops = Array.isArray(o?.stops) ? o.stops : []
  return stops
    .map(s => ({
      lat: Number(s?.lat),
      lng: Number(s?.lng ?? s?.lon),
      type: String(s?.type || '').toLowerCase(),
    }))
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .filter(s => s.type !== 'driver' && s.type !== 'pickup')
}

function buildOrderRoutePoints(driverLoc, o) {
  const pickup = getPickupLoc(o)
  const dropoff = getDropoffLoc(o)
  if (!driverLoc || !pickup || !dropoff) return []

  const stops = getOrderIntermediateStops(o)
  return [
    { lat: Number(driverLoc.lat), lng: Number(driverLoc.lng) },
    { lat: Number(pickup.lat), lng: Number(pickup.lng) },
    ...stops.map(s => ({ lat: s.lat, lng: s.lng })),
    { lat: Number(dropoff.lat), lng: Number(dropoff.lng) },
  ]
}

function routeDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return null

  let total = 0
  for (let i = 1; i < points.length; i++) {
    const seg = haversineKm(points[i - 1], points[i])
    if (!Number.isFinite(seg)) return null
    total += seg
  }

  return total * ORDER_DISTANCE_CIRCUITY_FACTOR
}


function minmax01FromValues(value, values) {
  const nums = (values || []).map(Number).filter(Number.isFinite)
  const v = Number(value)
  if (!Number.isFinite(v) || !nums.length) return 0
  const mn = Math.min(...nums)
  const mx = Math.max(...nums)
  if (mx - mn < 1e-12) return 0
  return (v - mn) / (mx - mn)
}

function findNearestHotspotForPoint(point, hotspots) {
  if (!point || !Array.isArray(hotspots) || !hotspots.length) return null

  let best = null
  let bestD = Infinity

  for (const h of hotspots) {
    const hp = {
      lat: Number(h?.lat),
      lng: Number(h?.lon ?? h?.lng),
    }
    const d = haversineKm(point, hp)
    if (d < bestD) {
      bestD = d
      best = h
    }
  }

  return best
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let idx = 0

  async function worker() {
    while (idx < items.length) {
      const cur = idx++
      results[cur] = await fn(items[cur], cur)
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker())
  await Promise.all(workers)
  return results
}

// ✅ 每位司機獨立的定位鎖
function driverLocLockKey(driverId) {
  return `driverLocConfirmed:${driverId ?? 'na'}`
}
function readLocConfirmed(driverId) {
  try {
    if (driverId == null) return false
    return localStorage.getItem(driverLocLockKey(driverId)) === '1'
  } catch {
    return false
  }
}
function writeLocConfirmed(driverId, val) {
  try {
    if (driverId == null) return
    localStorage.setItem(driverLocLockKey(driverId), val ? '1' : '0')
  } catch {}
}

function readPersistedDriverLoc(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(`driverLoc:${driverId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const lat = Number(parsed?.lat)
    const lng = Number(parsed?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    return null
  } catch {
    return null
  }
}

const DRIVER_LOC_TS_PREFIX = 'driverLocTs:'
const DRIVER_LAST_LOGIN_DRIVER_KEY = 'driverLastLoginDriverId'
const DRIVER_LOC_TTL_MS = 24 * 60 * 60 * 1000 // 完成訂單後保留上一單終點，避免短時間內回初始位置

function driverLocTsKey(driverId) {
  return `${DRIVER_LOC_TS_PREFIX}${driverId ?? 'na'}`
}

function readLocTimestamp(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(driverLocTsKey(driverId))
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeLocTimestamp(driverId, ts = Date.now()) {
  try {
    if (driverId == null) return
    localStorage.setItem(driverLocTsKey(driverId), String(ts))
  } catch {}
}

function clearDriverLocationState(driverId) {
  try {
    if (driverId == null) return
    localStorage.removeItem(driverLocLockKey(driverId))
    localStorage.removeItem(driverLocTsKey(driverId))
  } catch {}
}


export default function DriverView({
  lang,
  drivers = [],
  orders,
  ordersWithLocations,
  loading,
  error,
  currentDriverId,
  setCurrentDriverId,
  acceptOrder,
  refresh,
  currentUser,
  onDriverLocationChange,
  simulateVehicles,
  onOpenAuth,
  onOrderCompleted,
  onCarPosChange,
  hotspots = [],
  showHotspots = true,
  presetDriverGroups = {},
  onSelectPresetDriver,
}) {
  const goAuth = () => {
    if (onOpenAuth) {
      onOpenAuth('driver', 'driver')
      return
    }
    window.location.href = `${window.location.pathname}?auth=1&role=driver`
  }

  const isLoggedIn = true
  const allOrdersFromProps = useMemo(() => {
    return Array.isArray(ordersWithLocations) && ordersWithLocations.length
      ? ordersWithLocations
      : orders || []
  }, [ordersWithLocations, orders])

  const myDriver = useMemo(() => {
    if (currentDriverId != null) {
      const byId = drivers.find(d => sameId(d?.id, currentDriverId))
      if (byId) return byId
    }
    const u = currentUser?.username
    if (u) {
      const byName = drivers.find(
        d => String(d?.name || d?.username || '').trim() === String(u).trim()
      )
      if (byName) return byName
    }
    return null
  }, [drivers, currentDriverId, currentUser])

  const effectiveDriverId = isLoggedIn
    ? (myDriver?.id ?? null)
    : (currentDriverId ?? null)

  const driverReady = !isLoggedIn || (myDriver && effectiveDriverId != null)

  useEffect(() => {
    if (!setCurrentDriverId || myDriver?.id == null) return
    if (currentDriverId == null || !sameId(currentDriverId, myDriver.id)) {
      setCurrentDriverId(myDriver.id)
    }
  }, [myDriver, currentDriverId, setCurrentDriverId])

  const myCarType = normalizeVehicleType(myDriver?.carType ?? currentUser?.carType ?? 'GREEN')
  const [selectedCarType, setSelectedCarType] = useState(myCarType || 'GREEN')

  useEffect(() => {
    if (myCarType) setSelectedCarType(myCarType)
  }, [myCarType])

  const selectableDrivers = presetDriverGroups?.[selectedCarType] || []

  const [locConfirmed, setLocConfirmed] = useState(false)

useEffect(() => {
  if (!isLoggedIn || effectiveDriverId == null) {
    setLocConfirmed(false)
    return
  }

  const now = Date.now()

  const ts = readLocTimestamp(effectiveDriverId)
  const isExpired = !ts || (now - ts > DRIVER_LOC_TTL_MS)

  if (isExpired) {
    clearDriverLocationState(effectiveDriverId)
    setLocConfirmed(false)
  } else {
    setLocConfirmed(readLocConfirmed(effectiveDriverId))
  }

}, [effectiveDriverId, isLoggedIn])
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [orderDistances, setOrderDistances] = useState({})
  const [completedNotice, setCompletedNotice] = useState('')
  const [acceptConfirmOrder, setAcceptConfirmOrder] = useState(null)
  const [routeConfirmingOrder, setRouteConfirmingOrder] = useState(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [hotspotMoveTask, setHotspotMoveTask] = useState(null)
  const [liveDriverLoc, setLiveDriverLoc] = useState(null)
  const [modelData, setModelData] = useState(null)
  const completedSeenRef = useRef(new Set())
  const prefetchingRouteKeysRef = useRef(new Set())

  useEffect(() => {
    let cancelled = false

    apiFetch('/api/health', { timeoutMs: 15000, dedupe: false })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        setModelData(data?.model_data || null)
      })
      .catch(() => {
        if (!cancelled) setModelData(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (effectiveDriverId == null) {
      setHotspotMoveTask(null)
      return
    }

    const syncTask = (e) => {
      const eventDriverId = e?.detail?.driverId
      if (eventDriverId != null && !sameId(eventDriverId, effectiveDriverId)) return
      setHotspotMoveTask(readHotspotMoveTask(effectiveDriverId))
    }

    setHotspotMoveTask(readHotspotMoveTask(effectiveDriverId))

    window.addEventListener(HOTSPOT_MOVE_EVT, syncTask)
    return () => window.removeEventListener(HOTSPOT_MOVE_EVT, syncTask)
  }, [effectiveDriverId])
  useEffect(() => {
    if (!isLoggedIn || effectiveDriverId == null) {
      setLiveDriverLoc(null)
      return
    }

    const live = readDriverLiveState(effectiveDriverId)
    const persisted = readPersistedDriverLoc(effectiveDriverId)

    if (live) {
      setLiveDriverLoc({ lat: live.lat, lng: live.lng })
    } else if (persisted) {
      setLiveDriverLoc({ lat: persisted.lat, lng: persisted.lng })
    } else {
      setLiveDriverLoc(null)
    }
  }, [effectiveDriverId, isLoggedIn])


  // ✅ 修正：
  // 第一次點地圖定位才需要上鎖
  // 之後完成訂單 / 行程同步更新位置，不能被 locConfirmed 擋掉
    const handleDriverLocationChange = useCallback(
    p => {
      if (!driverReady) return
      if (!p || effectiveDriverId == null) return
      if (!sameId(p.id, effectiveDriverId)) return

      const lat = Number(p.lat)
      const lng = Number(p.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setLiveDriverLoc({ lat, lng })
      }

      if (!locConfirmed) {
        setLocConfirmed(true)
        writeLocConfirmed(effectiveDriverId, true)
      }

      writeLocTimestamp(effectiveDriverId, Date.now())
      onDriverLocationChange?.(p)
    },
    [onDriverLocationChange, effectiveDriverId, locConfirmed, driverReady]
  )


  // ✅ 修正：
  // 每次顯示司機位置優先吃 localStorage 的最新 driverLoc
  // 這樣完成訂單後的新終點就會直接成為下一次起點
  const myDriverLoc = useMemo(() => {
    if (effectiveDriverId == null) return null
    if (!locConfirmed) return null
    if (
      liveDriverLoc &&
      Number.isFinite(Number(liveDriverLoc.lat)) &&
      Number.isFinite(Number(liveDriverLoc.lng))
    ) {
      return {
        lat: Number(liveDriverLoc.lat),
        lng: Number(liveDriverLoc.lng),
      }
    }

    const live = readDriverLiveState(effectiveDriverId)
    if (live) return { lat: live.lat, lng: live.lng }

    const persisted = readPersistedDriverLoc(effectiveDriverId)
    if (persisted) return persisted

    if (!myDriver) return null

    const lat = Number(myDriver.lat)
    const lng = Number(myDriver.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng }
    }

    return null
  }, [myDriver, effectiveDriverId, liveDriverLoc])

  const visibleDrivers = useMemo(() => {
    if (!driverReady || !myDriverLoc) return []
    return [{
      ...myDriver,
      id: effectiveDriverId,
      lat: myDriverLoc.lat,
      lng: myDriverLoc.lng,
    }]
  }, [driverReady, myDriver, myDriverLoc, effectiveDriverId])

  const myActiveOrder = useMemo(() => {
    if (!driverReady || effectiveDriverId == null) return null

    const ACTIVE = new Set([
      'assigned',
      'accepted',
      'en_route',
      'enroute',
      'picked_up',
      'in_progress',
      'on_trip',
      'ongoing',
    ])

    const candidates = allOrdersFromProps
      .filter(o => o && sameId(getAnyDriverId(o), effectiveDriverId))
      .filter(o => ACTIVE.has(normStatus(o.status)))

    if (!candidates.length) return null

    candidates.sort(
      (a, b) =>
        (b.updatedAt ? Date.parse(b.updatedAt) : 0) -
        (a.updatedAt ? Date.parse(a.updatedAt) : 0)
    )
    return candidates[0]
  }, [allOrdersFromProps, effectiveDriverId, driverReady])

    const myHotspotMove = useMemo(() => {
    if (!driverReady || effectiveDriverId == null) return null
    if (!hotspotMoveTask) return null
    if (!sameId(hotspotMoveTask.driverId, effectiveDriverId)) return null
    if (hotspotMoveTask.status !== 'moving') return null
    if (!Array.isArray(hotspotMoveTask.coords) || hotspotMoveTask.coords.length < 2) return null
    if (!hotspotMoveTask.start || !hotspotMoveTask.end) return null

    return {
      id: Number(hotspotMoveTask.taskId),
      createdAt: hotspotMoveTask.createdAt || new Date().toISOString(),
      updatedAt: hotspotMoveTask.createdAt || new Date().toISOString(),
      status: 'en_route',
      driverId: effectiveDriverId,
      pickupLocation: {
        lat: Number(hotspotMoveTask.start.lat),
        lng: Number(hotspotMoveTask.start.lng),
      },
      dropoffLocation: {
        lat: Number(hotspotMoveTask.end.lat),
        lng: Number(hotspotMoveTask.end.lng),
      },
      stops: [],
      _isHotspotMove: true,
      _hotspotTaskId: Number(hotspotMoveTask.taskId),
      _prebuiltRoute: hotspotMoveTask.coords.map(p => [Number(p[0]), Number(p[1])]),
      _hidePickupMarker: true,
      _hideDropoffMarker: true,
      _forceUpdate: `hotspot:${hotspotMoveTask.taskId}`,
    }
  }, [hotspotMoveTask, driverReady, effectiveDriverId])

      const isDriverMoving = useMemo(() => {
    return Boolean(myActiveOrder || myHotspotMove)
  }, [myActiveOrder, myHotspotMove])

    const resetMyLocation = useCallback(() => {
    if (effectiveDriverId == null) return
    if (isDriverMoving) return

    clearDriverLocationState(effectiveDriverId)

    try {
      localStorage.removeItem(`driverLoc:${effectiveDriverId}`)
      localStorage.removeItem(`driverLiveState:${effectiveDriverId}`)
    } catch {}

    setLiveDriverLoc(null)
    setLocConfirmed(false)
  }, [effectiveDriverId, isDriverMoving])

  // ✅ 推薦分數計算用的位置：
  // 平常用目前司機位置；若已知下一個終點，直接用終點提前計算
  const scoreAnchorLoc = useMemo(() => {
    if (effectiveDriverId == null) return null

    if (myHotspotMove?.dropoffLocation) {
      const lat = Number(myHotspotMove.dropoffLocation.lat)
      const lng = Number(myHotspotMove.dropoffLocation.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }

    if (myActiveOrder?.dropoffLocation) {
      const lat = Number(myActiveOrder.dropoffLocation.lat)
      const lng = Number(myActiveOrder.dropoffLocation.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    }

    return myDriverLoc
  }, [effectiveDriverId, myHotspotMove, myActiveOrder, myDriverLoc])

  const handleCarPosChange = useCallback(
    (orderIdOrPayload, maybePayload = null) => {
      const p = maybePayload || orderIdOrPayload

      if (
        isDriverMoving &&
        p &&
        effectiveDriverId != null
      ) {
        const lat = Number(p.lat)
        const lng = Number(p.lng)

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setLiveDriverLoc({ lat, lng })
          writeLocTimestamp(effectiveDriverId, Date.now())

          try {
            localStorage.setItem(`driverLoc:${effectiveDriverId}`, JSON.stringify({ lat, lng }))
            localStorage.setItem(`driverLiveState:${effectiveDriverId}`, JSON.stringify({
              lat,
              lng,
              heading: Number(p.heading ?? 0),
              speedKph: Number(p.speedKph ?? 0),
              ts: Date.now(),
            }))
            localStorage.setItem(`driverLocConfirmed:${effectiveDriverId}`, '1')
          } catch {}

          if (routeConfirmingOrder && String(orderIdOrPayload) === String(routeConfirmingOrder?.id)) {
            setRouteConfirmingOrder(null)
          }
        }
      }

      onCarPosChange?.(orderIdOrPayload, maybePayload)
    },
    [effectiveDriverId, onCarPosChange, isDriverMoving, routeConfirmingOrder]
  )


    useEffect(() => {
    if (myActiveOrder?.id != null) {
      setSelectedOrderId(myActiveOrder.id)
    } else {
      setSelectedOrderId(null)
    }
  }, [myActiveOrder])

  const pendingHash = useMemo(() => {
    const pending = allOrdersFromProps
      .filter(o => isPendingStatus(o?.status))
      .filter(o => getAnyDriverId(o) == null)
      .map(o => {
        const pickup = getPickupLoc(o)
        const dropoff = getDropoffLoc(o)
        const stops = getOrderIntermediateStops(o)
          .map(s => `${round6(s.lat)}:${round6(s.lng)}`)
          .join(',')

        return [
          o.id,
          round6(pickup?.lat),
          round6(pickup?.lng),
          round6(dropoff?.lat),
          round6(dropoff?.lng),
          stops,
        ].join(':')
      })
      .join('|')

    return `${round6(scoreAnchorLoc?.lat)}:${round6(scoreAnchorLoc?.lng)}::${pending}`
  }, [allOrdersFromProps, scoreAnchorLoc])

  useEffect(() => {
    if (!scoreAnchorLoc) return

    const pending = allOrdersFromProps.filter(
      o => isPendingStatus(o?.status) && getAnyDriverId(o) == null
    )

    if (!pending.length) {
      setOrderDistances({})
      return
    }

    const distMap = {}

    pending.forEach(o => {
      const points = buildOrderRoutePoints(scoreAnchorLoc, o)
      const totalKm = routeDistanceKm(points)
      if (!Number.isFinite(Number(totalKm))) return
      distMap[o.id] = Number(totalKm)
    })

    setOrderDistances(distMap)
  }, [pendingHash, allOrdersFromProps, scoreAnchorLoc])

  const pendingOrders = useMemo(() => {
    const base = allOrdersFromProps
      .filter(o => isPendingStatus(o?.status) && getAnyDriverId(o) == null)
      .filter(o => !myCarType || normalizeVehicleType(o?.vehicleType) === myCarType)
      .map(o => {
        const pickupLocation = getPickupLoc(o)
        const dropoffLocation = getDropoffLoc(o)

        const totalDistanceKmFromMap = Number(orderDistances[o.id])
        const fallbackPoints =
          scoreAnchorLoc ? buildOrderRoutePoints(scoreAnchorLoc, o) : []
        const fallbackDistanceKm = routeDistanceKm(fallbackPoints)

        const driverDistanceKm =
          Number.isFinite(totalDistanceKmFromMap) && totalDistanceKmFromMap > 0
            ? totalDistanceKmFromMap
            : Number.isFinite(Number(fallbackDistanceKm))
            ? Number(fallbackDistanceKm)
            : null

        const price = getOrderPrice(o)

        const nearestHotspot = dropoffLocation
          ? findNearestHotspotForPoint(dropoffLocation, hotspots)
          : null

        const hotspotDemand = Number(nearestHotspot?.pred_rides ?? nearestHotspot?.pred_next_hour ?? 0)
        const hotspotPriority = Number(nearestHotspot?.priority ?? nearestHotspot?.PriorityN ?? 0)
        const backendZoneSupply = Number(nearestHotspot?.zone_supply ?? nearestHotspot?.ZoneSupply ?? 0)
        const backendLocalSupply = Number(nearestHotspot?.local_supply ?? nearestHotspot?.LocalSupply ?? 0)

const routeCacheKey = getDriverOrderRouteKey(o, effectiveDriverId, scoreAnchorLoc)

return {
  ...o,
  pickupLocation,
  dropoffLocation,
  _routeOwnerDriverId: effectiveDriverId,
  _routeCacheKey: routeCacheKey,
  distanceKm: driverDistanceKm,
          dispatchScore:
            Number.isFinite(driverDistanceKm)
              ? Math.max(1, Math.min(10, Math.round(11 - driverDistanceKm)))
              : null,
          driverDistanceKm,
          price,
          _recommendDemandRaw: hotspotDemand,
          _recommendPriorityRaw: hotspotPriority,
          _recommendZoneSupplyRaw: backendZoneSupply,
          _recommendLocalSupplyRaw: backendLocalSupply,
          _recommendDropoffHotspot: nearestHotspot || null,
        }
      })


    const demandValues = base.map(o => Number(o._recommendDemandRaw ?? 0))
    const priorityValues = base.map(o => Number(o._recommendPriorityRaw ?? 0))
    const distanceValues = base
      .map(o => Number(o.driverDistanceKm ?? Infinity))
      .filter(Number.isFinite)

    const zoneSupplyValues = base.map(o => Number(o._recommendZoneSupplyRaw ?? 0))
    const localSupplyValues = base.map(o => Number(o._recommendLocalSupplyRaw ?? 0))

    const scored = base.map(o => {
      const demandN = minmax01FromValues(o._recommendDemandRaw ?? 0, demandValues)
      const priorityN = minmax01FromValues(o._recommendPriorityRaw ?? 0, priorityValues)
      const distanceN = minmax01FromValues(o.driverDistanceKm ?? 0, distanceValues)

      const zoneSupply = Number(o._recommendZoneSupplyRaw ?? 0)
      const localSupply = Number(o._recommendLocalSupplyRaw ?? 0)
      const zoneSupplyN = minmax01FromValues(zoneSupply, zoneSupplyValues)
      const localSupplyN = minmax01FromValues(localSupply, localSupplyValues)

      // 與後端 score_frame() 保持同一套公式；前端只負責用已快取資料即時計算，不額外打路線 API。
const recommendRawScore =
  ORDER_W_DEMAND * demandN +
  ORDER_W_PRIORITY * priorityN -
  ORDER_W_DISTANCE * distanceN -
  ORDER_W_ZONE_SUPPLY * zoneSupplyN -
  ORDER_W_LOCAL_SUPPLY * localSupplyN
      const recommendScore = Math.max(
        1,
        Math.min(10, 5 + recommendRawScore)
      )

      const recommendGain = recommendRawScore
      const recommendAccept = recommendGain > ORDER_RECOMMEND_MIN_GAIN

      return {
        ...o,
        recommendScore,
        recommendRawScore,
        recommendGain,
        recommendAccept,
        recommendLabel: recommendAccept ? '是' : '否',

        recommendEarningRaw: null,
        recommendEarningN: null,

        recommendDemandRaw: o._recommendDemandRaw ?? 0,
        recommendDemandN: demandN,

        recommendPriorityRaw: o._recommendPriorityRaw ?? 0,
        recommendPriorityN: priorityN,

        recommendDistanceRaw: o.driverDistanceKm ?? null,
        recommendDistanceN: distanceN,

        recommendZoneSupply: zoneSupply,
        recommendZoneSupplyN: zoneSupplyN,

        recommendLocalSupply: localSupply,
        recommendLocalSupplyN: localSupplyN,
      }
    })

    scored.sort((a, b) => {
      const sa = Number(a.recommendScore)
      const sb = Number(b.recommendScore)

      const aOk = Number.isFinite(sa)
      const bOk = Number.isFinite(sb)

      if (aOk && bOk && sb !== sa) return sb - sa
      if (bOk && !aOk) return 1
      if (aOk && !bOk) return -1

      const da = Number(a.driverDistanceKm ?? Infinity)
      const db = Number(b.driverDistanceKm ?? Infinity)
      if (da !== db) return da - db

      return Number(a.id || 0) - Number(b.id || 0)
    })

    return scored
  }, [allOrdersFromProps, myCarType, orderDistances, hotspots, scoreAnchorLoc])

    useEffect(() => {
    if (!driverReady) return
    if (effectiveDriverId == null) return
    if (!scoreAnchorLoc) return
    if (isDriverMoving && !myHotspotMove && !myActiveOrder) return
    if (!Array.isArray(pendingOrders) || !pendingOrders.length) return

    const topOrders = pendingOrders
      .filter(o => o && o.id != null)
      .slice(0, ORDER_ROUTE_PREFETCH_TOP_N)

    topOrders.forEach(order => {
      const orderKey = getDriverOrderKey(order, effectiveDriverId)
      if (!orderKey) return
      if (prefetchingRouteKeysRef.current.has(orderKey)) return

      prefetchingRouteKeysRef.current.add(orderKey)

      buildAndCacheOrderRoute(order, effectiveDriverId, scoreAnchorLoc)
        .catch(() => {})
        .finally(() => {
          prefetchingRouteKeysRef.current.delete(orderKey)
        })
    })
  }, [
    driverReady,
    effectiveDriverId,
    scoreAnchorLoc,
    pendingOrders,
    isDriverMoving,
    myHotspotMove,
    myActiveOrder,
  ])

  const displayOrders = useMemo(() => {
    if (myActiveOrder) {
      return [myActiveOrder, ...pendingOrders.filter(o => o.id !== myActiveOrder.id)]
    }
    return pendingOrders
  }, [myActiveOrder, pendingOrders])

  const mapOrders = useMemo(() => {
    if (!driverReady || !myDriverLoc) return []

    let baseOrder = null
    if (myActiveOrder) {
      baseOrder = myActiveOrder
    } else if (myHotspotMove) {
      baseOrder = myHotspotMove
    } else if (selectedOrderId) {
      baseOrder = pendingOrders.find(o => o.id === selectedOrderId) || null
    } else {
      baseOrder =
        [...pendingOrders].sort(
          (a, b) => (a.driverDistanceKm || Infinity) - (b.driverDistanceKm || Infinity)
        )[0] || null
    }

    if (!baseOrder) return []

    const pickup = getPickupLoc(baseOrder)
    if (!pickup && !baseOrder?._isHotspotMove) return []

    const dropoff = getDropoffLoc(baseOrder)
    const { polyline, route, directions, path, ...cleanOrder } = baseOrder

    if (baseOrder?._isHotspotMove) {
      return [baseOrder]
    }

    if (myActiveOrder && sameId(baseOrder.id, myActiveOrder.id)) {
      return [{
        ...cleanOrder,
        driverId: effectiveDriverId,
        pickupLocation: pickup,
        dropoffLocation: dropoff,
        stops: (cleanOrder.stops || []).filter(s => {
          if (!s) return false
          const type = String(s.type || '').toLowerCase()
          return type !== 'driver' && type !== 'pickup'
        }),
        _forceUpdate: `active:${effectiveDriverId}:${baseOrder.id}:${baseOrder.updatedAt || baseOrder.createdAt || ''}`,
      }]
    }

    const linearStops = [
      {
        lat: round6(myDriverLoc.lat),
        lng: round6(myDriverLoc.lng),
        text: '我的位置',
        type: 'driver',
      },
      {
        lat: round6(pickup.lat),
        lng: round6(pickup.lng),
        text: '乘客上車',
        type: 'pickup',
      },
    ]

    const originalStops = (cleanOrder.stops || []).filter(s => {
      if (!s) return false
      const type = String(s.type || '').toLowerCase()
      if (type === 'driver' || type === 'pickup') return false

      const lat = Number(s.lat)
      const lng = Number(s.lng ?? s.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false

      const isAtPickup =
        Math.abs(lat - pickup.lat) < 0.0001 &&
        Math.abs(lng - pickup.lng) < 0.0001

      const isAtDropoff =
        dropoff &&
        Math.abs(lat - dropoff.lat) < 0.0001 &&
        Math.abs(lng - dropoff.lng) < 0.0001

      return !isAtPickup && !isAtDropoff
    })

    const stopSig = originalStops
      .map(s => `${round6(Number(s.lat))},${round6(Number(s.lng ?? s.lon))}`)
      .join('|')

    const routeSig =
      `${effectiveDriverId}:${baseOrder.id}:` +
      `${round6(myDriverLoc.lat)},${round6(myDriverLoc.lng)}->` +
      `${round6(pickup.lat)},${round6(pickup.lng)}->` +
      `${stopSig}->` +
      `${round6(dropoff?.lat)},${round6(dropoff?.lng)}`

const routeCacheKey = getDriverOrderRouteKey(baseOrder, effectiveDriverId, myDriverLoc)

return [
  {
    ...cleanOrder,
    driverId: effectiveDriverId,
    _routeOwnerDriverId: effectiveDriverId,
    _routeCacheKey: routeCacheKey,
    assignedDriverId: effectiveDriverId,
    driver_id: effectiveDriverId,
    pickupLocation: pickup,
    dropoffLocation: dropoff,
    stops: [...linearStops, ...originalStops],
    _forceUpdate: routeSig,
  },
]
  }, [myDriverLoc, myActiveOrder, selectedOrderId, pendingOrders, effectiveDriverId, driverReady, myHotspotMove])

const shouldFollowCar = useMemo(() => {
  if (!myDriverLoc) return false
  return Boolean(myActiveOrder || myHotspotMove)
}, [myDriverLoc, myActiveOrder, myHotspotMove])

  const myCompletedOrders = useMemo(() => {
    if (effectiveDriverId == null) return []
    const done = allOrdersFromProps
      .filter(o => o && sameId(getAnyDriverId(o), effectiveDriverId))
      .filter(o => normStatus(o.status) === 'completed')

    done.sort(
      (a, b) =>
        (b.completedAt ? Date.parse(b.completedAt) : 0) -
        (a.completedAt ? Date.parse(a.completedAt) : 0)
    )
    return done
  }, [allOrdersFromProps, effectiveDriverId])

  const handleAcceptAndSync = useCallback((orderId) => {
    if (isDriverMoving) return

    const order = pendingOrders.find(o => sameId(o.id, orderId))
    if (!order) return

    setSelectedOrderId(orderId)
    setRouteConfirmingOrder(null)
    setAcceptConfirmOrder(order)
  }, [isDriverMoving, pendingOrders])

  const confirmAcceptOrder = useCallback(async () => {
    const order = acceptConfirmOrder
    if (!order || isDriverMoving) return

    setAcceptConfirmOrder(null)
    setRouteConfirmingOrder(order)
    setSelectedOrderId(order.id)

    emitInstantOrderAccepted(order, effectiveDriverId)

    const routePromise =
      myDriverLoc && effectiveDriverId != null
        ? buildAndCacheOrderRoute(order, effectiveDriverId, myDriverLoc).catch(() => {})
        : Promise.resolve()

    await acceptOrder(order.id)
    await refresh?.()
    routePromise.catch(() => {})
  }, [acceptConfirmOrder, acceptOrder, refresh, isDriverMoving, myDriverLoc, effectiveDriverId])

  useEffect(() => {
    if (!myCompletedOrders.length) return

    let newlyCompleted = null
    for (const o of myCompletedOrders) {
      const key = makeOrderKey(o) || `id:${o?.id ?? ''}`
      if (!completedSeenRef.current.has(key)) {
        newlyCompleted = o
        completedSeenRef.current.add(key)
        break
      }
    }

    if (!newlyCompleted) return

    const price = newlyCompleted.estimatedFare || newlyCompleted.price || null
    setCompletedNotice(
      `${t(lang, 'driverCompletedNoticePrefix')}（#${newlyCompleted.id}），${t(lang, 'driverCompletedNoticePriceLabel')}${price != null ? `$${price.toFixed(2)}` : t(lang, 'unknownValue')}`
    )
    setTimeout(() => setCompletedNotice(''), 7000)
  }, [myCompletedOrders])

  const modalPickupText = acceptConfirmOrder?.pickup || acceptConfirmOrder?.pickupText || acceptConfirmOrder?.pickupName || acceptConfirmOrder?.pickupAddress || '上車停靠點未提供'
  const modalDropoffText = acceptConfirmOrder?.dropoff || acceptConfirmOrder?.dropoffText || acceptConfirmOrder?.dropoffName || acceptConfirmOrder?.dropoffAddress || '下車停靠點未提供'
  const routeModalPickupText = routeConfirmingOrder?.pickup || routeConfirmingOrder?.pickupText || routeConfirmingOrder?.pickupName || routeConfirmingOrder?.pickupAddress || '上車停靠點未提供'
  const routeModalDropoffText = routeConfirmingOrder?.dropoff || routeConfirmingOrder?.dropoffText || routeConfirmingOrder?.dropoffName || routeConfirmingOrder?.dropoffAddress || '下車停靠點未提供'

  return (
    <section className="map-section">
      {acceptConfirmOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', width: 'min(420px, 92vw)', background: '#fff', color: '#111', borderRadius: 14, padding: '22px 22px 18px', boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
            <button type="button" onClick={() => setAcceptConfirmOrder(null)} style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, border: 'none', borderRadius: 6, background: '#111', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>X</button>
            <h3 style={{ margin: '0 40px 14px 0', fontSize: 20 }}>確認接單</h3>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div><b>上車停靠點：</b>{modalPickupText}</div>
              <div><b>下車停靠點：</b>{modalDropoffText}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" onClick={confirmAcceptOrder} style={{ border: 'none', borderRadius: 8, background: '#111', color: '#fff', padding: '10px 18px', fontWeight: 800, cursor: 'pointer' }}>確認接單</button>
            </div>
          </div>
        </div>
      )}

      {routeConfirmingOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', width: 'min(420px, 92vw)', background: '#fff', color: '#111', borderRadius: 14, padding: '22px 22px 18px', boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
            <button type="button" onClick={() => setRouteConfirmingOrder(null)} style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, border: 'none', borderRadius: 6, background: '#111', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>X</button>
            <h3 style={{ margin: '0 40px 12px 0', fontSize: 20 }}>路線確認中，請稍後...</h3>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div><b>上車停靠點：</b>{routeModalPickupText}</div>
              <div><b>下車停靠點：</b>{routeModalDropoffText}</div>
            </div>
          </div>
        </div>
      )}
      <div className="map-wrapper">
<MapView
          key="driver-map"
          lang={lang}
          drivers={driverReady ? visibleDrivers : []}
          orders={driverReady ? mapOrders : []}
          mode="driver"
          currentDriverId={driverReady ? effectiveDriverId : null}
          onDriverLocationChange={handleDriverLocationChange}
          driverClickEnabled={driverReady && !isDriverMoving && !locConfirmed}
          simulateVehicles={simulateVehicles}
          onOrderCompleted={onOrderCompleted}          onCarPosChange={handleCarPosChange}
          usePersistedDriverLoc={true}          
          followActiveCar={shouldFollowCar}
          previewEnabled={false}
          rotateMapWithHeading={true}
          hotspots={showHotspots ? hotspots : []}
        />
      </div>

      <aside className={`side-panel ${panelCollapsed ? 'collapsed' : ''}`}>
       
        <button
        type="button"
        className="panel-toggle-btn"
        onClick={() => setPanelCollapsed(v => !v)}
        aria-label={panelCollapsed ? t(lang, 'panelExpand') : t(lang, 'panelCollapse')}
        title={panelCollapsed ? t(lang, 'panelExpand') : t(lang, 'panelCollapse')}
      >
        {panelCollapsed
          ? `⌃ ${t(lang, 'panelExpand')}`
          : `⌄ ${t(lang, 'panelCollapse')}`}
      </button>

        <div className={`panel-inner ${panelCollapsed ? 'hidden' : ''}`}>
          <h1 className="panel-title">{t(lang, 'driverMode')}</h1>

          {modelData && (
            <div className="model-data-strip" aria-label="AI 模型資料摘要">
              <div>
                <strong>{Number(modelData.training_rows || 0).toLocaleString()}</strong>
                <span>訓練筆數</span>
              </div>
              <div>
                <strong>{Number(modelData.training_zones || 0)}</strong>
                <span>分區</span>
              </div>
              <div>
                <strong>{Number(modelData.training_hours || 0)}</strong>
                <span>小時</span>
              </div>
            </div>
          )}

          <div className="field-label">{t(lang, 'currentDriverLabel')}</div>

          <div style={{ marginBottom: 10 }}>
            <select
              className="current-driver-box"
              value={selectedCarType}
              onChange={e => setSelectedCarType(e.target.value)}
              style={{ width: '100%', cursor: 'pointer' }}
            >
              <option value="GREEN">GREEN</option>
              <option value="YELLOW">YELLOW</option>
              <option value="FHV">FHV</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {selectableDrivers.map(d => (
              <button
                key={d.id}
                type="button"
                className="current-driver-box"
                onClick={() => onSelectPresetDriver?.(d)}
                style={{
                  cursor: 'pointer',
                  borderColor: sameId(currentDriverId, d.id) ? '#1976d2' : undefined,
                  fontWeight: sameId(currentDriverId, d.id) ? 700 : 500,
                }}
              >
                {d.username}
              </button>
            ))}
          </div>

          {completedNotice && <div className="ub-toast ub-toast--success">{completedNotice}</div>}

          {isLoggedIn && !locConfirmed && (
            <div className="ub-toast ub-toast--warn" style={{ marginBottom: 12 }}>
              {t(lang, 'driverSetInitialLocationHint')}
            </div>
          )}

          {isLoggedIn && effectiveDriverId != null && (
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="ghost-btn"
                onClick={resetMyLocation}
                disabled={isDriverMoving}
                style={{
                  width: '100%',
                  opacity: isDriverMoving ? 0.55 : 1,
                  cursor: isDriverMoving ? 'not-allowed' : 'pointer',
                }}
              >
                {isDriverMoving ? '司機移動中' : t(lang, 'driverResetLocationDebug')}
              </button>
            </div>
          )}

          <section className="orders-block" style={{ marginTop: 14 }}>
            <div className="orders-header">
              <h3>{t(lang, 'ordersTitleDriver')}</h3>
              <button className="ghost-btn" type="button" onClick={refresh} disabled={loading}>
                {t(lang, 'refresh')}
              </button>
            </div>

            <OrderList
              lang={lang}
              orders={locConfirmed ? displayOrders : []}
              isDriverView
              onAcceptOrder={handleAcceptAndSync}
              drivers={drivers}
              currentDriverId={driverReady ? effectiveDriverId : null}
              selectedOrderId={selectedOrderId}
              driverBusy={isDriverMoving}
              activeOrderId={myActiveOrder?.id ?? myHotspotMove?.id ?? null}
              onSelectOrder={id => {
                setSelectedOrderId(id)

                const order = pendingOrders.find(o => sameId(o.id, id))
                if (order && myDriverLoc && effectiveDriverId != null) {
                  buildAndCacheOrderRoute(order, effectiveDriverId, myDriverLoc).catch(() => {})
                }
              }}
            />

            {loading && (
              <div className="auth-hint" style={{ marginTop: 8 }}>
                {t(lang, 'loading')}
              </div>
            )}
            {error && <div className="error-box">{error}</div>}
          </section>

          {isLoggedIn && myCompletedOrders.length > 0 && (
            <section className="orders-block" style={{ marginTop: 14 }}>
              <h3>{t(lang, 'driverCompletedOrdersTitle')}</h3>
              {myCompletedOrders.slice(0, 5).map(o => (
                <div
                  key={o.id}
                  style={{
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    background: '#fff',
                  }}
                >
                  <div style={{ fontWeight: 800 }}>
                    {t(lang, 'driverOrderPrefix')}{o.id}{' '}
                    <span style={{ color: 'green' }}>{t(lang, 'driverCompletedTag')}</span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {t(lang, 'orderPickupLabel')}：{o.pickup}
                    <br />
                    {t(lang, 'orderDropoffLabel')}：{o.dropoff}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </aside>
    </section>
  )
}
