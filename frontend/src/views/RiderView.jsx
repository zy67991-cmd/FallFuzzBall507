//rider
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import MapView from '../components/MapView.jsx'
import OrderList from '../components/OrderList.jsx'
import MapLocationPicker from '../components/MapLocationPicker.jsx'
import { t } from '../i18n'
import { apiFetch } from '../apiBase.js'
import { ROAD_SNAP_FAIL_MESSAGE, snapRoad } from '../utils/roadSnap.js'

const ORDER_SYNC_KEY = 'orderSyncEventV1'
const ORDER_SYNC_EVT = 'orderSyncEventChanged'

const QUICK_PLANS = [
  {
    name: 'Times Sq -> Central Park',
    pickup: 'Times Square',
    pickupLoc: { lat: 40.758, lng: -73.9855 },
    dropoff: 'Central Park',
    dropoffLoc: { lat: 40.7829, lng: -73.9654 },
  },
  {
    name: 'Penn Station -> Wall Street',
    pickup: 'Penn Station',
    pickupLoc: { lat: 40.7502, lng: -73.9928 },
    dropoff: 'Wall Street',
    dropoffLoc: { lat: 40.706, lng: -74.0086 },
  },
  {
    name: 'JFK -> Midtown',
    pickup: 'JFK Airport',
    pickupLoc: { lat: 40.6413, lng: -73.7781 },
    dropoff: 'Midtown Center',
    dropoffLoc: { lat: 40.7577, lng: -73.9773 },
  },
]

function normalizeGeocodeList(data) {
  if (!Array.isArray(data)) return []
  return data
    .map(x => {
      const label = x?.label ?? x?.display_name ?? x?.name ?? ''
      const lat = Number(x?.lat)
      const lng = Number(x?.lng ?? x?.lon)
      return { label, lat, lng }
    })
    .filter(x => x.label && Number.isFinite(x.lat) && Number.isFinite(x.lng))
}

function normStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function isCompletedStatus(status) {
  return normStatus(status) === 'completed'
}

