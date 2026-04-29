# Taxi Dispatch Frontend

React + Vite frontend for the taxi dispatch demo.

## API Base

Set `VITE_API_BASE` when the backend is deployed:

```powershell
$env:VITE_API_BASE="https://your-backend.onrender.com"
npm run build
```

When opened on localhost, the app falls back to `http://127.0.0.1:8000`.
When opened from a public domain such as Render, `VITE_API_BASE` is required; otherwise the app shows an "API 尚未設定" screen instead of trying to call localhost from the phone.

The frontend reads hotspot and dispatch scores from the backend. Hotspot colors use `hotspot_score`; driver relocation cards use backend `score`, `gain`, demand, priority, distance, and supply fields.

## Local Development

```powershell
npm install
npm run dev
```

## Production Build

```powershell
npm run build
```
