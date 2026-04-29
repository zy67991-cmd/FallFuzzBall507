import { useEffect, useMemo, useState } from 'react'
import './LandingPage.css'
import { t, languages } from './i18n'
import MapLocationPicker from './components/MapLocationPicker.jsx'
import { apiFetch } from './apiBase.js'

export default function LandingPage({
  lang,
  onChangeLang,
  onPassengerClick,
  onDriverClick,
  onAuthClick,
}) {
  const [pickupText, setPickupText] = useState('')
  const [dropoffText, setDropoffText] = useState('')

  const [pickupSuggestions, setPickupSuggestions] = useState([])
  const [dropoffSuggestions, setDropoffSuggestions] = useState([])

  const [pickupLoc, setPickupLoc] = useState(null)
  const [dropoffLoc, setDropoffLoc] = useState(null)
  const [stops, setStops] = useState([])
  const [mapPicker, setMapPicker] = useState(null)

  const [pickupLocked, setPickupLocked] = useState(false)
  const [dropoffLocked, setDropoffLocked] = useState(false)


  const addStop = () => {
    setStops(prev => [...prev, { text: '', loc: null, locked: false, suggestions: [] }])
  }

  const removeStop = index => {
    setStops(prev => prev.filter((_, i) => i !== index))
  }

  const clearPickupPoint = () => {
    setPickupText('')
    setPickupLoc(null)
    setPickupLocked(false)
    setPickupSuggestions([])
  }

  const clearDropoffPoint = () => {
    setDropoffText('')
    setDropoffLoc(null)
    setDropoffLocked(false)
    setDropoffSuggestions([])
  }

  const clearStopPoint = index => {
    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = { text: '', loc: null, locked: false, suggestions: [] }
      return copy
    })
  }

  const updateStopText = (index, text) => {
    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = { ...copy[index], text, loc: null, locked: false, suggestions: [] }
      return copy
    })
  }

  const handleSelectStop = (index, item) => {
    setStops(prev => {
      const copy = [...prev]
      if (!copy[index]) return prev
      copy[index] = {
        ...copy[index],
        text: item.label,
        loc: { lat: item.lat, lng: item.lng },
        locked: true,
        suggestions: [],
      }
      return copy
    })
  }

  const applyMapPickedLocation = item => {
    if (!mapPicker || !item) return
    if (mapPicker.type === 'pickup') handleSelectPickup(item)
    else if (mapPicker.type === 'dropoff') handleSelectDropoff(item)
    else if (mapPicker.type === 'stop') handleSelectStop(mapPicker.index, item)
    setMapPicker(null)
  }


  // 所有尺寸都可收合；預設展開
  const [isBookingCollapsed, setIsBookingCollapsed] = useState(false)

  useEffect(() => {
    if (pickupLocked) {
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
        const res = await apiFetch('/api/geocode', {
          query: { q: pickupText.trim() },
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        setPickupSuggestions(Array.isArray(data) ? data : [])
      } catch {
        // ignore
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pickupText, pickupLocked])

  useEffect(() => {
    if (dropoffLocked) {
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
        const res = await apiFetch('/api/geocode', {
          query: { q: dropoffText.trim() },
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        setDropoffSuggestions(Array.isArray(data) ? data : [])
      } catch {
        // ignore
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [dropoffText, dropoffLocked])


  useEffect(() => {
    stops.forEach((stop, index) => {
      if (stop.locked) return
      const q = String(stop.text || '').trim()
      if (q.length < 2) {
        const onlyMapOption =
          stop.suggestions?.length === 1 && stop.suggestions[0]?._map

        if (stop.suggestions?.length && !onlyMapOption) {
          setStops(prev => {
            const copy = [...prev]
            if (!copy[index]) return prev
            copy[index] = { ...copy[index], suggestions: [] }
            return copy
          })
        }
        return
      }

      const controller = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const res = await apiFetch('/api/geocode', {
            query: { q },
            signal: controller.signal,
          })
          if (!res.ok) return
          const data = await res.json()
          const rows = Array.isArray(data) ? data : []
          setStops(prev => {
            const copy = [...prev]
            if (!copy[index] || copy[index].locked || copy[index].text !== stop.text) return prev
            copy[index] = { ...copy[index], suggestions: rows }
            return copy
          })
        } catch {}
      }, 400)

      return () => {
        clearTimeout(timer)
        controller.abort()
      }
    })
  }, [stops])

  const handleSelectPickup = item => {
    setPickupText(item.label)
    setPickupLoc({ lat: item.lat, lng: item.lng })
    setPickupSuggestions([])
    setPickupLocked(true)
  }

  const handleSelectDropoff = item => {
    setDropoffText(item.label)
    setDropoffLoc({ lat: item.lat, lng: item.lng })
    setDropoffSuggestions([])
    setDropoffLocked(true)
  }

  const goPassengerWithDraft = () => {
    onPassengerClick?.({
      pickupText: pickupText.trim(),
      dropoffText: dropoffText.trim(),
      pickupLoc,
      dropoffLoc,
      stops: stops.map(s => ({ text: s.text, loc: s.loc, locked: s.locked })).filter(s => s.text || s.loc),
      composerLocked: false,
      composeMode: true,
      selectedOrderId: null,
    })
  }

  const bookingCardClass = [
    'booking-card',
    'booking-card-collapsible',
    isBookingCollapsed ? 'is-collapsed' : 'is-expanded',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div id="top" className="landing-root landing-root-uber">
      {/* 導覽列 */}
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div className="container">
          <a className="navbar-brand fw-bold" href="#top">
            SmartDispatch
          </a>

          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbarNav"
            aria-controls="navbarNav"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>

          <div className="collapse navbar-collapse" id="navbarNav">
            <ul className="navbar-nav ms-auto">
              <li className="nav-item">
                <a
                  className="nav-link active"
                  href="#"
                  onClick={e => {
                    e.preventDefault()
                    goPassengerWithDraft()
                  }}
                >
                  {t(lang, 'landingNavPassenger')}
                </a>
              </li>

              <li className="nav-item">
                <a
                  className="nav-link"
                  href="#"
                  onClick={e => {
                    e.preventDefault()
                    onDriverClick?.()
                  }}
                >
                  {t(lang, 'landingNavDriver')}
                </a>
              </li>

            </ul>
          </div>
        </div>
      </nav>

      {/* 乘客 hero 區塊 */}
      <section className="hero-section" id="passenger">
        <div className="hero-overlay" />

        <div className="container hero-content">
          <div className="row align-items-center landing-hero-row">
            <div className="col-lg-6 text-white mb-5 mb-lg-0">
              <div className="landing-eyebrow">NYC Smart Taxi Dispatch</div>
              <h1 className="display-4 fw-bold">{t(lang, 'landingHeroTitle')}</h1>
              <p className="lead mb-4">{t(lang, 'landingHeroSubtitle')}</p>
              <div className="landing-proof-row">
                <div className="landing-proof-item">
                  <strong>AI</strong>
                  <span>需求預測</span>
                </div>
                <div className="landing-proof-item">
                  <strong>Live</strong>
                  <span>即時派遣</span>
                </div>
                <div className="landing-proof-item">
                  <strong>NYC</strong>
                  <span>熱點分析</span>
                </div>
              </div>
            </div>

            <div className="col-lg-5 offset-lg-1">
              <div className="booking-panel-wrap">
                <button
                  type="button"
                  className="panel-toggle"
                  onClick={() => setIsBookingCollapsed(v => !v)}
                  aria-expanded={!isBookingCollapsed}
                  aria-label={
                    isBookingCollapsed
                      ? t(lang, 'landingBookingExpandPanel')
                      : t(lang, 'landingBookingCollapsePanel')
                  }
                >
                  <span className="arrow">{isBookingCollapsed ? '展開' : '收合'}</span>
                  <span>
                    {isBookingCollapsed
                      ? t(lang, 'landingBookingExpandBar')
                      : t(lang, 'landingBookingCollapseBar')}
                  </span>
                </button>

                <div className={bookingCardClass}>
                  <div className="booking-mode-tabs" aria-label="模式選擇">
                    <button type="button" className="booking-mode active" onClick={goPassengerWithDraft}>
                      乘客叫車
                    </button>
                    <button type="button" className="booking-mode" onClick={() => onDriverClick?.()}>
                      司機派遣
                    </button>
                  </div>

                  <div className="booking-card-header">
                    <div>
                      <h3 className="fw-bold mb-0">{t(lang, 'landingHeroWhereTo')}</h3>
                      <p className="booking-card-subtitle">輸入路線，下一步選擇車種並送出訂單。</p>
                    </div>
                  </div>

                  <div className="booking-card-body mt-4">
                    <form>
                      {/* 上車 */}
                      <div className="mb-3 position-relative">
                        <label className="form-label text-muted small">
                          {t(lang, 'landingHeroPickupLabel')}
                        </label>
                        <div className="location-input-row">
                          <input
                            type="text"
                            className="form-control form-control-lg"
                            placeholder={t(lang, 'landingHeroPickupPlaceholder')}
                            value={pickupText}
                            onFocus={() => setPickupSuggestions([{ label: '在地圖上選擇上車點', _map: true }])}
                            onBlur={() => setTimeout(() => setPickupSuggestions([]), 180)}
                            onChange={e => {
                              setPickupText(e.target.value)
                              setPickupLoc(null)
                              setPickupLocked(false)
                              setPickupSuggestions([])
                            }}
                          />
                          <button
                            type="button"
                            className="relocate-btn"
                            onClick={() => setMapPicker({ type: 'pickup', title: '選擇上車地點', initialPoint: pickupLoc })}
                          >
                            地圖
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

                      {/* 下車 */}
                      <div className="mb-3 position-relative">
                        <label className="form-label text-muted small">
                          {t(lang, 'landingHeroDropoffLabel')}
                        </label>
                        <div className="location-input-row">
                          <input
                            type="text"
                            className="form-control form-control-lg"
                            placeholder={t(lang, 'landingHeroDropoffPlaceholder')}
                            value={dropoffText}
                            onFocus={() => setDropoffSuggestions([{ label: '在地圖上選擇目的地', _map: true }])}
                            onBlur={() => setTimeout(() => setDropoffSuggestions([]), 180)}
                            onChange={e => {
                              setDropoffText(e.target.value)
                              setDropoffLoc(null)
                              setDropoffLocked(false)
                              setDropoffSuggestions([])
                            }}
                          />
                          <button
                            type="button"
                            className="relocate-btn"
                            onClick={() => setMapPicker({ type: 'dropoff', title: '選擇下車地點', initialPoint: dropoffLoc })}
                          >
                            地圖
                          </button>
                        </div>

                        {dropoffSuggestions.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {dropoffSuggestions.map((item, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className={item._map ? 'autocomplete-item map-option-item' : 'autocomplete-item'}
                                onMouseDown={e => {
                                  e.preventDefault()
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


                      {/* 停靠點 */}
                      {stops.map((stop, index) => (
                        <div className="mb-3 position-relative" key={`landing-stop-${index}`}>
                          <label className="form-label text-muted small">停靠點 {index + 1}</label>
                          <div className="location-input-row">
                            <input
                              type="text"
                              className="form-control form-control-lg"
                              placeholder="輸入停靠點或使用地圖定位"
                              value={stop.text}
                              onClick={() => setStops(prev => {
                                const copy = [...prev]
                                if (!copy[index]) return prev
                                copy[index] = { ...copy[index], suggestions: [{ label: '在地圖上選擇停靠點', _map: true }] }
                                return copy
                              })}
                              onMouseDown={() => setStops(prev => {
                                const copy = [...prev]
                                if (!copy[index]) return prev
                                copy[index] = { ...copy[index], suggestions: [{ label: '在地圖上選擇停靠點', _map: true }] }
                                return copy
                              })}
                              onFocus={() => setStops(prev => {
                                const copy = [...prev]
                                if (!copy[index]) return prev
                                copy[index] = { ...copy[index], suggestions: [{ label: '在地圖上選擇停靠點', _map: true }] }
                                return copy
                              })}
                              onBlur={() => setTimeout(() => {
                                setStops(prev => {
                                  const copy = [...prev]
                                  if (!copy[index]) return prev
                                  copy[index] = { ...copy[index], suggestions: [] }
                                  return copy
                                })
                              }, 180)}
                              onChange={e => updateStopText(index, e.target.value)}
                            />
                            <button
                              type="button"
                              className="relocate-btn"
                              onClick={() => setMapPicker({ type: 'stop', index, title: `選擇停靠點 ${index + 1}`, initialPoint: stop.loc })}
                            >
                              地圖
                            </button>
                          </div>

                          {stop.suggestions?.length > 0 && (
                            <div className="autocomplete-dropdown">
                              {stop.suggestions.map((item, sIdx) => (
                                <button
                                  key={sIdx}
                                  type="button"
                                  className={item._map ? 'autocomplete-item map-option-item' : 'autocomplete-item'}
                                  onMouseDown={e => {
                                    e.preventDefault()
                                    if (item._map) setMapPicker({ type: 'stop', index, title: `選擇中途停靠 ${index + 1}`, initialPoint: stop.loc })
                                    else handleSelectStop(index, item)
                                  }}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          )}

                          <button type="button" className="btn btn-link p-0 mt-1" onClick={() => removeStop(index)}>移除停靠點</button>
                        </div>
                      ))}

                      <button type="button" className="btn btn-outline-dark w-100 mb-3 fw-bold" onClick={addStop}>
                        + 新增停靠點
                      </button>

                      {/* 查看價格與車輛 */}
                      <button
                        type="button"
                        className="btn btn-dark w-100 btn-lg py-3 fw-bold"
                        onClick={goPassengerWithDraft}
                      >
                        {t(lang, 'landingHeroCta')}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 流程圖 */}
      <section className="how-it-works-section py-5 bg-white">
        <div className="container text-center">
          <div className="mb-5">
            <span className="text-warning fw-bold text-uppercase ls-1">
              {t(lang, 'landingHowTitleTag')}
            </span>
            <h2 className="fw-bold mt-2">{t(lang, 'landingHowTitle')}</h2>
            <p className="text-muted">{t(lang, 'landingHowSubtitle')}</p>
          </div>

          <div className="row justify-content-center">
            <div className="col-md-4 mb-4 mb-md-0 position-relative">
              <div className="step-card p-4">
                <div className="icon-circle bg-warning text-dark mb-4 mx-auto d-flex align-items-center justify-content-center shadow">
                  <i className="bi bi-geo-alt-fill fs-2" />
                </div>
                <h4 className="fw-bold">{t(lang, 'landingHowStep1Title')}</h4>
                <p className="text-muted">{t(lang, 'landingHowStep1Desc')}</p>
              </div>
              <div className="d-none d-md-block position-absolute top-50 end-0 translate-middle-y text-muted">
                <i className="bi bi-chevron-right fs-1" />
              </div>
            </div>

            <div className="col-md-4 mb-4 mb-md-0 position-relative">
              <div className="step-card p-4">
                <div className="icon-circle bg-dark text-warning mb-4 mx-auto d-flex align-items-center justify-content-center shadow">
                  <i className="bi bi-cpu-fill fs-2" />
                </div>
                <h4 className="fw-bold">{t(lang, 'landingHowStep2Title')}</h4>
                <p className="text-muted">{t(lang, 'landingHowStep2Desc')}</p>
              </div>
              <div className="d-none d-md-block position-absolute top-50 end-0 translate-middle-y text-muted">
                <i className="bi bi-chevron-right fs-1" />
              </div>
            </div>

            <div className="col-md-4">
              <div className="step-card p-4">
                <div className="icon-circle bg-warning text-dark mb-4 mx-auto d-flex align-items-center justify-content-center shadow">
                  <i className="bi bi-emoji-smile-fill fs-2" />
                </div>
                <h4 className="fw-bold">{t(lang, 'landingHowStep3Title')}</h4>
                <p className="text-muted">{t(lang, 'landingHowStep3Desc')}</p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <button
              type="button"
              className="btn btn-dark btn-lg px-5 rounded-pill shadow-sm"
              onClick={goPassengerWithDraft}
            >
              {t(lang, 'landingHowCta')}
              <i className="bi bi-arrow-right ms-2" />
            </button>
          </div>
        </div>
      </section>

      {/* 司機招募 */}
      <section className="driver-section" id="driver">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-md-6 mb-4 mb-md-0">
              <img
                src="https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?q=80&w=800&auto=format&fit=crop"
                className="img-fluid rounded shadow"
                alt="Driver App UI"
              />
            </div>

            <div className="col-md-6">
              <span className="badge bg-warning text-dark mb-2">
                {t(lang, 'landingDriverBadge')}
              </span>

              <h2 className="fw-bold mb-3">
                {t(lang, 'landingDriverTitleLine1')}
                <br />
                {t(lang, 'landingDriverTitleLine2')}
              </h2>

              <p className="text-muted">{t(lang, 'landingDriverIntro')}</p>

              <ul className="list-unstyled mt-4">
                <li className="mb-3">
                  <h5 className="fw-bold">{t(lang, 'landingDriverFeature1Title')}</h5>
                  <p className="small text-muted">{t(lang, 'landingDriverFeature1Desc')}</p>
                </li>
                <li className="mb-3">
                  <h5 className="fw-bold">{t(lang, 'landingDriverFeature2Title')}</h5>
                  <p className="small text-muted">{t(lang, 'landingDriverFeature2Desc')}</p>
                </li>
              </ul>

              <button
                type="button"
                className="btn btn-outline-dark mt-3"
                onClick={() => onDriverClick?.()}
              >
                {t(lang, 'landingDriverCta')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-dark text-white py-5 text-center">
        <div className="container">
          <p className="mt-5 text-white-50 small">{t(lang, 'landingFooterCopyright')}</p>
        </div>
      </footer>
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
    </div>
  )
}
