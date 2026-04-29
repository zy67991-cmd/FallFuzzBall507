// src/components/OrderList.jsx
import React, { useMemo } from 'react'
import { t } from '../i18n'

function getStr(x) {
  return typeof x === 'string' ? x : x == null ? '' : String(x)
}

function normalizeStatus(s) {
  const k = getStr(s).toLowerCase().trim()
  if (!k) return 'pending'
  if (k === 'enroute') return 'en_route'
  if (k === 'on_trip') return 'in_progress'
  return k
}

function statusTone(statusKey) {
  if (statusKey === 'completed') return 'success'
  if (statusKey === 'cancelled') return 'danger'
  if (statusKey === 'en_route') return 'warn'
  if (statusKey === 'accepted' || statusKey === 'assigned') return 'info'
  if (statusKey === 'pending') return 'muted'
  return 'muted'
}

function extractStops(o) {
  const stopsArr = Array.isArray(o?.stops)
    ? o.stops
    : Array.isArray(o?.resolvedStops)
    ? o.resolvedStops
    : Array.isArray(o?.stopovers)
    ? o.stopovers
    : []

  const stopsText = stopsArr
    .map(s => s?.label || s?.text || s?.name || '')
    .map(x => String(x).trim())
    .filter(Boolean)

  const visibleStops = stopsText.slice(0, 2)
  const moreCount = Math.max(0, stopsText.length - visibleStops.length)

  return { visibleStops, moreCount, total: stopsText.length }
}

