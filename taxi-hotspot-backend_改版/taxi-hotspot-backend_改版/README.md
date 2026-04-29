# Taxi Hotspot Backend

FastAPI backend for taxi demand prediction and dispatch ranking.

## Runtime

- Python: `3.11.9`
- Render runtime file: `runtime.txt`
- Local version hint: `.python-version`

## Recreate Local Virtual Environment

```powershell
Remove-Item -Recurse -Force .venv
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If `py -3.11` is not available, install Python 3.11.9 first and rerun the commands.

## Environment Variables

Set these for Render/R2 mode:

```text
R2_ENDPOINT=
R2_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
MODEL_ENABLED=1
```

The upload script reads secrets only from environment variables. Do not commit real keys. Rotate any key that was previously exposed in source code.

## Run Locally

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Render Web Service

```text
Root Directory: taxi-hotspot-backend_改版/taxi-hotspot-backend_改版
Build Command: pip install -r requirements.txt
Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
```

Core endpoints:

- `GET /api/health`
- `GET /api/snap-road`
- `GET /api/route`
- `GET /api/zone-hotspots`
- `POST /api/dispatch-recommendations`
- `GET /api/orders`
- `GET /api/drivers`

## Scoring

Hotspot analysis uses XGBoost demand prediction first, then adjusts by priority and supply:

```text
HotspotScore = 2.0*Demand + 0.9*Priority - 0.45*ZoneSupply - 0.20*LocalSupply
```

Driver relocation recommendations add distance:

```text
Score = 2.0*Demand + 0.9*Priority - 0.9*Distance - 0.45*ZoneSupply - 0.20*LocalSupply
```