function isActiveAssignedStatus(status) {
  const s = String(status || '').trim().toLowerCase()
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

function getAnyDriverId(o) {
  return o?.driverId ?? o?.assignedDriverId ?? o?.driver_id ?? null
}

function getOrderPickupText(o) {
  return o?.pickup || o?.pickupText || o?.pickupName || o?.pickupAddress || '上車停靠點未提供'
}

function getOrderDropoffText(o) {
  return o?.dropoff || o?.dropoffText || o?.dropoffName || o?.dropoffAddress || '下車停靠點未提供'
}

function getOrderPriceText(o) {
  const price = Number(o?.estimatedPrice ?? o?.estimatedFare ?? o?.price ?? o?.fare ?? o?.amount)
  return Number.isFinite(price) ? '$' + price.toFixed(2) : '金額未提供'
}

function isAcceptedSyncReason(reason) {
  return reason === 'order-accepted' || reason === 'order-accepted-confirm'
}

function parseOrderSyncPayload(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default function RiderView({
  lang,
  drivers,
  orders,
  ordersWithLocations,
  loading,
  error,
  createOrder,
  refresh,
  currentUser,
  simulateVehicles,

  initialDraft,
  onDraftChange,
  onOpenAuth,

  onOrderCompleted,
  onCarPosChange,
}) {
  const didInitDraft = useRef(false)

  const [pickupText, setPickupText] = useState('')
  const [dropoffText, setDropoffText] = useState('')

  const [pickupLoc, setPickupLoc] = useState(null)
  const [dropoffLoc, setDropoffLoc] = useState(null)

  const [pickupLocked, setPickupLocked] = useState(false)
  const [dropoffLocked, setDropoffLocked] = useState(false)

  const [pickupDirty, setPickupDirty] = useState(false)
  const [dropoffDirty, setDropoffDirty] = useState(false)

  const [pickupSuggestions, setPickupSuggestions] = useState([])
  const [dropoffSuggestions, setDropoffSuggestions] = useState([])

  const [stops, setStops] = useState([])

  const [fareOptions, setFareOptions] = useState(null)
  const [fareError, setFareError] = useState('')
  const [lastDistanceKm, setLastDistanceKm] = useState(null)
  const [lastDurationMin, setLastDurationMin] = useState(null)
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [resolvedStops, setResolvedStops] = useState([])
  const [previewRouteCoords, setPreviewRouteCoords] = useState(null)
  const [mapPicker, setMapPicker] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [completedOrderIds, setCompletedOrderIds] = useState(() => new Set())

  const [toast, setToast] = useState('')
  const [matchModalOrderId, setMatchModalOrderId] = useState(null)
  const [matchModalOrderSnapshot, setMatchModalOrderSnapshot] = useState(null)
  const toastTimerRef = useRef(null)
  const dismissedMatchModalIdsRef = useRef(new Set())

  const userManuallySelectedOrder = useRef(false)
  useEffect(() => {
    const handleSync = () => {
      refresh?.()
    }

    const handleStorage = e => {
      if (e.key === ORDER_SYNC_KEY) handleSync()
    }

    window.addEventListener(ORDER_SYNC_EVT, handleSync)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(ORDER_SYNC_EVT, handleSync)
      window.removeEventListener('storage', handleStorage)
    }
  }, [refresh])

  const [composerLocked, setComposerLocked] = useState(false)
  const [composeMode, setComposeMode] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const stopControllersRef = useRef({})
  const [modelData, setModelData] = useState(null)

  useEffect(() => {
    return () => {
      try {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      } catch {}
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    apiFetch('/api/health', { timeoutMs: 15000, dedupe: false })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setModelData(data?.model_data || null)
      })
      .catch(() => {
        if (!cancelled) setModelData(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const showToast = (msg, ms = 2800) => {
    try {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    } catch {}
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(''), ms)
  }

  const resetFarePanel = () => {
    setFareOptions(null)
    setFareError('')
    setLastDistanceKm(null)
    setLastDurationMin(null)
    setSelectedVehicle(null)
    setResolvedStops([])
  }

  const resetComposerInputs = () => {
    try {
      Object.values(stopControllersRef.current || {}).forEach(entry => {
        if (entry?.timer) clearTimeout(entry.timer)
        if (entry?.controller) entry.controller.abort()
      })
    } catch {}
    stopControllersRef.current = {}

    setPickupText('')
    setDropoffText('')
    setPickupLoc(null)
    setDropoffLoc(null)

    setPickupLocked(false)
    setDropoffLocked(false)
    setPickupDirty(false)
    setDropoffDirty(false)

    setPickupSuggestions([])
    setDropoffSuggestions([])

    setStops([])
    resetFarePanel()
  }

  useEffect(() => {
    if (didInitDraft.current) return
    didInitDraft.current = true
    if (!initialDraft) return

    setPickupText(initialDraft.pickupText || '')
    setDropoffText(initialDraft.dropoffText || '')
    setPickupLoc(initialDraft.pickupLoc || null)
    setDropoffLoc(initialDraft.dropoffLoc || null)

    setPickupLocked(Boolean(initialDraft.pickupLoc))
    setDropoffLocked(Boolean(initialDraft.dropoffLoc))
    setPickupDirty(false)
    setDropoffDirty(false)
    setPickupSuggestions([])
    setDropoffSuggestions([])

    const draftStops = Array.isArray(initialDraft.stops) ? initialDraft.stops : []
    setStops(
      draftStops.map(s => ({
        text: s?.text || s?.label || '',
        loc: s?.loc
          ? { lat: Number(s.loc.lat), lng: Number(s.loc.lng) }
          : s?.lat && s?.lng
          ? { lat: Number(s.lat), lng: Number(s.lng) }
          : null,
        locked: Boolean(s?.loc || (s?.lat && s?.lng) || s?.locked),
        dirty: false,
        suggestions: [],
      }))
    )

    setComposerLocked(Boolean(initialDraft.composerLocked))
    setComposeMode(Boolean(initialDraft.composeMode))
    setSelectedOrderId(initialDraft.selectedOrderId ?? null)
  }, [initialDraft])

  useEffect(() => {
    if (!onDraftChange) return

    const payload = {
      pickupText,
      dropoffText,
      pickupLoc,
      dropoffLoc,
      stops: stops.map(s => ({
        text: s.text,
        loc: s.loc,
        locked: s.locked,
      })),
      composerLocked,
      composeMode,
      selectedOrderId,
    }

    try {
      onDraftChange(prev => ({ ...(prev || {}), ...payload }))
    } catch {
      onDraftChange(payload)
    }
  }, [pickupText, dropoffText, pickupLoc, dropoffLoc, stops, composerLocked, composeMode, selectedOrderId])

  const passengerOrdersWithLocAll = useMemo(() => {
    return Array.isArray(ordersWithLocations) ? ordersWithLocations : []
  }, [ordersWithLocations])


  const openMatchedOrderModalFromSync = useCallback((payload) => {
    if (!payload || !isAcceptedSyncReason(payload.reason)) return

    const id = payload.orderId ?? payload?.order?.id
    if (id == null) return

    const snapshot = payload?.order && typeof payload.order === 'object' ? payload.order : null
    const localOrder = passengerOrdersWithLocAll.find(o => String(o?.id) === String(id))

    const belongsToThisPassenger =
      Boolean(localOrder) ||
      !snapshot?.customer ||
      !currentUser?.username ||
      String(snapshot.customer) === String(currentUser.username)

    if (!belongsToThisPassenger) return

    dismissedMatchModalIdsRef.current.delete(id)
    setMatchModalOrderId(id)
    setMatchModalOrderSnapshot(snapshot)
  }, [passengerOrdersWithLocAll, currentUser?.username])

  useEffect(() => {
    const handleAcceptedSync = e => {
      openMatchedOrderModalFromSync(e?.detail)
    }

    const handleAcceptedStorage = e => {
      if (e.key !== ORDER_SYNC_KEY) return
      openMatchedOrderModalFromSync(parseOrderSyncPayload(e.newValue))
    }

    window.addEventListener(ORDER_SYNC_EVT, handleAcceptedSync)
    window.addEventListener('storage', handleAcceptedStorage)

    return () => {
      window.removeEventListener(ORDER_SYNC_EVT, handleAcceptedSync)
      window.removeEventListener('storage', handleAcceptedStorage)
    }
  }, [openMatchedOrderModalFromSync])

  const defaultOrder = useMemo(() => {
    if (!passengerOrdersWithLocAll.length) return null
    const isDone = o => completedOrderIds?.has?.(o?.id)

    const notDone = passengerOrdersWithLocAll
      .filter(o => !isDone(o))
      .sort(
        (a, b) =>
          (Date.parse(b.updatedAt || b.createdAt || 0) || b.id) - (Date.parse(a.updatedAt || a.createdAt || 0) || a.id)
      )

    if (notDone[0]) return notDone[0]

    const sorted = [...passengerOrdersWithLocAll].sort(
      (a, b) =>
        (Date.parse(b.updatedAt || b.createdAt || 0) || b.id) - (Date.parse(a.updatedAt || a.createdAt || 0) || a.id)
    )
    return sorted[0] || null
  }, [passengerOrdersWithLocAll, completedOrderIds])

const syncedActivePassengerOrder = useMemo(() => {
  const mine = passengerOrdersWithLocAll.filter(o => !completedOrderIds.has(o?.id))

  const activeAssigned = mine
    .filter(o => getAnyDriverId(o) != null && isActiveAssignedStatus(o.status))
    .sort((a, b) => {
      const ta = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0
      const tb = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0
      return tb - ta
    })

  return activeAssigned[0] || null
}, [passengerOrdersWithLocAll, completedOrderIds])

useEffect(() => {
  const id = syncedActivePassengerOrder?.id
  if (id == null) return
  if (dismissedMatchModalIdsRef.current.has(id)) return
  setMatchModalOrderId(id)
}, [syncedActivePassengerOrder])

const activeMatchModalOrder = useMemo(() => {
  if (matchModalOrderId == null) return null
  return (
    passengerOrdersWithLocAll.find(o => String(o?.id) === String(matchModalOrderId)) ||
    (matchModalOrderSnapshot && String(matchModalOrderSnapshot?.id) === String(matchModalOrderId) ? matchModalOrderSnapshot : null) ||
    null
  )
}, [matchModalOrderId, passengerOrdersWithLocAll, matchModalOrderSnapshot])

const activeMatchModalDriver = useMemo(() => {
  const driverId = getAnyDriverId(activeMatchModalOrder)
  if (driverId == null) return null
  return drivers?.find(d => String(d?.id) === String(driverId)) || null
}, [activeMatchModalOrder, drivers])

const closeMatchModal = useCallback(() => {
  if (matchModalOrderId != null) dismissedMatchModalIdsRef.current.add(matchModalOrderId)
  setMatchModalOrderId(null)
  setMatchModalOrderSnapshot(null)
}, [matchModalOrderId])

const handlePassengerCarPosChange = useCallback((orderIdOrPayload, maybePayload = null) => {
  if (matchModalOrderId != null && String(orderIdOrPayload) === String(matchModalOrderId)) {
    dismissedMatchModalIdsRef.current.add(matchModalOrderId)
    setMatchModalOrderId(null)
    setMatchModalOrderSnapshot(null)
  }
  onCarPosChange?.(orderIdOrPayload, maybePayload)
}, [matchModalOrderId, onCarPosChange])

useEffect(() => {
  if (composeMode) return

  if (userManuallySelectedOrder.current) {
    const stillExists = passengerOrdersWithLocAll.some(
      o => o.id === selectedOrderId && !isCompletedStatus(o.status)
    )
    if (stillExists) return
    userManuallySelectedOrder.current = false
  }

  if (syncedActivePassengerOrder?.id != null) {
    setSelectedOrderId(syncedActivePassengerOrder.id)
    return
  }

  if (defaultOrder?.id != null) setSelectedOrderId(defaultOrder.id)
}, [
  syncedActivePassengerOrder,
  defaultOrder,
  composeMode,
  passengerOrdersWithLocAll,
  selectedOrderId,
])

  const selectedOrder = useMemo(() => {
    if (selectedOrderId == null) return null
    return passengerOrdersWithLocAll.find(o => o.id === selectedOrderId) || null
  }, [passengerOrdersWithLocAll, selectedOrderId])

  const displayOrders = useMemo(() => {
    const rows = Array.isArray(orders) ? [...orders] : []

    rows.sort((a, b) => {
      const aActive = getAnyDriverId(a) != null && isActiveAssignedStatus(a.status)
      const bActive = getAnyDriverId(b) != null && isActiveAssignedStatus(b.status)

      if (aActive !== bActive) return aActive ? -1 : 1

      const aDone = isCompletedStatus(a.status) || completedOrderIds.has(a.id)
      const bDone = isCompletedStatus(b.status) || completedOrderIds.has(b.id)

      if (aDone !== bDone) return aDone ? 1 : -1

      const ta = Date.parse(a?.updatedAt || a?.updated_at || a?.createdAt || a?.created_at || 0) || Number(a?.id || 0)
      const tb = Date.parse(b?.updatedAt || b?.updated_at || b?.createdAt || b?.created_at || 0) || Number(b?.id || 0)

      return tb - ta
    })

    return rows
  }, [orders, completedOrderIds])

const previewStopsResolved = useMemo(() => {
  return stops
    .filter(s => s?.loc && Number.isFinite(s.loc.lat) && Number.isFinite(s.loc.lng))
    .map(s => ({ label: s.text, lat: s.loc.lat, lng: s.loc.lng }))
}, [stops])

const previewPointSequence = useMemo(() => {
  const pts = []

  if (pickupLoc && Number.isFinite(pickupLoc.lat) && Number.isFinite(pickupLoc.lng)) {
    pts.push({
      kind: 'pickup',
      label: pickupText || '起點',
      lat: pickupLoc.lat,
      lng: pickupLoc.lng,
    })
  }

  for (const s of previewStopsResolved) {
    pts.push({
      kind: 'stop',
      label: s.label,
      lat: s.lat,
      lng: s.lng,
    })
  }

  if (dropoffLoc && Number.isFinite(dropoffLoc.lat) && Number.isFinite(dropoffLoc.lng)) {
    pts.push({
      kind: 'dropoff',
      label: dropoffText || '終點',
      lat: dropoffLoc.lat,
      lng: dropoffLoc.lng,
    })
  }

  return pts
}, [pickupLoc, pickupText, previewStopsResolved, dropoffLoc, dropoffText])

useEffect(() => {
  let cancelled = false

  async function loadPreviewRoute() {
    if (previewPointSequence.length < 2) {
      setPreviewRouteCoords(null)
      return
    }

    try {
      const coords = await osrmRouteGeometry(
        previewPointSequence.map(p => ({ lat: p.lat, lng: p.lng }))
      )
      if (!cancelled) setPreviewRouteCoords(coords)
    } catch {
      if (!cancelled) {
        setPreviewRouteCoords(
          previewPointSequence.map(p => ({ lat: p.lat, lng: p.lng }))
        )
      }
    }
  }

  loadPreviewRoute()
  return () => {
    cancelled = true
  }
}, [previewPointSequence])

const previewWaypoints = useMemo(() => {
  if (previewPointSequence.length < 2) return null
  if (Array.isArray(previewRouteCoords) && previewRouteCoords.length >= 2) {
    return previewRouteCoords
  }
  return previewPointSequence.map(p => ({ lat: p.lat, lng: p.lng }))
}, [previewPointSequence, previewRouteCoords])

const shouldShowPreview = useMemo(() => {
  return composeMode && previewPointSequence.length >= 1
}, [composeMode, previewPointSequence.length])

const previewMarkers = useMemo(() => {
  return {
    pickup: pickupLoc,
    dropoff: dropoffLoc,
    stops: previewStopsResolved,
  }
}, [pickupLoc, dropoffLoc, previewStopsResolved])

  async function geocodeOnce(text) {
    if (!text || !text.trim()) return null
    const res = await apiFetch('/api/geocode', { query: { q: text.trim() } })
    if (!res.ok) return null
    const data = normalizeGeocodeList(await res.json().catch(() => []))
    if (!data.length) return null
    return { lat: data[0].lat, lng: data[0].lng, label: data[0].label }
  }

  function distanceKm(a, b) {
    const toRad = d => (d * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const la1 = toRad(a.lat)
    const la2 = toRad(b.lat)
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
    return R * c
  }

async function backendRouteSegment(from, to) {
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
  return {
    coords: Array.isArray(data?.coords)
      ? data.coords.map(p => ({ lat: Number(p[0]), lng: Number(p[1]) }))
      : [],
    dist: Number.isFinite(Number(data?.dist)) ? Number(data.dist) : null,
    durationSec: Number.isFinite(Number(data?.duration_sec ?? data?.durationSec ?? data?.duration))
      ? Number(data?.duration_sec ?? data?.durationSec ?? data?.duration)
      : null,
  }
}

async function osrmRouteMetrics(points) {
  if (!Array.isArray(points) || points.length < 2) return null

  let total = 0
  let durationSec = 0
  let hasDuration = false

  for (let i = 0; i < points.length - 1; i++) {
    const rt = await backendRouteSegment(points[i], points[i + 1])
    if (!Number.isFinite(Number(rt.dist))) throw new Error('route no distance')
    total += Number(rt.dist)
    if (Number.isFinite(Number(rt.durationSec)) && Number(rt.durationSec) > 0) {
      durationSec += Number(rt.durationSec)
      hasDuration = true
    }
  }

  return { dist: total, durationSec: hasDuration ? durationSec : null }
}

async function osrmRouteDistanceKm(points) {
  const metrics = await osrmRouteMetrics(points)
  return metrics?.dist ?? null
}

async function osrmRouteGeometry(points) {
  if (!Array.isArray(points) || points.length < 2) return null

  const merged = []

  for (let i = 0; i < points.length - 1; i++) {
    const rt = await backendRouteSegment(points[i], points[i + 1])
    const coords = rt.coords && rt.coords.length
      ? rt.coords
      : [points[i], points[i + 1]]

    if (i === 0) merged.push(...coords)
    else merged.push(...coords.slice(1))
  }

  if (merged.length < 2) throw new Error('route geometry no route')
  return merged
}

  useEffect(() => {
    if (composerLocked) return
    if (pickupLocked || !pickupDirty) {
      setPickupSuggestions([])
      return
    }
    if (!pickupText || pickupText.trim().length < 2) {
      setPickupSuggestions([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/geocode', { query: { q: pickupText.trim() }, signal: controller.signal })
        if (!res.ok) return
        const data = normalizeGeocodeList(await res.json().catch(() => []))
        setPickupSuggestions(data)
      } catch {}
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pickupText, pickupLocked, pickupDirty, composerLocked])

  useEffect(() => {
    if (composerLocked) return
    if (dropoffLocked || !dropoffDirty) {
      setDropoffSuggestions([])
      return
    }
    if (!dropoffText || dropoffText.trim().length < 2) {
      setDropoffSuggestions([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/geocode', { query: { q: dropoffText.trim() }, signal: controller.signal })
        if (!res.ok) return
        const data = normalizeGeocodeList(await res.json().catch(() => []))
        setDropoffSuggestions(data)
      } catch {}
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [dropoffText, dropoffLocked, dropoffDirty, composerLocked])

  const handleSelectPickup = item => {
    setPickupText(item.label)
    setPickupLoc({ lat: item.lat, lng: item.lng })
    setPickupLocked(true)
    setPickupDirty(false)
    setPickupSuggestions([])
    resetFarePanel()
  }

  const handleSelectDropoff = item => {
    setDropoffText(item.label)
    setDropoffLoc({ lat: item.lat, lng: item.lng })
    setDropoffLocked(true)
    setDropoffDirty(false)
    setDropoffSuggestions([])
    resetFarePanel()
  }

  const addStop = () => {
    if (composerLocked) return
    setStops(prev => [...prev, { text: '', loc: null, locked: false, dirty: false, suggestions: [] }])
    resetFarePanel()
  }

  const removeStop = index => {
    const entry = stopControllersRef.current[index]
    if (entry?.timer) clearTimeout(entry.timer)
    if (entry?.controller) entry.controller.abort()
    delete stopControllersRef.current[index]

    setStops(prev => prev.filter((_, i) => i !== index))
    resetFarePanel()
  }

  const updateStopText = (index, text) => {
    if (composerLocked) return

    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = { ...copy[index], text, loc: null, locked: false, dirty: true, suggestions: [] }
      return copy
    })
    resetFarePanel()

    const trimmed = (text || '').trim()
    if (trimmed.length < 2) {
      const entry = stopControllersRef.current[index]
      if (entry?.timer) clearTimeout(entry.timer)
      if (entry?.controller) entry.controller.abort()
      stopControllersRef.current[index] = null
      return
    }

    const prevEntry = stopControllersRef.current[index]
    if (prevEntry?.timer) clearTimeout(prevEntry.timer)
    if (prevEntry?.controller) prevEntry.controller.abort()

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/geocode', { query: { q: trimmed }, signal: controller.signal })
        if (!res.ok) return
        const data = normalizeGeocodeList(await res.json().catch(() => []))

        setStops(prev => {
          const copy = [...prev]
          if (!copy[index]) return prev
          if (copy[index].locked) return prev
          if (!copy[index].dirty) return prev
          if (copy[index].text !== text) return prev
          copy[index] = { ...copy[index], suggestions: data }
          return copy
        })
      } catch {}
    }, 250)

    stopControllersRef.current[index] = { timer, controller }
  }

  const handleSelectStopSuggestion = (index, item) => {
    const entry = stopControllersRef.current[index]
    if (entry?.timer) clearTimeout(entry.timer)
    if (entry?.controller) entry.controller.abort()
    stopControllersRef.current[index] = null

    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = {
        ...copy[index],
        text: item.label,
        loc: { lat: item.lat, lng: item.lng },
        locked: true,
        dirty: false,
        suggestions: [],
      }
      return copy
    })
    resetFarePanel()
  }

  
  const applyMapPickedLocation = item => {
    if (!mapPicker || !item) return
    setComposeMode(true)
    resetFarePanel()

    if (mapPicker.type === 'pickup') handleSelectPickup(item)
    else if (mapPicker.type === 'dropoff') handleSelectDropoff(item)
    else if (mapPicker.type === 'stop') handleSelectStopSuggestion(mapPicker.index, item)

    setMapPicker(null)
  }

  const clearPickupPoint = () => {
    setComposeMode(true)
    setPickupText('')
    setPickupLoc(null)
    setPickupLocked(false)
    setPickupDirty(false)
    setPickupSuggestions([])
    resetFarePanel()
  }

  const clearDropoffPoint = () => {
    setComposeMode(true)
    setDropoffText('')
    setDropoffLoc(null)
    setDropoffLocked(false)
    setDropoffDirty(false)
    setDropoffSuggestions([])
    resetFarePanel()
  }

  const clearStopPoint = index => {
    setComposeMode(true)
    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = { ...copy[index], text: '', loc: null, locked: false, dirty: false, suggestions: [] }
      return copy
    })
    resetFarePanel()
  }

const handleCheckPrice = async () => {
    if (composerLocked) return

    if (!pickupText.trim() || !dropoffText.trim()) {
      alert(t(lang, 'needPickupDropoff'))
      return
    }

    if (!currentUser || currentUser.role !== 'passenger') {
      onOpenAuth?.('rider', 'passenger')
      return
    }

    resetFarePanel()

    try {
      let pLoc = pickupLoc
      let dLoc = dropoffLoc

      if (!pLoc) {
        const got = await geocodeOnce(pickupText)
        if (got) {
          pLoc = { lat: got.lat, lng: got.lng }
          setPickupLoc(pLoc)
        }
      }
      if (!dLoc) {
        const got = await geocodeOnce(dropoffText)
        if (got) {
          dLoc = { lat: got.lat, lng: got.lng }
          setDropoffLoc(dLoc)
        }
      }

      if (!pLoc || !dLoc) {
        setFareError(t(lang, 'cannotFindPickupOrDropoff'))
        return
      }

      const snappedPickup = await snapRoad(pLoc.lat, pLoc.lng)
      if (!snappedPickup.ok) {
        setFareError(snappedPickup.message || ROAD_SNAP_FAIL_MESSAGE)
        return
      }
      pLoc = { lat: snappedPickup.lat, lng: snappedPickup.lng }
      setPickupLoc(pLoc)

      const snappedDropoff = await snapRoad(dLoc.lat, dLoc.lng)
      if (!snappedDropoff.ok) {
        setFareError(snappedDropoff.message || ROAD_SNAP_FAIL_MESSAGE)
        return
      }
      dLoc = { lat: snappedDropoff.lat, lng: snappedDropoff.lng }
      setDropoffLoc(dLoc)

      const resolved = []
      for (const s of stops) {
        const label = (s.text || '').trim()
        if (!label) continue

        let loc = s.loc
        if (!loc) {
          const got = await geocodeOnce(label)
          if (got) loc = { lat: got.lat, lng: got.lng }
        }

        if (!loc) {
          setFareError(t(lang, 'cannotFindStop'))
          return
        }

        const snappedStop = await snapRoad(loc.lat, loc.lng)
        if (!snappedStop.ok) {
          setFareError(snappedStop.message || ROAD_SNAP_FAIL_MESSAGE)
          return
        }
        resolved.push({ label, lat: snappedStop.lat, lng: snappedStop.lng })
      }
      setResolvedStops(resolved)

      const points = [
        { lat: pLoc.lat, lng: pLoc.lng },
        ...resolved.map(s => ({ lat: s.lat, lng: s.lng })),
        { lat: dLoc.lat, lng: dLoc.lng },
      ]

      let totalDist = 0
      let totalDurationSec = null
      try {
        const metrics = await osrmRouteMetrics(points)
        totalDist = Number(metrics?.dist || 0)
        totalDurationSec = Number.isFinite(Number(metrics?.durationSec)) ? Number(metrics.durationSec) : null
      } catch {
        for (let i = 0; i < points.length - 1; i++) totalDist += distanceKm(points[i], points[i + 1])
      }

      const distRounded = Math.round(totalDist * 10) / 10
      setLastDistanceKm(distRounded)
      const durationMin = Number.isFinite(totalDurationSec)
        ? Math.max(1, Math.round(totalDurationSec / 60))
        : Math.max(3, Math.round((totalDist / 22) * 60))
      setLastDurationMin(durationMin)

      if (totalDist > 80) {
        setFareError(t(lang, 'tripTooFar'))
        return
      }

      const baseFare = 2.5
      const perKm = 1.5
      const rawFare = baseFare + perKm * totalDist

      const estYellow = +(rawFare * 1.0).toFixed(2)
      const estGreen = +(rawFare * 0.9).toFixed(2)
      const estFhv = +(rawFare * 1.3).toFixed(2)

      setFareOptions([
        { type: 'YELLOW', label: t(lang, 'carTypeYellow'), price: estYellow, etaMin: Math.max(2, durationMin - 1), note: '標準計程車' },
        { type: 'GREEN', label: t(lang, 'carTypeGreen'), price: estGreen, etaMin: durationMin, note: '推薦省預算' },
        { type: 'FHV', label: t(lang, 'carTypeFhv'), price: estFhv, etaMin: Math.max(2, durationMin - 2), note: '舒適優先' },
      ])
    } catch (e) {
      console.error(e)
      setFareError(t(lang, 'networkError'))
    }
  }

  const handleChooseFare = async option => {
    if (composerLocked) return

    if (!fareOptions || lastDistanceKm == null) {
      alert(t(lang, 'needPriceFirst'))
      return
    }
    if (!pickupLoc || !dropoffLoc) {
      alert(t(lang, 'needCoordsPrepared'))
      return
    }
    if (!currentUser || currentUser.role !== 'passenger') {
      onOpenAuth?.('rider', 'passenger')
      return
    }

    setSelectedVehicle(option.type)

    await createOrder(
      pickupText.trim(),
      dropoffText.trim(),
      pickupLoc,
      dropoffLoc,
      { distanceKm: lastDistanceKm, vehicleType: option.type, price: option.price, estimatedDurationMin: option.etaMin ?? lastDurationMin },
      resolvedStops
    )

    await refresh?.()

    setComposerLocked(true)
    setComposeMode(false)
    userManuallySelectedOrder.current = false
    setSelectedOrderId(null)

    resetComposerInputs()
  }

  const handleOrderArrived = orderId => {
    showToast(t(lang, 'driverArrivedPickupToast'), 2500)
    }

    const handleOrderCompletedLocal = (orderId, lastPos = null) => {
    setCompletedOrderIds(prev => {
        const next = new Set(prev)
        next.add(orderId)
        return next
    })
    showToast(t(lang, 'orderCompletedThanksToast'), 3500)
    onOrderCompleted?.(orderId, lastPos)
    }

const ordersForMap = useMemo(() => {
  if (!composeMode) {
    const activeBase = selectedOrder || syncedActivePassengerOrder

    if (
      activeBase &&
      !completedOrderIds.has(activeBase.id) &&
      !isCompletedStatus(activeBase.status)
    ) {
      return [activeBase]
    }

    return []
  }

  if (pickupLoc && dropoffLoc) {
    return [{
      id: 'preview-draft-id',
      pickupLat: pickupLoc.lat,
      pickupLng: pickupLoc.lng,
      dropoffLat: dropoffLoc.lat,
      dropoffLng: dropoffLoc.lng,
      stops: resolvedStops.length > 0 ? resolvedStops : previewStopsResolved,
      status: 'pending',
    }]
  }

  return []
}, [
  composeMode,
  selectedOrder,
  syncedActivePassengerOrder,
  completedOrderIds,
  pickupLoc,
  dropoffLoc,
  resolvedStops,
  previewStopsResolved,
])

  const startNextOrder = () => {
    setComposerLocked(false)
    setComposeMode(true)

    userManuallySelectedOrder.current = true
    setSelectedOrderId(null)

    resetComposerInputs()
  }

  // ✅ [修正重點] 核心邏輯：嚴格過濾司機
  // 1. 只有當前「顯示在畫面上」的訂單（ordersForMap）所對應的司機才顯示
  // 2. 或是與當前使用者相關且「非已完成狀態」的司機才顯示
  const visibleDrivers = useMemo(() => {
    if (!currentUser || !drivers || !drivers.length) return []

    // 取得當前畫面上正在活躍的所有訂單 ID (包含預覽單除外)
    const activeOnMapIds = new Set(ordersForMap.map(o => o.id));

    return drivers.filter(d => {
      // 找出這個司機目前正在服務的訂單
      const serviceOrder = orders.find(o => {
          const isMatched = (String(o.driverId) === String(d.id) || String(o.assignedDriverId) === String(d.id));
          const isMine = o.customer === currentUser.username;
          const isNotCompleted = !completedOrderIds.has(o.id);
          const isActiveOnMap = activeOnMapIds.has(o.id);
          
          // 狀態過濾：必須是進行中的狀態
          const s = String(o.status || '').toLowerCase();
          const isActiveStatus = ['assigned', 'accepted', 'en_route', 'enroute', 'picked_up', 'in_progress', 'on_trip', 'ongoing'].includes(s);

          return isMatched && isMine && isNotCompleted && isActiveStatus && isActiveOnMap;
      });

      return !!serviceOrder;
    });
  }, [drivers, orders, currentUser, completedOrderIds, ordersForMap])

  const plannerSteps = useMemo(() => {
    const stopDone = stops.length === 0 || stops.every(s => !String(s?.text || '').trim() || s?.loc)
    return [
      { label: '上車點', done: Boolean(pickupLoc), active: !pickupLoc },
      { label: '路線', done: Boolean(pickupLoc && dropoffLoc && (previewWaypoints || lastDistanceKm != null)), active: Boolean(pickupLoc && !dropoffLoc) },
      { label: '目的地', done: Boolean(dropoffLoc), active: Boolean(pickupLoc && !dropoffLoc) },
      { label: '車型', done: Boolean(fareOptions), active: Boolean(pickupLoc && dropoffLoc && !fareOptions) },
      { label: '派遣', done: composerLocked || Boolean(syncedActivePassengerOrder), active: Boolean(fareOptions && !composerLocked) },
    ].map(x => ({ ...x, done: x.label === '路線' ? x.done && stopDone : x.done }))
  }, [pickupLoc, dropoffLoc, stops, previewWaypoints, lastDistanceKm, fareOptions, composerLocked, syncedActivePassengerOrder])

  const plannerDoneCount = plannerSteps.filter(s => s.done).length
  const plannerProgressPct = Math.round((plannerDoneCount / plannerSteps.length) * 100)
  const routeReady = Boolean(pickupLoc && dropoffLoc)
  const planStatusLabel = composerLocked || syncedActivePassengerOrder
    ? '派遣追蹤中'
    : routeReady
    ? '路線已就緒'
    : '規劃模式'
  const planHint = composerLocked || syncedActivePassengerOrder
    ? '已建立訂單，等待司機接單或追蹤行程位置。'
    : routeReady
    ? '地圖已顯示預覽路線，下一步可查看價格並選擇車型。'
    : '先輸入或在地圖上點選上車點與目的地。'
  const planDistanceText = lastDistanceKm != null ? `${lastDistanceKm} km` : routeReady ? '計算中' : '--'
  const planDurationText = lastDurationMin != null ? `${lastDurationMin} min` : routeReady ? '預估中' : '--'
  const planDataText = modelData?.training_rows
    ? `${Number(modelData.training_rows).toLocaleString()} 筆訓練資料`
    : 'AI 模型待連線'

  async function applyPresetPlan(preset) {
    if (!preset) return
    const pickupSnap = await snapRoad(preset.pickupLoc.lat, preset.pickupLoc.lng)
    const dropoffSnap = await snapRoad(preset.dropoffLoc.lat, preset.dropoffLoc.lng)
    if (!pickupSnap.ok || !dropoffSnap.ok) {
      showToast(ROAD_SNAP_FAIL_MESSAGE, 2600)
      return
    }

    setComposerLocked(false)
    setComposeMode(true)
    setPickupText(preset.pickup)
    setPickupLoc({ lat: pickupSnap.lat, lng: pickupSnap.lng })
    setPickupLocked(true)
    setPickupDirty(false)
    setPickupSuggestions([])
    setDropoffText(preset.dropoff)
    setDropoffLoc({ lat: dropoffSnap.lat, lng: dropoffSnap.lng })
    setDropoffLocked(true)
    setDropoffDirty(false)
    setDropoffSuggestions([])
    setStops([])
    resetFarePanel()
    showToast(`已套用示範路線：${preset.name}`, 1800)
  }

  return (
    <section className="map-section">
      {activeMatchModalOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', width: 'min(430px, 92vw)', background: '#fff', color: '#111', borderRadius: 14, padding: '22px 22px 18px', boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
            <button type="button" onClick={closeMatchModal} style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, border: 'none', borderRadius: 6, background: '#111', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>X</button>
            <h3 style={{ margin: '0 40px 12px 0', fontSize: 20 }}>已為您匹配司機 請稍後...</h3>
            <div style={{ fontSize: 14, lineHeight: 1.85 }}>
              <div><b>上車停靠點：</b>{getOrderPickupText(activeMatchModalOrder)}</div>
              <div><b>下車停靠點：</b>{getOrderDropoffText(activeMatchModalOrder)}</div>
              <div><b>司機名稱：</b>{activeMatchModalDriver?.name || activeMatchModalDriver?.username || activeMatchModalOrder?.driverName || '司機資料確認中'}</div>
              <div><b>金額：</b>{getOrderPriceText(activeMatchModalOrder)}</div>
            </div>
          </div>
        </div>
      )}
      <div className="map-wrapper">
        <div style={{ width: '100%', height: '100%' }}>
          <MapView
            key="rider-map"
            lang={lang}
            drivers={visibleDrivers}
            orders={ordersForMap}
            mode="passenger"
            currentDriverId={null}
            simulateVehicles={simulateVehicles}
            completedOrderIds={completedOrderIds}
            onOrderArrived={handleOrderArrived}
            onOrderCompleted={handleOrderCompletedLocal}
            previewEnabled={shouldShowPreview}
            previewWaypoints={previewWaypoints}
            previewMarkers={previewMarkers}
            onCarPosChange={handlePassengerCarPosChange}
            followActiveCar={true}
            rotateMapWithHeading={true} 
          />
        </div>
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
          <h1 className="panel-title">{t(lang, 'passengerMode')}</h1>

          <div className="planner-card">
            <div className="planner-card__top">
              <div>
                <div className="planner-card__eyebrow">SmartDispatch Planning</div>
                <div className="planner-card__title">{planStatusLabel}</div>
              </div>
              <div className="planner-card__score">{plannerProgressPct}%</div>
            </div>

            <div className="planner-progress" aria-label="規劃流程">
              {plannerSteps.map(step => (
                <div
                  key={step.label}
                  className={[
                    'planner-step',
                    step.done ? 'is-done' : '',
                    step.active ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="planner-step__dot" />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>

            <div className="planner-metrics">
              <div>
                <strong>{planDistanceText}</strong>
                <span>路線距離</span>
              </div>
              <div>
                <strong>{planDurationText}</strong>
                <span>預估時間</span>
              </div>
              <div>
                <strong>{planDataText}</strong>
                <span>模型資料</span>
              </div>
            </div>

            <div className="planner-hint">{planHint}</div>
          </div>

          {!composerLocked && (
            <div className="quick-plan-row" aria-label="示範路線">
              {QUICK_PLANS.map(preset => (
                <button
                  key={preset.name}
                  type="button"
                  className="quick-plan-btn"
                  onClick={() => applyPresetPlan(preset)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}

          {toast && (
            <div className="auth-hint" style={{ marginTop: 8, color: '#00e676', fontWeight: 700 }}>
              {toast}
            </div>
          )}

          <div className="field-label">{t(lang, 'currentPassengerLabel')}</div>
          <div className="current-driver-box">
            {currentUser?.username ? (
              currentUser.username
            ) : (
              <button type="button" className="ghost-btn" onClick={() => onOpenAuth?.('rider', 'passenger')}>
                {t(lang, 'pleaseLoginFirst')}
              </button>
            )}
          </div>

          {composerLocked ? (
            <button type="button" className="primary-btn" style={{ marginTop: 18, width: '100%' }} onClick={startNextOrder}>
                {t(lang, 'addAnotherOrder')}
            </button>
          ) : (
            <>
              <div className="field-label" style={{ marginTop: 24 }}>
                {t(lang, 'pickupPlaceholder')}
              </div>

              <div className="autocomplete-wrapper">
                <div className="location-input-row">
                  <input
                    className="text-input"
                    type="text"
                    placeholder={t(lang, 'pickupPlaceholder')}
                    value={pickupText}
                    onFocus={() => setPickupSuggestions([{ label: '在地圖上選擇上車點', _map: true }])}
                    onChange={e => {
                      setComposeMode(true)
                      setPickupText(e.target.value)
                      setPickupLoc(null)
                      setPickupLocked(false)
                      setPickupDirty(true)
                      setPickupSuggestions([])
                      resetFarePanel()
                    }}
                    onBlur={() => setTimeout(() => setPickupSuggestions([]), 200)}
                  />
                  <button
                    type="button"
                    className="relocate-btn"
                    onMouseDown={e => e.preventDefault()}
                    onClick={clearPickupPoint}
                  >
                    重新定位
                  </button>
                </div>
                {pickupSuggestions.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {pickupSuggestions.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={item._map ? 'autocomplete-item map-option-item' : 'autocomplete-item'}
                        onMouseDown={e => {
                          e.preventDefault()
                          setComposeMode(true)
                          if (item._map) setMapPicker({ type: 'pickup', title: '選擇上車地點', initialPoint: pickupLoc })
                          else handleSelectPickup(item)
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {stops.map((stop, index) => (
                <div key={index} style={{ marginTop: 12 }}>
                  <div className="field-label">{t(lang, 'stopLabel')} {index + 1}</div>
                  <div className="autocomplete-wrapper">
                    <div className="location-input-row"><input className="text-input" type="text" placeholder={t(lang, 'stopPlaceholder')} value={stop.text} onFocus={() => setStops(prev => { const copy = [...prev]; if (!copy[index]) return prev; copy[index] = { ...copy[index], suggestions: [{ label: '在地圖上選擇停靠點', _map: true }] }; return copy })} onChange={e => { setComposeMode(true); updateStopText(index, e.target.value) }} onBlur={() => setTimeout(() => { setStops(prev => { const copy = [...prev]; if (!copy[index]) return prev; copy[index] = { ...copy[index], suggestions: [] }; return copy }) }, 200)} /><button type="button" className="relocate-btn" onMouseDown={e => e.preventDefault()} onClick={() => clearStopPoint(index)}>重新定位</button></div>
                    {stop.suggestions && stop.suggestions.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {stop.suggestions.map((item, sIdx) => (
                          <button
                            key={sIdx}
                            type="button"
                            className={item._map ? 'autocomplete-item map-option-item' : 'autocomplete-item'}
                            onMouseDown={e => {
                              e.preventDefault()
                              setComposeMode(true)
                              if (item._map) setMapPicker({ type: 'stop', index, title: `選擇中途停靠 ${index + 1}`, initialPoint: stop.loc })
                              else handleSelectStopSuggestion(index, item)
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className="ghost-btn" style={{ marginTop: 4 }} onClick={() => removeStop(index)}>{t(lang, 'removeStop')}</button>
                </div>
              ))}

              <button type="button" className="ghost-btn" style={{ marginTop: 12 }} onClick={addStop}>{t(lang, 'addStop')}</button>

              <div className="field-label" style={{ marginTop: 16 }}>{t(lang, 'dropoffPlaceholder')}</div>
              <div className="autocomplete-wrapper">
                <div className="location-input-row"><input className="text-input" type="text" placeholder={t(lang, 'dropoffPlaceholder')} value={dropoffText} onFocus={() => setDropoffSuggestions([{ label: '在地圖上選擇目的地', _map: true }])} onChange={e => { setComposeMode(true); setDropoffText(e.target.value); setDropoffLoc(null); setDropoffLocked(false); setDropoffDirty(true); setDropoffSuggestions([]); resetFarePanel() }} onBlur={() => setTimeout(() => setDropoffSuggestions([]), 200)} /><button type="button" className="relocate-btn" onMouseDown={e => e.preventDefault()} onClick={clearDropoffPoint}>重新定位</button></div>
                {dropoffSuggestions.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {dropoffSuggestions.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={item._map ? 'autocomplete-item map-option-item' : 'autocomplete-item'}
                        onMouseDown={e => {
                          e.preventDefault()
                          setComposeMode(true)
                          if (item._map) setMapPicker({ type: 'dropoff', title: '選擇目的地', initialPoint: dropoffLoc })
                          else handleSelectDropoff(item)
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button type="button" className="primary-btn" style={{ marginTop: 24, width: '100%' }} onClick={handleCheckPrice} disabled={loading}>{t(lang, 'viewPriceAndCars')}</button>

              {fareError && <div className="error-box" style={{ marginTop: 16 }}>{fareError}</div>}

              {fareOptions && !fareError && (
                <div className="fare-panel" style={{ marginTop: 16 }}>
                  {lastDistanceKm != null && <div className="field-label" style={{ marginBottom: 8 }}>{t(lang, 'estimatedDistancePrefix')} {lastDistanceKm} {t(lang, 'distanceKmUnit')}</div>}
                  <ul className="fare-list">
                    {fareOptions.map(opt => (
                      <li key={opt.type} className="fare-item">
                        <button type="button" className={selectedVehicle === opt.type ? 'fare-item-btn selected' : 'fare-item-btn'} onClick={() => handleChooseFare(opt)} disabled={loading}>
                          <span className="fare-main">
                            <strong>{opt.label}</strong>
                            <em>{opt.note} · 約 {opt.etaMin} 分鐘</em>
                          </span>
                          <span className="fare-price">≈ ${opt.price.toFixed(2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <section className="orders-block" style={{ marginTop: 32 }}>
            <div className="orders-header">
              <h3>{t(lang, 'ordersTitlePassenger')}</h3>
              <button className="ghost-btn" type="button" onClick={refresh} disabled={loading}>{t(lang, 'refresh')}</button>
            </div>

            <OrderList
              lang={lang}
              orders={displayOrders}
              drivers={drivers}
              isDriverView={false}
              selectedOrderId={selectedOrderId}
              completedOrderIds={completedOrderIds}
              onSelectOrder={orderId => {
                userManuallySelectedOrder.current = true
                setSelectedOrderId(orderId)
                setComposeMode(false)
                setComposerLocked(true)
              }}
            />

            {loading && <div className="auth-hint" style={{ marginTop: 8 }}>{t(lang, 'loading')}</div>}
            {error && <div className="error-box">{error}</div>}
          </section>
        </div>
      </aside>

      <MapLocationPicker
        open={Boolean(mapPicker)}
        title={mapPicker?.title || '選擇位置'}
        initialPoint={mapPicker?.initialPoint || null}
        onCancel={() => setMapPicker(null)}
        onClear={() => {
          if (mapPicker?.type === 'pickup') clearPickupPoint()
          else if (mapPicker?.type === 'dropoff') clearDropoffPoint()
          else if (mapPicker?.type === 'stop') clearStopPoint(mapPicker.index)
        }}
        onConfirm={applyMapPickedLocation}
      />
    </section>
  )
}
