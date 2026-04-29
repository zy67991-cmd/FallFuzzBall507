import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiFetch } from './apiBase.js'

const DEFAULT_CENTER = [40.7271, -73.9293]
const DEFAULT_ZOOM = 11
const HOTSPOT_MOVE_TASK_KEY = 'hotspotMoveTaskV1'
const HOTSPOT_MOVE_EVT = 'hotspotMoveTaskChanged'
const DRIVER_LIVE_STATE_PREFIX = 'driverLiveState:'
const DRIVER_POS_EVT = 'driverPositionChanged'
const HOTSPOT_TOP_COLORS = [
  '#00a86b',
  '#111111',
  '#6f6f6f',
]

function hotspotMoveTaskKey(driverId) {
  return `${HOTSPOT_MOVE_TASK_KEY}:${driverId ?? 'na'}`
}

const ACTIVE_STATUS_SET = new Set([
  'assigned',
  'accepted',
  'en_route',
  'enroute',
  'picked_up',
  'in_progress',
  'on_trip',
  'ongoing',
])

function sameId(a, b) {
  const A = Number(a)
  const B = Number(b)
  return Number.isFinite(A) && Number.isFinite(B) && A === B
}

function getOrderDriverId(order) {
  return order?.driverId ?? order?.assignedDriverId ?? order?.driver_id ?? null
}

function isActiveStatus(status) {
  return ACTIVE_STATUS_SET.has(String(status || '').toLowerCase())
}

