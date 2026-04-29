import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { apiFetch } from '../apiBase.js'
import { ROAD_SNAP_FAIL_MESSAGE, roadSnapFallbackLabel, snapRoad } from '../utils/roadSnap.js'
import 'leaflet/dist/leaflet.css'

const NYC_CENTER = [40.758, -73.9855]
const NYC_BOUNDS = [
  [40.4774, -74.2591],
  [40.9176, -73.7004],
]

const QUICK_PLACES = [
  { label: 'Times Square', lat: 40.758, lng: -73.9855 },
  { label: 'Penn Station', lat: 40.7506, lng: -73.9935 },
  { label: 'Grand Central', lat: 40.7527, lng: -73.9772 },
  { label: 'Central Park', lat: 40.7812, lng: -73.9665 },
  { label: 'Wall Street', lat: 40.706, lng: -74.0086 },
  { label: 'JFK Airport', lat: 40.6413, lng: -73.7781 },
]

function fallbackLabel(lat, lng) {
  return roadSnapFallbackLabel(lat, lng)
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await apiFetch('/api/reverse-geocode', {
      query: { lat, lng },
      timeoutMs: 7000,
      dedupe: false,
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.label) {
      return {
        label: data.label,
        displayName: data.display_name || data.label,
        lat: Number(lat),
        lng: Number(lng),
      }
    }
  } catch {}
  return {
    label: fallbackLabel(lat, lng),
    displayName: fallbackLabel(lat, lng),
    lat: Number(lat),
    lng: Number(lng),
  }
}

function PickHandler({ onPick }) {
  const map = useMapEvents({
    click(e) {
      onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }, 'click')
    },
    moveend() {
      const c = map.getCenter()
      onPick?.({ lat: c.lat, lng: c.lng }, 'moveend')
    },
  })
  return null
}

function FlyToPoint({ point }) {
  const map = useMap()

  useEffect(() => {
    const lat = Number(point?.lat)
    const lng = Number(point?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { animate: true, duration: 0.35 })
  }, [map, point?.lat, point?.lng])

  return null
}

