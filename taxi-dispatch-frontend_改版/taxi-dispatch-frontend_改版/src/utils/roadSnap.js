import { apiFetch as defaultApiFetch } from '../apiBase.js'

export const ROAD_SNAP_MAX_DISTANCE_M = 100
export const ROAD_SNAP_FAIL_MESSAGE = '此位置離可行駛道路太遠，請點選道路附近。'
export const ROAD_SNAP_SERVICE_MESSAGE = '道路定位服務暫時無法使用，請稍後再試。'

export function roadSnapFallbackLabel(lat, lng) {
  return `地圖位置 ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`
}

export async function snapRoad(lat, lng, {
  apiFetch = defaultApiFetch,
  maxDistanceM = ROAD_SNAP_MAX_DISTANCE_M,
  signal,
} = {}) {
  const rawLat = Number(lat)
  const rawLng = Number(lng)

  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
    return {
      ok: false,
      lat: rawLat,
      lng: rawLng,
      message: ROAD_SNAP_FAIL_MESSAGE,
    }
  }

  try {
    const res = await apiFetch('/api/snap-road', {
      query: {
        lat: rawLat,
        lng: rawLng,
        max_distance_m: maxDistanceM,
      },
      timeoutMs: 10000,
      dedupe: false,
      signal,
    })
    const data = await res.json().catch(() => null)

    const snappedLat = Number(data?.snapped_lat)
    const snappedLng = Number(data?.snapped_lng)
    const distanceM = Number(data?.distance_m)
    const roadName = String(data?.road_name || '').trim()

    if (!res.ok || !data?.ok || !Number.isFinite(snappedLat) || !Number.isFinite(snappedLng)) {
      return {
        ok: false,
        lat: rawLat,
        lng: rawLng,
        snappedLat: Number.isFinite(snappedLat) ? snappedLat : null,
        snappedLng: Number.isFinite(snappedLng) ? snappedLng : null,
        distanceM: Number.isFinite(distanceM) ? distanceM : null,
        roadName,
        message: data?.message || ROAD_SNAP_FAIL_MESSAGE,
      }
    }

    return {
      ok: true,
      lat: snappedLat,
      lng: snappedLng,
      rawLat,
      rawLng,
      snappedLat,
      snappedLng,
      distanceM: Number.isFinite(distanceM) ? distanceM : 0,
      roadName,
      message: data?.message || `已自動移到最近道路：${roadName || '最近道路'}`,
    }
  } catch {
    return {
      ok: false,
      lat: rawLat,
      lng: rawLng,
      message: ROAD_SNAP_SERVICE_MESSAGE,
    }
  }
}