function readHotspotMoveTask(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(hotspotMoveTaskKey(driverId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function emitHotspotMoveTaskChanged(task, driverId = null) {
  try {
    window.dispatchEvent(
      new CustomEvent(HOTSPOT_MOVE_EVT, {
        detail: { task, driverId: driverId ?? task?.driverId ?? null },
      })
    )
  } catch {}
}

function writeHotspotMoveTask(task) {
  try {
    if (!task?.driverId) return
    localStorage.setItem(hotspotMoveTaskKey(task.driverId), JSON.stringify(task))
  } catch {}
  emitHotspotMoveTaskChanged(task, task?.driverId)
}

function clearHotspotMoveTask(driverId) {
  try {
    if (driverId == null) return
    localStorage.removeItem(hotspotMoveTaskKey(driverId))
  } catch {}
  emitHotspotMoveTaskChanged(null, driverId)
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

    return {
      lat,
      lng,
      heading: Number.isFinite(heading) ? heading : 0,
      speedKph: Number.isFinite(speedKph) ? speedKph : 0,
    }
  } catch {
    return null
  }
}

function readPersistedDriverLoc(driverId) {
  try {
    if (driverId == null) return null
    const raw = localStorage.getItem(`driverLoc:${driverId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const lat = Number(parsed?.lat)
    const lng = Number(parsed?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng, heading: 0, speedKph: 0 }
  } catch {
    return null
  }
}

function makeTaxiIcon() {
  const svg = `
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 8C12 5.79086 13.7909 4 16 4H28C30.2091 4 32 5.79086 32 8V36C32 38.2091 30.2091 40 28 40H16C13.7909 40 12 38.2091 12 36V8Z" fill="black" fillOpacity="0.3" transform="translate(2, 2)"/>
      <path d="M12 8C12 5.79086 13.7909 4 16 4H28C30.2091 4 32 5.79086 32 8V36C32 38.2091 30.2091 40 28 40H16C13.7909 40 12 38.2091 12 36V8Z" fill="#F4C430" stroke="#E6B800" strokeWidth="1"/>
      <path d="M14 10H30V16H14V10Z" fill="#333"/>
      <path d="M14 30H30V34H14V30Z" fill="#333"/>
      <rect x="18" y="20" width="8" height="4" rx="1" fill="#FFD700" stroke="#D4AF37" strokeWidth="0.5"/>
      <path d="M13 5H15V6H13V5Z" fill="#FFF" />
      <path d="M29 5H31V6H29V5Z" fill="#FFF" />
      <path d="M13 38H15V39H13V38Z" fill="#F00" />
      <path d="M29 38H31V39H29V38Z" fill="#F00" />
    </svg>
  `
  const html = `
    <div
      class="taxi-icon-root"
      style="
        width:44px;
        height:44px;
        display:flex;
        align-items:center;
        justify-content:center;
        transform-origin:22px 22px;
        transform: rotate(var(--rot, 0deg));
        will-change: transform;
      "
    >
      ${svg}
    </div>
  `
  return L.divIcon({
    className: '',
    html,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

const taxiIcon = makeTaxiIcon()

function quantile(sortedArr, q) {
  if (!sortedArr.length) return 0
  const pos = (sortedArr.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
  }
  return sortedArr[base]
}

function isAirportZone(z) {
  const name = String(z?.Zone || '').toLowerCase()
  return (
    name.includes('airport') ||
    name.includes('jfk') ||
    name.includes('laguardia')
  )
}

function visualScore(z) {
  const backendScore = Number(z?.hotspot_score)
  if (Number.isFinite(backendScore)) return backendScore
  return Number(z?.pred_rides || 0) * (1 + Number(z?.priority || 0))
}

function buildVisualBreaks(zones) {
  const vals = (zones || [])
    .filter((z) => !isAirportZone(z))
    .map((z) => visualScore(z))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  if (!vals.length) {
    return { breaks: [0, 0, 0, 0], cap95: 0 }
  }

  return {
    breaks: [
      quantile(vals, 0.30),
      quantile(vals, 0.65),
      quantile(vals, 0.85),
      quantile(vals, 0.95),
    ],
    cap95: quantile(vals, 0.95),
  }
}

function colorByVisualScore(z, breaks, cap95) {
  if (isAirportZone(z)) return '#00c853'

  const s = Math.min(visualScore(z), cap95)

  if (s >= breaks[3]) return '#d50000'
  if (s >= breaks[2]) return '#ff6d00'
  if (s >= breaks[1]) return '#ffd600'
  if (s >= breaks[0]) return '#00c853'
  return '#00b0ff'
}

async function getRoute(fromLat, fromLon, toLat, toLon) {
  try {
    const res = await apiFetch('/api/route', {
      query: {
        fromLat,
        fromLng: fromLon,
        toLat,
        toLng: toLon,
      },
      timeoutMs: 120000,
      dedupe: false,
    })

    if (!res.ok) {
      throw new Error(`route ${res.status}`)
    }

    const data = await res.json()
    return {
      coords: Array.isArray(data.coords) ? data.coords : [],
      dist: Number.isFinite(Number(data.dist)) ? Number(data.dist) : null,
    }
  } catch (e) {
    console.error('getRoute failed', e)
    return { coords: [], dist: null }
  }
}


function FitRoutes({ routes }) {
  const map = useMap()

  useEffect(() => {
    if (!routes || !routes.length) return
    const all = routes.flat().filter(Boolean)
    if (all.length < 2) return
    map.fitBounds(L.latLngBounds(all), { padding: [30, 30] })
  }, [map, routes])

  return null
}

function SyncedDriverMarker({ driverState }) {
  const markerRef = useRef(null)

  useEffect(() => {
    const m = markerRef.current
    const el = m?.getElement?.()
    if (!el) return
    const rot = Number(driverState?.heading ?? 0)
    el.style.setProperty('--rot', `${rot}deg`)
  }, [driverState])

  if (!driverState) return null

  return (
    <Marker
      ref={markerRef}
      position={[Number(driverState.lat), Number(driverState.lng)]}
      icon={taxiIcon}
    />
  )
}


export default function DriverPage({
  onBack,
  zones = [],
  zonesLoading = false,
  zonesError = '',
  driverId = null,
  drivers = [],
  orders = [],
}) {
    
  const [driverPos, setDriverPos] = useState(null)
  const [top3, setTop3] = useState([])
  const [routes3, setRoutes3] = useState([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [moveTask, setMoveTask] = useState(null)
  const [confirmMoveTarget, setConfirmMoveTarget] = useState(null)
  const lastRecommendKeyRef = useRef('')

  const visualMeta = useMemo(() => buildVisualBreaks(zones), [zones])

    const myDriver = useMemo(() => {
    if (driverId != null) {
      const byId = drivers.find(d => sameId(d?.id, driverId))
      if (byId) return byId
    }
    return null
  }, [drivers, driverId])

  const myActiveOrder = useMemo(() => {
    if (driverId == null) return null
    return (orders || []).find(
      o => sameId(getOrderDriverId(o), driverId) && isActiveStatus(o?.status)
    ) || null
  }, [orders, driverId])

  const isHotspotMoveActive = Boolean(
    moveTask &&
    moveTask.driverId != null &&
    sameId(moveTask.driverId, driverId) &&
    moveTask.status === 'moving'
  )

  const isDriverBusyMoving = Boolean(myActiveOrder) || isHotspotMoveActive

    const fetchRecommendations = useCallback(async (lat, lon) => {
    setLoading(true)
    setErrorMsg('')

    try {
      const res = await apiFetch('/api/dispatch-recommendations', {
        query: { lat, lng: lon, top_k: 3 },
        timeoutMs: 60000,
        dedupe: false,
      })
      if (!res.ok) throw new Error(`dispatch-recommendations ${res.status}`)

      const data = await res.json()
      const rows = Array.isArray(data.rows) ? data.rows : []

      const routePromises = rows.map(async (r, i) => {
        const targetLat = Number(r.lat_wgs)
        const targetLon = Number(r.lon_wgs)

        const rt = await getRoute(lat, lon, targetLat, targetLon)
        const coords =
          rt.coords && rt.coords.length
            ? rt.coords
            : [
                [lat, lon],
                [targetLat, targetLon],
              ]

        return {
          ...r,
          idx: i,
          lat_wgs: targetLat,
          lon_wgs: targetLon,
          pred_rides: Number(r.pred_rides ?? 0),
          priority: Number(r.priority ?? 0),
          distance_km: Number(r.distance_km ?? 0),
          zone_supply: Number(r.zone_supply ?? 0),
          local_supply: Number(r.local_supply ?? 0),
          score: Number(r.score ?? 0),
          hotspot_score: Number(r.hotspot_score ?? 0),
          gain: Number(r.gain ?? 0),
          move_recommended: Boolean(r.move_recommended),
          coords,
          road_km: rt.dist != null ? rt.dist : Number(r.road_km ?? r.distance_km ?? 0),
        }
      })

      const routeResult = await Promise.all(routePromises)
      routeResult.sort((a, b) => a.idx - b.idx)

      setTop3(routeResult)
      setRoutes3(routeResult.map(x => x.coords))
    } catch (e) {
      console.error('recommendation failed', e)
      setErrorMsg('推薦結果取得失敗')
      setTop3([])
      setRoutes3([])
    } finally {
      setLoading(false)
    }
  }, [])

  function startHotspotMove(target) {
    if (!driverId || !driverPos || !target?.coords || target.coords.length < 2) return
    setConfirmMoveTarget(null)

    const task = {
      taskId: Date.now(),
      driverId: Number(driverId),
      status: 'moving',
      start: {
        lat: Number(driverPos.lat),
        lng: Number(driverPos.lng),
      },
      end: {
        lat: Number(target.lat_wgs),
        lng: Number(target.lon_wgs),
        zoneId: Number(target.zone_id),
        zoneName: String(target.Zone || ''),
      },
      coords: target.coords.map(p => [Number(p[0]), Number(p[1])]),
      rankIdx: Number(target.rankIdx ?? target.idx ?? 0),
      createdAt: new Date().toISOString(),
    }

    writeHotspotMoveTask(task)
    setMoveTask(task)

    setTop3([])
    setRoutes3([])
    setErrorMsg('')
  }

  useEffect(() => {
    if (driverId == null) {
      setMoveTask(null)
      return
    }

    const syncTask = (e) => {
      const eventDriverId = e?.detail?.driverId
      if (eventDriverId != null && !sameId(eventDriverId, driverId)) return
      setMoveTask(readHotspotMoveTask(driverId))
    }

    setMoveTask(readHotspotMoveTask(driverId))

    window.addEventListener(HOTSPOT_MOVE_EVT, syncTask)
    return () => window.removeEventListener(HOTSPOT_MOVE_EVT, syncTask)
  }, [driverId])

  const syncDriverPosNow = useCallback(() => {
    if (driverId == null) return

    const live = readDriverLiveState(driverId)
    const persisted = readPersistedDriverLoc(driverId)
    const backend =
      myDriver &&
      Number.isFinite(Number(myDriver.lat)) &&
      Number.isFinite(Number(myDriver.lng))
        ? { lat: Number(myDriver.lat), lng: Number(myDriver.lng), heading: 0, speedKph: 0 }
        : null

    const nextPos = isDriverBusyMoving
      ? (live || backend || persisted || null)
      : (backend || live || persisted || null)

    setDriverPos(nextPos)
  }, [driverId, myDriver, isDriverBusyMoving])

  useEffect(() => {
    syncDriverPosNow()

    const timer = setInterval(syncDriverPosNow, 120)

    const onDriverPos = e => {
      const eventDriverId = e?.detail?.driverId
      const pos = e?.detail?.pos

      if (eventDriverId != null && !sameId(eventDriverId, driverId)) return

      if (
        pos &&
        Number.isFinite(Number(pos.lat)) &&
        Number.isFinite(Number(pos.lng))
      ) {
        setDriverPos({
          lat: Number(pos.lat),
          lng: Number(pos.lng),
          heading: Number(pos.heading ?? 0),
          speedKph: Number(pos.speedKph ?? 0),
        })
        return
      }

      syncDriverPosNow()
    }

    window.addEventListener(DRIVER_POS_EVT, onDriverPos)

    return () => {
      clearInterval(timer)
      window.removeEventListener(DRIVER_POS_EVT, onDriverPos)
    }
  }, [driverId, syncDriverPosNow])
  
  useEffect(() => {
    if (!driverPos) return
    if (isDriverBusyMoving) return
    if (driverId == null) return

    const key = `${Number(driverId)}:${driverPos.lat.toFixed(6)}:${driverPos.lng.toFixed(6)}`
    if (lastRecommendKeyRef.current === key) return

    lastRecommendKeyRef.current = key
    fetchRecommendations(Number(driverPos.lat), Number(driverPos.lng))
  }, [driverPos, driverId, isDriverBusyMoving, fetchRecommendations])


  function playToZone(coords) {
    if (!coords || coords.length < 2) return
    setPlayRoute(coords)
    setPlayingKey(String(Date.now()))
  }

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      {confirmMoveTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', width: 'min(420px, 92vw)', background: '#fff', color: '#111', borderRadius: 14, padding: '22px 22px 18px', boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
            <button type="button" onClick={() => setConfirmMoveTarget(null)} style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, border: 'none', borderRadius: 6, background: '#111', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>X</button>
            <h3 style={{ margin: '0 40px 14px 0', fontSize: 20 }}>確認移動</h3>
            <div style={{ fontSize: 15, lineHeight: 1.8 }}>
              <div><b>熱點點位名稱：</b>{confirmMoveTarget.Zone || '未命名熱點'}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" onClick={() => startHotspotMove(confirmMoveTarget)} style={{ border: 'none', borderRadius: 8, background: '#111', color: '#fff', padding: '10px 18px', fontWeight: 800, cursor: 'pointer' }}>確認移動</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ flex: 2, position: 'relative' }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {zones.map((z, i) => {
            const color = colorByVisualScore(z, visualMeta.breaks, visualMeta.cap95)
            return (
              <CircleMarker
                key={`${z.PULocationID}-${i}`}
                center={[z.lat, z.lon]}
                radius={9}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.3,
                  weight: 2,
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>{z.Zone}</strong>
                    <br />
                    ID: {z.PULocationID}
                    <br />
                    預測需求: {Number(z.pred_rides).toFixed(2)}
                    <br />
                    區域優先度: {Number(z.priority).toFixed(3)}
                    <br />
                    熱點分數: {Number(visualScore(z)).toFixed(2)}
                  </div>
                </Tooltip>
              </CircleMarker>
            )
          })}

          <SyncedDriverMarker driverState={driverPos} />

                    {isHotspotMoveActive && Array.isArray(moveTask?.coords) && moveTask.coords.length >= 2 ? (
            <Polyline
              positions={moveTask.coords}
              pathOptions={{
                color: HOTSPOT_TOP_COLORS[Number(moveTask?.rankIdx ?? 0)] || HOTSPOT_TOP_COLORS[0],
                weight: 9,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          ) : (
            routes3.map((coords, idx) => {
              if (!coords || coords.length < 2) return null
              const colors = HOTSPOT_TOP_COLORS
              return (
                <Polyline
                  key={`r3-${idx}`}
                  positions={coords}
                  pathOptions={{
                    color: colors[idx] || '#1B5E20',
                    weight: 9,
                    opacity: 1,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              )
            })
          )}


          <FitRoutes routes={isHotspotMoveActive && moveTask?.coords ? [moveTask.coords] : routes3} />
          </MapContainer>

        {onBack && (
          <button
            onClick={onBack}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              zIndex: 1000,
              padding: '10px 20px',
              background: '#333',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            返回行進頁面
          </button>
        )}
      </div>

      <div
        style={{
          flex: 1,
          borderLeft: '1px solid #ccc',
          padding: 20,
          overflowY: 'auto',
          background: '#fff',
        }}
      >
        <h2 style={{ marginTop: 0, color: '#111', fontSize: 24, fontWeight: 900 }}>
          AI 熱點建議
        </h2>

        <p style={{ fontSize: 13, color: 'rgba(0,0,0,.62)', lineHeight: 1.6, marginBottom: 12 }}>
          系統會依照預測需求、距離、區域供給與附近空車數，推薦司機下一個最值得前往的區域。
        </p>

        <div
          style={{
            background: '#f3f3f3',
            border: '1px solid rgba(0,0,0,.08)',
            borderRadius: 8,
            padding: '12px',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#111',
            marginBottom: 14,
          }}
        >
          <b>推薦邏輯：</b>需求越高越優先，距離越近越優先，附近空車越少越優先。
        </div>

        <h3 style={{ fontSize: 14, marginTop: 16, color: 'rgba(0,0,0,.64)', fontWeight: 900 }}>
          目前位置
          {driverPos ? (
            <span style={{ color: '#111', fontSize: 14, marginLeft: 10, fontWeight: 800 }}>
              {driverPos.lat.toFixed(4)}, {driverPos.lng.toFixed(4)}
            </span>
          ) : (
            <span style={{ color: '#c62828', fontSize: 14, marginLeft: 10 }}>
              尚未取得
            </span>
          )}
        </h3>


                {isDriverBusyMoving && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              border: '1px solid #90caf9',
              background: '#e3f2fd',
              color: '#1565c0',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            車輛移動中
          </div>
        )}

        <h3 style={{ fontSize: 16, marginTop: 14, color: '#111', fontWeight: 900 }}>
          {isDriverBusyMoving ? '推薦暫停中' : '最佳前往區域'}
        </h3>

                {zonesLoading && (
          <div style={{ padding: 12, color: '#111' }}>熱點資料載入中...</div>
        )}

        {!zonesLoading && zonesError && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              border: '1px solid #ef9a9a',
              background: '#ffebee',
              color: '#c62828',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {zonesError}
          </div>
        )}

        {loading && (
          <div style={{ padding: 20, textAlign: 'center' }}>計算中...</div>
        )}

        {!loading && errorMsg && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              border: '1px solid #ef9a9a',
              background: '#ffebee',
              color: '#c62828',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {top3.map((t, idx) => {
            const accent = HOTSPOT_TOP_COLORS[idx] || HOTSPOT_TOP_COLORS[0]

            return (
              <div
                key={`${t.zone_id ?? idx}-${idx}`}
                onClick={() => {
                  if (isDriverBusyMoving) return
                  setConfirmMoveTarget({ ...t, rankIdx: idx })
                }}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    border: '1px solid rgba(0,0,0,.12)',
                    cursor: isDriverBusyMoving ? 'default' : 'pointer',
                    background: '#fff',
                    boxShadow: '0 10px 26px rgba(0,0,0,0.08)',
                    borderLeft: `8px solid ${accent}`,
                    color: '#111',
                  }}
              >
<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, color: '#111' }}>
                    #{idx + 1} {t.Zone}
                  </div>
                  <div style={{ background: '#111', color: '#fff', borderRadius: 8, padding: '4px 8px', fontSize: 12, fontWeight: 900 }}>
                    {Number(t.score).toFixed(2)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px', fontSize: 13, color: '#111', lineHeight: 1.35 }}>
                  <div><b>行政區</b><br />{t.Borough}</div>
                  <div><b>距離</b><br />{Number(t.road_km).toFixed(2)} km</div>
                  <div><b>預測需求</b><br />{Number(t.pred_rides).toFixed(2)} 單/時</div>
                  <div><b>附近供給</b><br />{t.local_supply} 台</div>
                </div>

                <div style={{ marginTop: 10, fontSize: 13, color: t.move_recommended ? '#0b6b35' : '#8a5a00', fontWeight: 900 }}>
                  {t.move_recommended ? '建議前往' : '分數接近，視現場狀況前往'}
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