export default function MapLocationPicker({
  open,
  title = '選擇位置',
  initialPoint = null,
  onCancel,
  onClear,
  onConfirm,
}) {
  const [picked, setPicked] = useState(initialPoint)
  const [pickedLabel, setPickedLabel] = useState('')
  const [resolving, setResolving] = useState(false)
  const [roadReady, setRoadReady] = useState(false)
  const [roadMessage, setRoadMessage] = useState('')
  const [roadError, setRoadError] = useState('')
  const pickSeqRef = useRef(0)

  function isCloseToPicked(point) {
    if (!picked || !point) return false
    const lat = Number(point.lat)
    const lng = Number(point.lng)
    const pickedLat = Number(picked.lat)
    const pickedLng = Number(picked.lng)
    if (![lat, lng, pickedLat, pickedLng].every(Number.isFinite)) return false
    return Math.abs(lat - pickedLat) < 0.00003 && Math.abs(lng - pickedLng) < 0.00003
  }

  async function resolveRoadPoint(point, { preferredLabel = '' } = {}) {
    const rawLat = Number(point?.lat)
    const rawLng = Number(point?.lng)
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return

    const seq = pickSeqRef.current + 1
    pickSeqRef.current = seq
    setResolving(true)
    setRoadReady(false)
    setRoadMessage('')
    setRoadError('')
    setPicked({
      lat: rawLat,
      lng: rawLng,
      label: preferredLabel || fallbackLabel(rawLat, rawLng),
    })
    setPickedLabel(preferredLabel || fallbackLabel(rawLat, rawLng))

    const snapped = await snapRoad(rawLat, rawLng)
    if (seq !== pickSeqRef.current) return

    if (!snapped.ok) {
      setResolving(false)
      setRoadReady(false)
      setRoadError(snapped.message || ROAD_SNAP_FAIL_MESSAGE)
      setRoadMessage('')
      return
    }

    const roadName = snapped.roadName || '最近道路'
    const snapHint = Number(snapped.distanceM || 0) > 1
      ? `已自動移到最近道路：${roadName}`
      : ''

    const geo = await reverseGeocode(snapped.lat, snapped.lng)
    if (seq !== pickSeqRef.current) return

    const label = preferredLabel && Number(snapped.distanceM || 0) <= 1
      ? preferredLabel
      : geo.label || roadName || fallbackLabel(snapped.lat, snapped.lng)

    setPicked({
      ...geo,
      label,
      displayName: geo.displayName || label,
      lat: snapped.lat,
      lng: snapped.lng,
      rawLat,
      rawLng,
      roadName: snapped.roadName,
      snapDistanceM: snapped.distanceM,
    })
    setPickedLabel(label)
    setRoadReady(true)
    setRoadError('')
    setRoadMessage(snapHint)
    setResolving(false)
  }

  function handlePick(point, source = 'click') {
    if (source === 'moveend' && isCloseToPicked(point)) return
    resolveRoadPoint(point)
  }

  useEffect(() => {
    if (!open) return
    const start = initialPoint || { lat: NYC_CENTER[0], lng: NYC_CENTER[1] }
    resolveRoadPoint(start, { preferredLabel: initialPoint?.label || initialPoint?.text || '' })
  }, [open, initialPoint])

  const center = useMemo(() => {
    const lat = Number(initialPoint?.lat)
    const lng = Number(initialPoint?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
    return NYC_CENTER
  }, [initialPoint])

  if (!open) return null

  const hasPickedPoint = Number.isFinite(Number(picked?.lat)) && Number.isFinite(Number(picked?.lng))
  const canConfirm = hasPickedPoint && roadReady && !resolving
  const displayLabel = resolving
    ? '正在取得道路位置...'
    : pickedLabel || (hasPickedPoint ? fallbackLabel(picked.lat, picked.lng) : '尚未選擇位置')

  return (
    <div className="map-picker-backdrop" role="dialog" aria-modal="true">
      <div className="map-picker-dialog">
        <div className="map-picker-header">
          <div>
            <div className="map-picker-title">{title}</div>
            <div className="map-picker-subtitle">拖曳地圖移動中間標記，也可以點地圖或選常用地標</div>
          </div>
          <button type="button" className="map-picker-close" onClick={onCancel}>×</button>
        </div>

        <div className="map-picker-map">
          <MapContainer
            center={center}
            zoom={12}
            minZoom={10}
            maxBounds={NYC_BOUNDS}
            maxBoundsViscosity={1}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              maxZoom={18}
              maxNativeZoom={17}
            />
            <PickHandler onPick={handlePick} />
            <FlyToPoint point={picked} />
            {hasPickedPoint && (
              <Marker position={[Number(picked.lat), Number(picked.lng)]}>
                <Popup>{displayLabel}</Popup>
              </Marker>
            )}
          </MapContainer>
          <div className="map-picker-crosshair" aria-hidden="true">
            <span />
          </div>
        </div>

        <div className="map-picker-footer">
          <div className="map-picker-currentBlock">
            <div className="map-picker-currentLabel">目前選擇</div>
            <div className="map-picker-current">{displayLabel}</div>
            <div className="map-picker-quickPlaces" aria-label="常用地標">
              {QUICK_PLACES.map(place => (
                <button
                  key={place.label}
                  type="button"
                  className="map-picker-placeBtn"
                  onClick={() => resolveRoadPoint(place, { preferredLabel: place.label })}
                >
                  {place.label}
                </button>
              ))}
            </div>
          </div>
          <div className="map-picker-actions">
            <button
              type="button"
              className="ghost-btn"
              style={{ color: '#111', borderColor: '#111' }}
              onClick={() => {
                onClear?.()
                setPicked(null)
                setPickedLabel('')
                setRoadReady(false)
                setRoadMessage('')
                setRoadError('')
              }}
            >
              清除
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={!canConfirm}
              onClick={() => onConfirm?.({
                label: pickedLabel || fallbackLabel(picked.lat, picked.lng),
                displayName: picked.displayName || pickedLabel,
                lat: Number(picked.lat),
                lng: Number(picked.lng),
                roadName: picked.roadName || '',
                snapDistanceM: picked.snapDistanceM ?? 0,
              })}
            >
              確認位置
            </button>
          </div>
          {(roadError || roadMessage) && (
            <div className={`map-picker-roadStatus ${roadError ? 'is-error' : 'is-ok'}`}>
              {roadError || roadMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