export default function OrderList({
  lang,
  orders,
  drivers,
  isDriverView,
  currentDriverId,
  onAcceptOrder,
  selectedOrderId,
  completedOrderIds,
  onSelectOrder,
  driverBusy = false,
  activeOrderId = null,
}) {
  const driverMap = useMemo(() => {
    const m = new Map()
    ;(Array.isArray(drivers) ? drivers : []).forEach(d => {
      if (d?.id != null) m.set(d.id, d)
    })
    return m
  }, [drivers])

  const list = Array.isArray(orders) ? orders : []

  return (
    <div className="ub-orders">
      <div className="ub-orders__header">
        <div className="ub-orders__title">
          {t(lang, isDriverView ? 'ordersTitleDriver' : 'ordersTitlePassenger')}
        </div>
      </div>

      <div className="ub-orders__grid">
        {list.map(o => {
          const id = o?.id
          const isSelected = id != null && selectedOrderId === id

          const done = Boolean(completedOrderIds?.has?.(id))

          const rawStatus = normalizeStatus(o?.status)
          const statusKey = done ? 'completed' : rawStatus

          const pickup = o?.pickup ?? o?.pickupText ?? o?.pickup_label ?? '-'
          const dropoff = o?.dropoff ?? o?.dropoffText ?? o?.dropoff_label ?? '-'

          const driverId = o?.driverId ?? o?.assignedDriverId ?? o?.driver_id
          const driverName =
            driverId != null
              ? driverMap.get(driverId)?.name || driverMap.get(driverId)?.username || ''
              : ''

          const lockedByDriverBusy =
            Boolean(isDriverView) &&
            Boolean(driverBusy) &&
            id != null &&
            activeOrderId != null &&
            id !== activeOrderId &&
            statusKey === 'pending'

          const canAccept =
            Boolean(isDriverView) &&
            !done &&
            statusKey === 'pending' &&
            driverId == null &&
            typeof onAcceptOrder === 'function' &&
            !lockedByDriverBusy
                    const showRecommendBlock =
            Boolean(isDriverView) &&
            !done &&
            statusKey === 'pending' &&
            driverId == null

          const recommendScore =
            typeof o?.recommendScore === 'number' && Number.isFinite(o.recommendScore)
              ? o.recommendScore
              : typeof o?.recommendScore === 'string' && o.recommendScore.trim()
              ? o.recommendScore.trim()
              : null

          const recommendAccept =
            typeof o?.recommendAccept === 'boolean' ? o.recommendAccept : null

          const recommendLabel =
            typeof o?.recommendLabel === 'string' ? o.recommendLabel.trim() : ''

          const acceptDisabled = !currentDriverId || id == null || lockedByDriverBusy

          const onAccept = e => {
            e.preventDefault()
            e.stopPropagation()
            if (acceptDisabled) return
            onAcceptOrder(id, currentDriverId)
          }

          const tone = statusTone(statusKey)
          const { visibleStops, moreCount } = extractStops(o)

          return (
            <button
              key={id ?? Math.random()}
              type="button"
              disabled={lockedByDriverBusy}
              className={[
                'ub-orderCard',
                isSelected ? 'is-selected' : '',
                done ? 'is-done' : '',
                lockedByDriverBusy ? 'is-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                opacity: lockedByDriverBusy ? 0.42 : undefined,
                cursor: lockedByDriverBusy ? 'not-allowed' : undefined,
              }}
              onClick={() => {
                if (lockedByDriverBusy) return
                if (id != null) onSelectOrder?.(id)
              }}
            >
              <div className="ub-orderCard__top">
                <div className="ub-orderCard__chips">
                  {canAccept ? (
                    <span
                      className={`ub-chip ub-chip--action ${acceptDisabled ? 'is-disabled' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-disabled={acceptDisabled}
                      onClick={onAccept}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') onAccept(e)
                      }}
                      title={
                        acceptDisabled
                          ? t(lang, 'orderAcceptDisabledHint')
                          : t(lang, 'orderAccept')
                      }
                    >
                      {t(lang, 'orderAccept')}
                    </span>
                  ) : (
                    <span className={`ub-chip ub-chip--${tone}`}>
                      {t(lang, `orderStatus_${statusKey}`)}
                    </span>
                  )}

                  {o?.vehicleType ? (
                    <span className="ub-chip ub-chip--ghost">{o.vehicleType}</span>
                  ) : null}

                  {driverName ? (
                    <span className="ub-chip ub-chip--ghost">{driverName}</span>
                  ) : null}
                </div>
              </div>

              <div className="ub-route">
                <div className="ub-route__row">
                  <span className="ub-route__dot" aria-hidden="true" />
                  <div className="ub-route__content">
                    <div className="ub-route__label">{t(lang, 'orderPickupLabel')}</div>
                    <div className="ub-route__text">{pickup}</div>
                  </div>
                </div>

                {visibleStops.length > 0 && (
                  <div className="ub-route__stops">
                    <div className="ub-route__stopsLabel">{t(lang, 'orderStopsLabel')}</div>
                    <div className="ub-route__stopsText">
                      {visibleStops.join(' · ')}
                      {moreCount > 0 ? ` · +${moreCount}` : ''}
                    </div>
                  </div>
                )}

                <div className="ub-route__row" style={{ marginTop: 10 }}>
                  <span className="ub-route__dot is-hollow" aria-hidden="true" />
                  <div className="ub-route__content">
                    <div className="ub-route__label">{t(lang, 'orderDropoffLabel')}</div>
                    <div className="ub-route__text">{dropoff}</div>
                  </div>
                </div>
              </div>

                            <div className="ub-meta">
                <div className="ub-meta__item">
                  <span className="ub-meta__k">{t(lang, 'orderDriverLabel')}</span>
                  <span className="ub-meta__v">{driverName || driverId || '—'}</span>
                </div>

                <div className="ub-meta__item">
                  <span className="ub-meta__k">{t(lang, 'orderDistanceLabel')}</span>
                  <span className="ub-meta__v">
                    {typeof o?.driverDistanceKm === 'number' && Number.isFinite(o.driverDistanceKm)
                      ? `${o.driverDistanceKm.toFixed(1)} ${t(lang, 'distanceKmUnit')}`
                      : typeof o?.distanceKm === 'number' && Number.isFinite(o.distanceKm)
                      ? `${o.distanceKm.toFixed(1)} ${t(lang, 'distanceKmUnit')}`
                      : '—'}
                  </span>
                </div>

                {showRecommendBlock && (
                  <>
                    <div className="ub-meta__item">
                      <span className="ub-meta__k">接單推薦分數</span>
                      <span className="ub-meta__v">
                        {typeof recommendScore === 'number'
                          ? recommendScore.toFixed(3)
                          : typeof recommendScore === 'string'
                          ? recommendScore
                          : '—'}
                      </span>
                    </div>

                    {recommendLabel && (
                      <div className="ub-meta__item">
                        <span className="ub-meta__k">建議接單</span>
                        <span
                          className="ub-meta__v"
                          style={{
                            color: recommendAccept === true ? '#2e7d32' : '#c62828',
                            fontWeight: 700,
                          }}
                        >
                          {recommendLabel}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/*{showRecommendBlock && (
                  <div className="ub-meta__item ub-meta__item--full">
                    <span className="ub-meta__k">分數拆解 debug</span>
                    <div
                      className="ub-meta__v"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px 12px',
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: 'normal',
                      }}
                    >
                      <span>
                        earningN：
                        {typeof o?.recommendEarningN === 'number'
                          ? o.recommendEarningN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        demandN：
                        {typeof o?.recommendDemandN === 'number'
                          ? o.recommendDemandN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        priorityN：
                        {typeof o?.recommendPriorityN === 'number'
                          ? o.recommendPriorityN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        distanceN：
                        {typeof o?.recommendDistanceN === 'number'
                          ? o.recommendDistanceN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        zoneSupplyN：
                        {typeof o?.recommendZoneSupplyN === 'number'
                          ? o.recommendZoneSupplyN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        localSupplyN：
                        {typeof o?.recommendLocalSupplyN === 'number'
                          ? o.recommendLocalSupplyN.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        distanceRaw：
                        {typeof o?.recommendDistanceRaw === 'number'
                          ? o.recommendDistanceRaw.toFixed(2)
                          : '—'}
                      </span>

                      <span>
                        earningRaw：
                        {typeof o?.recommendEarningRaw === 'number'
                          ? o.recommendEarningRaw.toFixed(3)
                          : '—'}
                      </span>
                                            <span>
                        demandRaw：
                        {typeof o?.recommendDemandRaw === 'number'
                          ? o.recommendDemandRaw.toFixed(3)
                          : '—'}
                      </span>

                      <span>
                        priorityRaw：
                        {typeof o?.recommendPriorityRaw === 'number'
                          ? o.recommendPriorityRaw.toFixed(3)
                          : '—'}
                      </span>
                    </div>
                  </div>
                )}*/}

                <div className="ub-meta__item ub-meta__item--full">
                  <span className="ub-meta__k">{t(lang, 'orderTimeLabel')}</span>
                  <span className="ub-meta__v">{o?.updatedAt || o?.createdAt || '—'}</span>
                </div>
              </div>
            </button>
          )
        })}

        {!list.length && <div className="ub-empty">{t(lang, 'orderEmpty')}</div>}
      </div>
    </div>
  )
}