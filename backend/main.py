import os
import sys
import random
import json
from pathlib import Path
from typing import Any, Dict, Optional, List
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def _get_r2_env():
    return {
        "R2_ENDPOINT": os.getenv("R2_ENDPOINT"),
        "R2_BUCKET": os.getenv("R2_BUCKET"),
        "AWS_ACCESS_KEY_ID": os.getenv("AWS_ACCESS_KEY_ID"),
        "AWS_SECRET_ACCESS_KEY": os.getenv("AWS_SECRET_ACCESS_KEY"),
    }


print("backend cwd =", Path.cwd())
print("R2 configured =", all(_get_r2_env().values()))

# =========================
# Config
# =========================
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

OUT_DIR = Path(os.getenv("OUT_DIR", "./outputs"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_DIR = Path("./model")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

KEY_PARQUET = "data/test_hourly.parquet"
KEY_MODEL_XGB = "model/xgb_demand_poisson.model"
KEY_CENT = "meta/taxi_zone_centroids.csv"
KEY_NET = "meta/nyc.net.xml"

PARQUET_PATH = DATA_DIR / "test_hourly.parquet"
MODEL_PATH_XGB = MODEL_DIR / "xgb_demand_poisson.model"
CENT_PATH = DATA_DIR / "taxi_zone_centroids.csv"
NET_PATH = DATA_DIR / "nyc.net.xml"

KEY_OUT_PRED = "outputs/pred_next_hour_advanced.csv"

ZONE_COL = "PULocationID"
RAW_TIME_COL = "pickup_hour"
PRED_COL = "pred_rides"
MODEL_ENABLED = os.getenv("MODEL_ENABLED", "1").strip() not in ("0", "false", "False")

# =========================
# Hybrid dispatch config (ported from revised dispatch backend)
# =========================
W_DEMAND = 2.0
W_PRIORITY = 0.9
W_DISTANCE = 0.9
W_ZONE_SUPPLY = 0.45
W_LOCAL_SUPPLY = 0.20
MIN_GAIN = 0.20

LOCAL_RADIUS_KM = float(os.getenv("LOCAL_RADIUS_KM", "2.0"))
MAX_CANDIDATE_RADIUS_KM = float(os.getenv("MAX_CANDIDATE_RADIUS_KM", "8.0"))
MIN_NEAR = int(os.getenv("MIN_NEAR", "15"))
K_NEAREST = int(os.getenv("K_NEAREST", "80"))
TOP_K_RESULT = int(os.getenv("TOP_K_RESULT", "3"))

SYNTH_IDLE_COUNT = int(os.getenv("SYNTH_IDLE_COUNT", "2000"))
SYNTH_RANDOM_SEED = int(os.getenv("SYNTH_RANDOM_SEED", "20250801"))
AIRPORT_BIAS = float(os.getenv("AIRPORT_BIAS", "1.8"))
MIDTOWN_BIAS = float(os.getenv("MIDTOWN_BIAS", "1.5"))
MANHATTAN_CORE_BIAS = float(os.getenv("MANHATTAN_CORE_BIAS", "1.25"))

ACTIVE_ORDER_STATUSES = {
    "assigned", "accepted", "en_route", "enroute", "picked_up", "in_progress", "on_trip", "ongoing"
}
MIDTOWN_KEYWORDS = [
    "Midtown", "Times Sq", "Theatre District", "Penn Station", "Garment District",
    "Union Sq", "Flatiron", "Murray Hill", "Kips Bay", "Chelsea"
]
AIRPORT_KEYWORDS = ["Airport", "JFK", "LaGuardia", "LGA"]

# =========================
# FastAPI app & State
# =========================
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE: Dict[str, Any] = {
    "booster": None,
    "cent": None,
    "hourly": None,
    "latest_hour": None,
    "pred_df": None,
    "pred_hour": None,
    "pred_dispatch_df": None,
    "model_ready": False,
    "hotspots_df": None,
    "model_init_error": None,
    "dispatch_zones_loaded_at": None,
}

# =========================
# JSON Store (派遣系統資料)
# =========================
USERS_PATH = DATA_DIR / "users.json"
DRIVERS_PATH = DATA_DIR / "drivers.json"
ORDERS_PATH = DATA_DIR / "orders.json"
META_PATH = DATA_DIR / "meta.json"

STORE: Dict[str, Any] = {
    "users": [],
    "drivers": [],
    "orders": [],
    "meta": {"next_user_id": 1, "next_order_id": 1, "next_driver_id": 1},
}
# =========================
# 🔥 預設資料（固定系統）
# =========================
def seed_default_store():
    now = _now_iso()

    # 1️⃣ 固定乘客
    STORE["users"] = [
        {
            "id": 1,
            "username": "乘客1",
            "password": "",
            "role": "passenger",
            "createdAt": now,
        }
    ]

    # 2️⃣ 固定 6 位司機
    STORE["drivers"] = [
        {"id": 1, "name": "GREEN 司機1", "carType": "GREEN", "lat": None, "lng": None, "updatedAt": now},
        {"id": 2, "name": "GREEN 司機2", "carType": "GREEN", "lat": None, "lng": None, "updatedAt": now},
        {"id": 3, "name": "YELLOW 司機1", "carType": "YELLOW", "lat": None, "lng": None, "updatedAt": now},
        {"id": 4, "name": "YELLOW 司機2", "carType": "YELLOW", "lat": None, "lng": None, "updatedAt": now},
        {"id": 5, "name": "FHV 司機1", "carType": "FHV", "lat": None, "lng": None, "updatedAt": now},
        {"id": 6, "name": "FHV 司機2", "carType": "FHV", "lat": None, "lng": None, "updatedAt": now},
    ]

    # 3️⃣ 預設 6 張訂單（每車種2張）
    def make_order(i, vehicleType, pickup, dropoff, p, d, price, dist):
        return {
            "id": i,
            "status": "pending",
            "customer": "乘客1",
            "pickup": pickup,
            "dropoff": dropoff,
            "pickupLocation": {"lat": p[0], "lng": p[1]},
            "dropoffLocation": {"lat": d[0], "lng": d[1]},
            "stops": [],
            "vehicleType": vehicleType,
            "estimatedPrice": price,
            "distanceKm": dist,
            "createdAt": now,
        }

    STORE["orders"] = [
        make_order(1, "GREEN", "Times Square", "Central Park", (40.758, -73.9855), (40.7829, -73.9654), 8.5, 2.3),
        make_order(2, "GREEN", "Chelsea", "Union Square", (40.7465, -74.0014), (40.7359, -73.9911), 6.8, 1.9),

        make_order(3, "YELLOW", "Penn Station", "Wall Street", (40.7502, -73.9928), (40.7060, -74.0086), 15.0, 6.5),
        make_order(4, "YELLOW", "Grand Central", "SoHo", (40.7527, -73.9772), (40.7233, -74.0030), 12.3, 4.7),

        make_order(5, "FHV", "JFK Airport", "Midtown", (40.6413, -73.7781), (40.7549, -73.9840), 45.0, 25.0),
        make_order(6, "FHV", "LaGuardia", "Brooklyn", (40.7769, -73.8740), (40.6782, -73.9442), 32.0, 18.0),
    ]

    # 4️⃣ 重設 ID 計數器
    STORE["meta"] = {
        "next_user_id": 2,
        "next_driver_id": 7,
        "next_order_id": 7,
    }

    save_store()
    print("🔥 Default store seeded")

# =========================
# Helpers
# =========================
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _r2_config_ok() -> bool:
    env = _get_r2_env()
    return all(env.values())

def save_store():
    for k, p in zip(
        ["users", "drivers", "orders", "meta"],
        [USERS_PATH, DRIVERS_PATH, ORDERS_PATH, META_PATH],
    ):
        p.write_text(json.dumps(STORE[k], ensure_ascii=False, indent=2), encoding="utf-8")


def load_store():
    for k, p in zip(
        ["users", "drivers", "orders", "meta"],
        [USERS_PATH, DRIVERS_PATH, ORDERS_PATH, META_PATH],
    ):
        if p.exists():
            STORE[k] = json.loads(p.read_text(encoding="utf-8"))


def _find_driver(driver_id: int):
    return next((d for d in STORE["drivers"] if int(d.get("id", 0)) == int(driver_id)), None)


def _find_driver_by_name(name: str):
    name = (name or "").strip()
    return next((d for d in STORE["drivers"] if str(d.get("name", "")).strip() == name), None)


def _find_user(username: str):
    username = (username or "").strip()
    return next((u for u in STORE["users"] if str(u.get("username", "")).strip() == username), None)


def _find_order(order_id: int):
    return next((o for o in STORE["orders"] if int(o.get("id", 0)) == int(order_id)), None)


def norm_status(status: str) -> str:
    return str(status or "").strip().lower()


def get_order_driver_id(order):
    return order.get("driverId") or order.get("assignedDriverId") or order.get("driver_id")


def is_driver_busy(driver_id: int) -> bool:
    for o in STORE["orders"]:
        if int(get_order_driver_id(o) or 0) != int(driver_id):
            continue
        if norm_status(o.get("status")) in ACTIVE_ORDER_STATUSES:
            return True
    return False


def s3_client():
    env = _get_r2_env()
    if not all(env.values()):
        raise RuntimeError("Missing R2 environment variables")

    import boto3

    return boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

def upload_to_r2(local_path: Path, r2_key: str):
    if not local_path.exists():
        return
    try:
        env = _get_r2_env()
        s3_client().upload_file(str(local_path), env["R2_BUCKET"], r2_key)
        print(f"⬆️ [Upload] {local_path.name} -> {r2_key} ✅")
    except Exception as e:
        print(f"❌ Upload error: {e}")


def download_sync(key: str, dst: Path, label: str):
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        env = _get_r2_env()
        print(f"DOWNLOAD TRY: label={label}, bucket={env['R2_BUCKET']}, key={key}, dst={dst}")
        s3_client().download_file(env["R2_BUCKET"], key, str(dst))
        print(f"⬇️ [Download] {label} ✅")
    except Exception as e:
        print(f"⚠️ {label} 下載跳過: {e}")
        raise

def centroids_to_wgs84(df_cent):
    from pyproj import Transformer

    t = Transformer.from_crs("EPSG:2263", "EPSG:4326", always_xy=True)
    lon_deg, lat_deg = t.transform(
        df_cent["lon"].astype(float).values,
        df_cent["lat"].astype(float).values,
    )
    out = df_cent.copy()
    out["lon"], out["lat"] = lon_deg, lat_deg
    return out[["LocationID", "Borough", "Zone", "lat", "lon"]]


def build_hotspots_df(pred_df, cent_df):
    import pandas as pd

    if pred_df is None or pred_df.empty:
        return pd.DataFrame()

    df = pred_df.copy()

    if ZONE_COL not in df.columns:
        if "LocationID" in df.columns:
            df[ZONE_COL] = df["LocationID"]
        else:
            return df

    cent = cent_df.rename(columns={"LocationID": ZONE_COL})
    df = df.merge(cent, on=ZONE_COL, how="left")

    if "lat" in df.columns and "lat_wgs" not in df.columns:
        df["lat_wgs"] = df["lat"]
    if "lon" in df.columns and "lon_wgs" not in df.columns:
        df["lon_wgs"] = df["lon"]

    return df


def get_prediction_df_for_dispatch():
    import pandas as pd

    pred_csv_path = OUT_DIR / "pred_next_hour_advanced.csv"
    if pred_csv_path.exists():
        df = pd.read_csv(pred_csv_path)
    elif STATE.get("pred_df") is not None:
        df = STATE["pred_df"].copy()
    else:
        raise FileNotFoundError(f"Prediction file not found: {pred_csv_path}")

    if PRED_COL not in df.columns:
        for cand in ["pred_next_hour", "pred_next_hour_advanced", "yhat", "pred"]:
            if cand in df.columns:
                df = df.rename(columns={cand: PRED_COL})
                break

    required = {ZONE_COL, PRED_COL}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"pred csv missing columns: {sorted(missing)}")

    return df.copy()


def minmax01(series):
    import pandas as pd

    s = pd.to_numeric(series, errors="coerce").fillna(0.0).astype(float)
    mn = float(s.min()) if len(s) else 0.0
    mx = float(s.max()) if len(s) else 0.0
    if mx - mn < 1e-12:
        return pd.Series([0.0] * len(s), index=s.index, dtype=float)
    return (s - mn) / (mx - mn)


def build_dispatch_zone_table():
    import pandas as pd

    if not CENT_PATH.exists():
        raise FileNotFoundError(f"Centroid file not found: {CENT_PATH}")

    df_pred = get_prediction_df_for_dispatch()
    df_cent = pd.read_csv(CENT_PATH)
    cent = centroids_to_wgs84(df_cent)
    df = df_pred.merge(cent, left_on=ZONE_COL, right_on="LocationID", how="left")
    df[PRED_COL] = pd.to_numeric(df[PRED_COL], errors="coerce").fillna(0.0)
    df = df.dropna(subset=["lat", "lon"]).copy()

    if "Borough" not in df.columns:
        df["Borough"] = ""
    if "Zone" not in df.columns:
        df["Zone"] = df[ZONE_COL].astype(str)

    def zone_bias(row) -> float:
        zone = str(row.get("Zone", ""))
        borough = str(row.get("Borough", ""))
        bias = 1.0
        if borough == "Manhattan":
            bias *= MANHATTAN_CORE_BIAS
        if any(k.lower() in zone.lower() for k in MIDTOWN_KEYWORDS):
            bias *= MIDTOWN_BIAS
        if any(k.lower() in zone.lower() for k in AIRPORT_KEYWORDS):
            bias *= AIRPORT_BIAS
        return bias

    df["synthetic_bias"] = df.apply(zone_bias, axis=1)
    df["demand_weight_for_supply"] = (df[PRED_COL].clip(lower=0.0) + 1e-9) * df["synthetic_bias"]
    df["priority"] = minmax01(df["demand_weight_for_supply"])
    df["zone_id"] = df[ZONE_COL].astype(int)
    df["lat_wgs"] = df["lat"].astype(float)
    df["lon_wgs"] = df["lon"].astype(float)
    return df.reset_index(drop=True)


def refresh_dispatch_zones():
    df = build_dispatch_zone_table()
    STATE["pred_dispatch_df"] = df
    STATE["dispatch_zones_loaded_at"] = _now_iso()
    return df


def get_dispatch_zones(force: bool = False):
    if force or STATE.get("pred_dispatch_df") is None:
        return refresh_dispatch_zones()
    return STATE["pred_dispatch_df"]


def haversine_km(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, sqrt, asin

    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def synthetic_idle_supply(df) -> Dict[int, int]:
    rng = random.Random(SYNTH_RANDOM_SEED)
    zone_ids = df["zone_id"].tolist()
    weights = df["demand_weight_for_supply"].tolist()
    picks = rng.choices(zone_ids, weights=weights, k=max(0, SYNTH_IDLE_COUNT))
    supply = {int(z): 0 for z in zone_ids}
    for z in picks:
        supply[int(z)] += 1
    return supply


def nearest_zone_id(df, lat: float, lng: float) -> Optional[int]:
    best_z, best_d = None, float("inf")
    for _, r in df.iterrows():
        d = haversine_km(lat, lng, float(r["lat_wgs"]), float(r["lon_wgs"]))
        if d < best_d:
            best_d = d
            best_z = int(r["zone_id"])
    return best_z


def real_idle_supply(df) -> Dict[int, int]:
    supply = {int(z): 0 for z in df["zone_id"].tolist()}
    for d in STORE["drivers"]:
        did = d.get("id")
        lat = d.get("lat")
        lng = d.get("lng")
        if did is None or lat is None or lng is None:
            continue
        try:
            did = int(did)
            lat = float(lat)
            lng = float(lng)
        except Exception:
            continue
        if is_driver_busy(did):
            continue
        zid = nearest_zone_id(df, lat, lng)
        if zid is not None:
            supply[int(zid)] = supply.get(int(zid), 0) + 1
    return supply


def local_supply_for_zone(df, zone_supply_map: Dict[int, int], zone_id: int) -> int:
    row = df.loc[df["zone_id"] == zone_id]
    if row.empty:
        return 0
    src = row.iloc[0]
    src_lat, src_lon = float(src["lat_wgs"]), float(src["lon_wgs"])
    total = 0
    for _, r in df.iterrows():
        other_id = int(r["zone_id"])
        if other_id == zone_id:
            continue
        d = haversine_km(src_lat, src_lon, float(r["lat_wgs"]), float(r["lon_wgs"]))
        if d <= LOCAL_RADIUS_KM:
            total += int(zone_supply_map.get(other_id, 0))
    return total


def build_supply_maps(df) -> Dict[str, Dict[int, int]]:
    synth = synthetic_idle_supply(df)
    real = real_idle_supply(df)
    total = {int(z): int(synth.get(int(z), 0)) + int(real.get(int(z), 0)) for z in df["zone_id"].tolist()}
    local = {int(z): local_supply_for_zone(df, total, int(z)) for z in df["zone_id"].tolist()}
    return {"synthetic": synth, "real": real, "total": total, "local": local}


def normalized_candidate_frame(df, driver_lat: float, driver_lng: float):
    import pandas as pd

    base = []
    for _, r in df.iterrows():
        dkm = haversine_km(driver_lat, driver_lng, float(r["lat_wgs"]), float(r["lon_wgs"]))
        base.append({
            "zone_id": int(r["zone_id"]),
            "Zone": str(r.get("Zone", "")),
            "Borough": str(r.get("Borough", "")),
            "lat_wgs": float(r["lat_wgs"]),
            "lon_wgs": float(r["lon_wgs"]),
            PRED_COL: float(r[PRED_COL]),
            "priority": float(r["priority"]),
            "distance_km": float(dkm),
        })

    near = [x for x in base if x["distance_km"] <= MAX_CANDIDATE_RADIUS_KM]
    if len(near) < MIN_NEAR:
        near = sorted(base, key=lambda x: x["distance_km"])[:K_NEAREST]

    cand = pd.DataFrame(near)
    if cand.empty:
        return cand

    cand["DemandN"] = minmax01(cand[PRED_COL])
    cand["PriorityN"] = minmax01(cand["priority"])
    cand["DistanceN"] = minmax01(cand["distance_km"])
    return cand


def score_frame(cand, supply_maps: Dict[str, Dict[int, int]]):
    if cand.empty:
        return cand
    cand = cand.copy()
    cand["ZoneSupply"] = cand["zone_id"].map(lambda z: int(supply_maps["total"].get(int(z), 0)))
    cand["LocalSupply"] = cand["zone_id"].map(lambda z: int(supply_maps["local"].get(int(z), 0)))
    cand["ZoneSupplyN"] = minmax01(cand["ZoneSupply"])
    cand["LocalSupplyN"] = minmax01(cand["LocalSupply"])
    cand["Score"] = (
        W_DEMAND * cand["DemandN"]
        + W_PRIORITY * cand["PriorityN"]
        - W_DISTANCE * cand["DistanceN"]
        - W_ZONE_SUPPLY * cand["ZoneSupplyN"]
        - W_LOCAL_SUPPLY * cand["LocalSupplyN"]
    )
    return cand


def attach_dispatch_supply_columns(df_in):
    """
    Attach backend-computed zone/local supply to hotspot rows without requiring
    the frontend to call an extra API. Demand/priority/supply all come from the
    same dispatch zone table used by /api/dispatch-recommendations.
    """
    if df_in is None or len(df_in) == 0:
        return df_in

    try:
        import pandas as pd

        df = df_in.copy()
        dz = get_dispatch_zones(force=False).copy()
        supply_maps = build_supply_maps(dz)

        dz["DemandN"] = minmax01(dz[PRED_COL])
        dz["PriorityN"] = minmax01(dz["priority"])
        dz["ZoneSupply"] = dz["zone_id"].map(lambda z: int(supply_maps["total"].get(int(z), 0)))
        dz["LocalSupply"] = dz["zone_id"].map(lambda z: int(supply_maps["local"].get(int(z), 0)))
        dz["ZoneSupplyN"] = minmax01(dz["ZoneSupply"])
        dz["LocalSupplyN"] = minmax01(dz["LocalSupply"])

        zone_col = None
        for cand in ["zone_id", ZONE_COL, "LocationID", "location_id", "PULocationID"]:
            if cand in df.columns:
                zone_col = cand
                break
        if zone_col is None:
            return df

        lookup_cols = [
            "zone_id", PRED_COL, "priority", "DemandN", "PriorityN",
            "ZoneSupply", "LocalSupply", "ZoneSupplyN", "LocalSupplyN",
        ]
        lookup = dz[lookup_cols].drop_duplicates(subset=["zone_id"]).copy()
        lookup = lookup.rename(columns={
            PRED_COL: "dispatch_pred_rides",
            "priority": "dispatch_priority",
            "ZoneSupply": "zone_supply",
            "LocalSupply": "local_supply",
        })

        df["_dispatch_zone_id"] = pd.to_numeric(df[zone_col], errors="coerce").astype("Int64")
        df = df.merge(lookup, left_on="_dispatch_zone_id", right_on="zone_id", how="left", suffixes=("", "_dispatch"))

        if PRED_COL not in df.columns and "dispatch_pred_rides" in df.columns:
            df[PRED_COL] = df["dispatch_pred_rides"]
        if "pred_rides" not in df.columns and "dispatch_pred_rides" in df.columns:
            df["pred_rides"] = df["dispatch_pred_rides"]
        if "priority" not in df.columns and "dispatch_priority" in df.columns:
            df["priority"] = df["dispatch_priority"]

        for c in ["zone_supply", "local_supply", "DemandN", "PriorityN", "ZoneSupplyN", "LocalSupplyN"]:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

        for c in ["DemandN", "PriorityN", "ZoneSupplyN", "LocalSupplyN"]:
            if c not in df.columns:
                df[c] = 0.0

        df["hotspot_score"] = (
            W_DEMAND * df["DemandN"]
            + W_PRIORITY * df["PriorityN"]
            - W_ZONE_SUPPLY * df["ZoneSupplyN"]
            - W_LOCAL_SUPPLY * df["LocalSupplyN"]
        )

        return df.drop(columns=[c for c in ["_dispatch_zone_id", "zone_id_dispatch"] if c in df.columns])
    except Exception as e:
        print(f"⚠️ attach_dispatch_supply_columns failed: {e}")
        return df_in

# =========================
# Lazy model init
# =========================
def init_model():
    print("=== INIT_MODEL CALLED ===")

    if STATE["model_ready"]:
        return

    if not MODEL_ENABLED:
        STATE["model_init_error"] = "MODEL_ENABLED is false"
        return

    if not _r2_config_ok():
        STATE["model_init_error"] = "Missing R2 environment variables"
        raise RuntimeError(STATE["model_init_error"])

    import pandas as pd
    import xgboost as xgb
    from logic import run_prediction_task, generate_ranking_reports


    print("🔄 Initializing Models & Data...")

    print("STEP 1: download XGB")
    download_sync(KEY_MODEL_XGB, MODEL_PATH_XGB, "XGB")

    print("STEP 2: download Parquet")
    download_sync(KEY_PARQUET, PARQUET_PATH, "Parquet")

    print("STEP 3: download Centroids")
    download_sync(KEY_CENT, CENT_PATH, "Centroids")


    if NET_PATH.exists():
        print(f"NetXML exists, skip: {NET_PATH}")
    else:
        print("STEP 4: download NetXML")
        download_sync(KEY_NET, NET_PATH, "NetXML")

    print("STEP 5: load xgboost model")
    booster = xgb.Booster()
    booster.load_model(str(MODEL_PATH_XGB))

    print("STEP 6: read centroids csv")
    cent = pd.read_csv(CENT_PATH)

    print("STEP 7: read parquet")
    df = pd.read_parquet(PARQUET_PATH)

    print("STEP 8: run prediction task")


    if NET_PATH.exists():
        print(f"NetXML exists, skip: {NET_PATH}")
    else:
        download_sync(KEY_NET, NET_PATH, "NetXML")

    try:
        booster = xgb.Booster()
        booster.load_model(str(MODEL_PATH_XGB))
        STATE["booster"] = booster

        cent = pd.read_csv(CENT_PATH)
        STATE["cent"] = centroids_to_wgs84(cent)

        df = pd.read_parquet(PARQUET_PATH)
        df[RAW_TIME_COL] = pd.to_datetime(df[RAW_TIME_COL])
        STATE["hourly"] = df

        latest = df[RAW_TIME_COL].max()
        STATE["latest_hour"] = latest

        if not pd.isna(latest):
            print("🔮 Running Initial Prediction & Analysis...")

            df_pred = run_prediction_task(
                booster,
                df,
                CENT_PATH,
                OUT_DIR / "pred_next_hour_advanced.csv",
                OUT_DIR / "heatmap.html",
            )

            pred_csv_path = OUT_DIR / "pred_next_hour_advanced.csv"
            if pred_csv_path.exists():
                df_pred = pd.read_csv(pred_csv_path)

            STATE["pred_df"] = df_pred
            STATE["pred_hour"] = (
                df_pred["predict_hour"].iloc[0]
                if (df_pred is not None and not df_pred.empty and "predict_hour" in df_pred.columns)
                else (latest + pd.Timedelta(hours=1))
            )
            generate_ranking_reports(df_pred, CENT_PATH, OUT_DIR)

            try:
                STATE["hotspots_df"] = build_hotspots_df(
                    STATE["pred_df"],
                    STATE["cent"],
                )
            except Exception as e:
                print(f"⚠️ build_hotspots_df failed: {e}")
                STATE["hotspots_df"] = None

            try:
                refresh_dispatch_zones()
            except Exception as e:
                print(f"⚠️ dispatch zone refresh failed during init: {e}")
                STATE["pred_dispatch_df"] = None

        STATE["model_ready"] = True
        print("✅ Model init complete.")
    except Exception as e:
        STATE["model_ready"] = False
        STATE["model_init_error"] = str(e)
        print(f"❌ Init failed: {e}")
        raise

# =========================
# Model/Data diagnostics
# =========================
def model_data_summary():
    summary = {
        "training_rows": 0,
        "training_zones": 0,
        "training_hours": 0,
        "training_start": None,
        "training_end": None,
        "avg_hourly_rides": None,
        "prediction_zones": 0,
        "avg_pred_rides": None,
        "prediction_blend": "xgboost_scaled_plus_seasonal_baseline",
    }

    try:
        import pandas as pd

        df = STATE.get("hourly")
        if df is None and PARQUET_PATH.exists():
            df = pd.read_parquet(PARQUET_PATH)

        if df is not None and not df.empty:
            t = pd.to_datetime(df.get(RAW_TIME_COL), errors="coerce")
            summary.update({
                "training_rows": int(len(df)),
                "training_zones": int(pd.to_numeric(df.get(ZONE_COL), errors="coerce").nunique()),
                "training_hours": int(t.nunique()),
                "training_start": str(t.min()) if not pd.isna(t.min()) else None,
                "training_end": str(t.max()) if not pd.isna(t.max()) else None,
                "avg_hourly_rides": float(pd.to_numeric(df.get("rides"), errors="coerce").mean()),
            })

        pred = STATE.get("pred_df")
        if pred is None and (OUT_DIR / "pred_next_hour_advanced.csv").exists():
            pred = pd.read_csv(OUT_DIR / "pred_next_hour_advanced.csv")

        if pred is not None and not pred.empty:
            summary.update({
                "prediction_zones": int(pd.to_numeric(pred.get(ZONE_COL), errors="coerce").nunique()),
                "avg_pred_rides": float(pd.to_numeric(pred.get(PRED_COL), errors="coerce").mean()),
            })
    except Exception as e:
        summary["diagnostic_error"] = str(e)

    return summary

# =========================
# Pydantic models
# =========================
class RegisterBody(BaseModel):
    username: str
    password: str
    role: str = "passenger"
    carType: Optional[str] = None


class LoginBody(BaseModel):
    username: str
    password: str


class DriverLoginBody(BaseModel):
    name: str
    carType: Optional[str] = None


class DriverLocationBody(BaseModel):
    lat: float
    lng: float


class LatLng(BaseModel):
    lat: float
    lng: float


class CreateOrderBody(BaseModel):
    customer: Optional[str] = None
    pickup: str
    dropoff: str
    pickupLocation: LatLng
    dropoffLocation: LatLng
    stops: Optional[List[Dict[str, Any]]] = None
    vehicleType: Optional[str] = None
    estimatedPrice: Optional[float] = None
    distanceKm: Optional[float] = None


class AcceptOrderBody(BaseModel):
    driverId: int

# =========================
# Startup
# =========================
@app.on_event("startup")
def startup_all():
    try:
        seed_default_store()   # 🔥 改這裡（關鍵）
        print("✅ Default store loaded.")
    except Exception as e:
        print(f"❌ seed_default_store failed: {e}")

    try:
        init_model()
        print("✅ Model initialized at startup.")
    except Exception as e:
        print(f"⚠️ init_model failed at startup: {e}")

# =========================
# Health
# =========================
@app.get("/api/health")
def api_health():
    return {
        "ok": True,
        "model_ready": STATE["model_ready"],
        "model_init_error": STATE["model_init_error"],
        "drivers": len(STORE["drivers"]),
        "orders": len(STORE["orders"]),
        "dispatch_formula": "Score = 2.0*Demand + 0.9*Priority - 0.9*Distance - 0.45*ZoneSupply - 0.20*LocalSupply",
        "hotspot_formula": "HotspotScore = 2.0*Demand + 0.9*Priority - 0.45*ZoneSupply - 0.20*LocalSupply",
        "min_gain": MIN_GAIN,
        "dispatch_zones_loaded_at": STATE.get("dispatch_zones_loaded_at"),
        "model_data": model_data_summary(),
    }

# =========================
# Hotspots
# =========================
@app.get("/api/hotspots")
def hotspots(n: int = 20, sort_by: str = "hotspot_score"):
    if not STATE["model_ready"]:
        try:
            init_model()
        except Exception as e:
            raise HTTPException(503, f"Model init failed: {e}")

    if not STATE["model_ready"]:
        raise HTTPException(503, "Model not ready")

    if STATE["pred_df"] is None:
        raise HTTPException(503, "Prediction not ready")

    df = STATE.get("hotspots_df")
    if df is None or len(df) == 0:
        df = STATE["pred_df"].copy()

    df = attach_dispatch_supply_columns(df)

    sort_by = (sort_by or "").strip()
    if sort_by not in df.columns:
        sort_by = PRED_COL if PRED_COL in df.columns else df.columns[0]

    try:
        n = int(n)
    except Exception:
        n = 20

    df_out = df.sort_values(sort_by, ascending=False).head(n)
    return {
        "predict_hour": str(STATE["pred_hour"]),
        "rows": df_out.to_dict(orient="records"),
    }


@app.get("/api/zone-hotspots")
def api_zone_hotspots():
    if not STATE["model_ready"]:
        try:
            init_model()
        except Exception as e:
            raise HTTPException(503, f"Model init failed: {e}")

    try:
        df = get_dispatch_zones(force=False).copy()
    except Exception as e:
        raise HTTPException(503, f"Dispatch hotspots not ready: {e}")

    df = attach_dispatch_supply_columns(df)
    keep_cols = [
        "zone_id", ZONE_COL, "Borough", "Zone", "lat_wgs", "lon_wgs",
        PRED_COL, "priority", "zone_supply", "local_supply",
        "DemandN", "PriorityN", "ZoneSupplyN", "LocalSupplyN", "hotspot_score",
    ]
    keep_cols = [c for c in keep_cols if c in df.columns]
    out = df[keep_cols].copy()
    if "hotspot_score" in out.columns:
        out.sort_values("hotspot_score", ascending=False, inplace=True)
    return {
        "rows": out.to_dict(orient="records"),
        "prediction_mode": "model_pipeline",
        "predict_hour": str(STATE.get("pred_hour")),
    }


@app.get("/api/dispatch-recommendations")
def api_dispatch_recommendations(driver_id: Optional[int] = None, lat: Optional[float] = None, lng: Optional[float] = None, top_k: int = TOP_K_RESULT):
    if not STATE["model_ready"]:
        try:
            init_model()
        except Exception as e:
            raise HTTPException(503, f"Model init failed: {e}")

    try:
        df = get_dispatch_zones(force=False)
    except Exception as e:
        raise HTTPException(503, f"Dispatch zones not ready: {e}")

    driver_name = None

    if driver_id is not None:
        d = _find_driver(driver_id)
        if d is None:
            raise HTTPException(404, f"Driver {driver_id} not found")
        driver_name = d.get("name")
        if lat is None:
            lat = d.get("lat")
        if lng is None:
            lng = d.get("lng")

    if lat is None or lng is None:
        raise HTTPException(400, "Missing driver lat/lng")

    driver_lat = float(lat)
    driver_lng = float(lng)
    current_zone_id = nearest_zone_id(df, driver_lat, driver_lng)
    if current_zone_id is None:
        raise HTTPException(503, "Unable to infer current zone")

    cand = normalized_candidate_frame(df, driver_lat, driver_lng)
    if cand.empty:
        return {"rows": [], "current_zone_id": current_zone_id}

    supply_maps = build_supply_maps(df)
    cand = score_frame(cand, supply_maps)

    current_row = cand[cand["zone_id"] == current_zone_id]
    current_score = float(current_row["Score"].iloc[0]) if not current_row.empty else None
    cand["Gain"] = cand["Score"] - (current_score if current_score is not None else 0.0)
    cand["move_recommended"] = cand["Gain"] > MIN_GAIN
    cand = cand[cand["zone_id"] != current_zone_id].copy()
    cand.sort_values("Score", ascending=False, inplace=True)
    cand["road_km"] = cand["distance_km"]

    out = cand.head(max(1, int(top_k))).copy()
    rows = []
    for _, r in out.iterrows():
        rows.append({
            "zone_id": int(r["zone_id"]),
            "PULocationID": int(r["zone_id"]),
            "Borough": str(r["Borough"]),
            "Zone": str(r["Zone"]),
            "lat_wgs": float(r["lat_wgs"]),
            "lon_wgs": float(r["lon_wgs"]),
            "pred_rides": float(r[PRED_COL]),
            "priority": float(r["priority"]),
            "distance_km": float(r["distance_km"]),
            "road_km": float(r["road_km"]),
            "zone_supply": int(r["ZoneSupply"]),
            "local_supply": int(r["LocalSupply"]),
            "DemandN": float(r["DemandN"]),
            "PriorityN": float(r["PriorityN"]),
            "DistanceN": float(r["DistanceN"]),
            "ZoneSupplyN": float(r["ZoneSupplyN"]),
            "LocalSupplyN": float(r["LocalSupplyN"]),
            "score": float(r["Score"]),
            "gain": float(r["Gain"]),
            "move_recommended": bool(r["move_recommended"]),
        })

    current_zone = df.loc[df["zone_id"] == current_zone_id].iloc[0]
    return {
        "driver_id": driver_id,
        "driver_name": driver_name,
        "driver_lat": driver_lat,
        "driver_lng": driver_lng,
        "current_zone_id": int(current_zone_id),
        "current_zone": str(current_zone["Zone"]),
        "current_score": current_score,
        "min_gain": MIN_GAIN,
        "formula": {
            "W_DEMAND": W_DEMAND,
            "W_PRIORITY": W_PRIORITY,
            "W_DISTANCE": W_DISTANCE,
            "W_ZONE_SUPPLY": W_ZONE_SUPPLY,
            "W_LOCAL_SUPPLY": W_LOCAL_SUPPLY,
        },
        "rows": rows,
    }


# =========================
# 派遣系統：Register / Login
# =========================
@app.post("/api/register")
def api_register(body: RegisterBody):
    if _find_user(body.username) is not None:
        raise HTTPException(409, "Exists")

    uid = STORE["meta"]["next_user_id"]
    STORE["meta"]["next_user_id"] += 1

    user = {
        "id": uid,
        "username": body.username,
        "password": body.password,
        "role": body.role,
        "createdAt": _now_iso(),
    }
    STORE["users"].append(user)

    if body.role == "driver":
        did = STORE["meta"]["next_driver_id"]
        STORE["meta"]["next_driver_id"] += 1
        STORE["drivers"].append(
            {
                "id": did,
                "name": body.username,
                "carType": body.carType,
                "lat": None,
                "lng": None,
                "updatedAt": _now_iso(),
            }
        )

    save_store()
    return {"ok": True, "user": user}


@app.post("/api/login")
def api_login(body: LoginBody):
    u = _find_user(body.username)
    if not u:
        raise HTTPException(404, detail={"errorCode": "NO_SUCH_ACCOUNT", "error": "Not found"})

    if str(u.get("password", "")) != str(body.password):
        raise HTTPException(401, detail={"errorCode": "BAD_PASSWORD", "error": "Wrong password"})

    return {"ok": True, "user": u}


@app.post("/api/driver-login")
def api_driver_login(body: DriverLoginBody):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Missing name")

    d = _find_driver_by_name(name)
    if d is None:
        did = STORE["meta"]["next_driver_id"]
        STORE["meta"]["next_driver_id"] += 1
        d = {
            "id": did,
            "name": name,
            "carType": body.carType,
            "lat": None,
            "lng": None,
            "updatedAt": _now_iso(),
        }
        STORE["drivers"].append(d)
        save_store()
        return d

    if body.carType is not None:
        d["carType"] = body.carType
    d["updatedAt"] = _now_iso()
    save_store()
    return d

# =========================
# 派遣系統：Orders / Drivers
# =========================
@app.post("/api/orders")
def api_create_order(body: CreateOrderBody):
    oid = STORE["meta"]["next_order_id"]
    STORE["meta"]["next_order_id"] += 1

    order = {
        "id": oid,
        "status": "pending",
        "customer": body.customer or "guest",
        "pickup": body.pickup,
        "dropoff": body.dropoff,
        "pickupLocation": body.pickupLocation.model_dump(),
        "dropoffLocation": body.dropoffLocation.model_dump(),
        "stops": body.stops or [],
        "vehicleType": body.vehicleType,
        "estimatedPrice": body.estimatedPrice,
        "distanceKm": body.distanceKm,
        "createdAt": _now_iso(),
    }
    STORE["orders"].append(order)
    save_store()
    return {"ok": True, "order": order}


@app.post("/api/orders/{order_id}/accept")
def api_accept_order(order_id: int, body: AcceptOrderBody):
    o = _find_order(order_id)
    d = _find_driver(body.driverId)
    if not o or not d:
        raise HTTPException(404, "Not found")

    # 🔒 已被接走的單不能重複接
    if norm_status(o.get("status")) != "pending" or get_order_driver_id(o) is not None:
        raise HTTPException(409, "此訂單已被其他司機接走")

    # 🔒 同一位司機正在跑單時不能再接新單
    if is_driver_busy(body.driverId):
        raise HTTPException(409, "此司機目前已有進行中訂單")

    # 🔒 車種限制（核心）
    if o.get("vehicleType") and d.get("carType") != o.get("vehicleType"):
        raise HTTPException(403, "車種不符合，不能接單")

    now = _now_iso()
    o.update({
        "status": "assigned",
        "driverId": body.driverId,
        "assignedDriverId": body.driverId,
        "updatedAt": now,
    })

    d["status"] = "busy"
    d["updatedAt"] = now

    save_store()

    return {
        "ok": True,
        "order": o,
        "orders": STORE["orders"],
        "drivers": STORE["drivers"],
    }


@app.post("/api/orders/{order_id}/complete")
def api_complete_order(order_id: int):
    o = _find_order(order_id)
    if not o:
        raise HTTPException(404, "Not found")

    now = _now_iso()
    did = get_order_driver_id(o)

    o["status"] = "completed"
    o["completedAt"] = o.get("completedAt") or now
    o["updatedAt"] = now

    if did is not None:
        d = _find_driver(int(did))
        if d:
            final_loc = None

            stops = o.get("stops") or []
            if isinstance(stops, list) and stops:
                last_stop = stops[-1]
                if isinstance(last_stop, dict):
                    final_loc = last_stop.get("loc") or last_stop

            if not final_loc:
                final_loc = o.get("dropoffLocation")

            if isinstance(final_loc, dict):
                lat = final_loc.get("lat")
                lng = final_loc.get("lng")
                try:
                    lat = float(lat)
                    lng = float(lng)
                    d["lat"] = lat
                    d["lng"] = lng
                except Exception:
                    pass

            d["status"] = "idle"
            d["updatedAt"] = now

    save_store()

    return {
        "ok": True,
        "order": o,
        "orders": STORE["orders"],
        "drivers": STORE["drivers"],
    }


@app.patch("/api/drivers/{driver_id}/location")
def api_driver_location(driver_id: int, body: DriverLocationBody):
    d = _find_driver(driver_id)
    if not d:
        raise HTTPException(404, f"找不到 ID 為 {driver_id} 的司機")

    d["lat"] = float(body.lat)
    d["lng"] = float(body.lng)
    d["updatedAt"] = _now_iso()
    save_store()

    return {"ok": True, "updated_driver": d["id"], "name": d["name"]}

@app.post("/api/admin/reset-store")
def api_reset_store():
    seed_default_store()
    return {
        "ok": True,
        "orders": len(STORE["orders"]),
        "drivers": len(STORE["drivers"]),
        "users": len(STORE["users"]),
        "rows": STORE["orders"],
    }

@app.get("/api/orders")
def api_get_orders():
    print(f"📦 /api/orders called, count={len(STORE['orders'])}")
    return {"rows": STORE["orders"]}

@app.get("/api/drivers")
def api_get_drivers():
    return {"rows": STORE["drivers"]}

# =========================
# Pipeline admin
# =========================
@app.post("/api/admin/run-pipeline")
def api_run_pipeline(background_tasks: BackgroundTasks):
    if not STATE["model_ready"]:
        try:
            init_model()
        except Exception as e:
            raise HTTPException(503, f"Model init failed: {e}")

    if STATE["booster"] is None or STATE["hourly"] is None:
        raise HTTPException(503, "Model artifacts not ready")

    def task():
        import pandas as pd
        from logic import run_prediction_task, generate_ranking_reports

        try:

            df_pred = run_prediction_task(
                STATE["booster"],
                STATE["hourly"],
                CENT_PATH,
                OUT_DIR / "pred_next_hour_advanced.csv",
            )

            pred_csv_path = OUT_DIR / "pred_next_hour_advanced.csv"
            if pred_csv_path.exists():
                df_pred = pd.read_csv(pred_csv_path)

            STATE["pred_df"] = df_pred
            upload_to_r2(OUT_DIR / "pred_next_hour_advanced.csv", KEY_OUT_PRED)

            generate_ranking_reports(df_pred, CENT_PATH, OUT_DIR)

            try:
                STATE["hotspots_df"] = build_hotspots_df(
                    STATE["pred_df"],
                    STATE["cent"],
                )
            except Exception as e:
                print(f"⚠️ build_hotspots_df failed: {e}")
                STATE["hotspots_df"] = None

            try:
                refresh_dispatch_zones()
            except Exception as e:
                print(f"⚠️ dispatch zone refresh failed after pipeline: {e}")
                STATE["pred_dispatch_df"] = None

        except Exception as e:
            print(f"❌ Pipeline task failed: {e}")

    background_tasks.add_task(task)
    return {"ok": True, "message": "Pipeline started"}


@app.post("/api/admin/reload-dispatch-zones")
def api_reload_dispatch_zones():
    if not STATE["model_ready"]:
        try:
            init_model()
        except Exception as e:
            raise HTTPException(503, f"Model init failed: {e}")

    try:
        df = get_dispatch_zones(force=True)
    except Exception as e:
        raise HTTPException(503, f"Reload dispatch zones failed: {e}")

    return {
        "ok": True,
        "zones_loaded_at": STATE.get("dispatch_zones_loaded_at"),
        "rows": len(df),
    }

# =========================
# Route
# =========================
ROAD_SNAP_DEFAULT_MAX_DISTANCE_M = 100.0
ROAD_SNAP_FAIL_MESSAGE = "此位置離可行駛道路太遠，請點選道路附近。"


@app.get("/api/snap-road")
async def api_snap_road(lat: float, lng: float, max_distance_m: float = ROAD_SNAP_DEFAULT_MAX_DISTANCE_M):
    max_dist = float(max_distance_m) if max_distance_m and max_distance_m > 0 else ROAD_SNAP_DEFAULT_MAX_DISTANCE_M

    def fail(message: str = ROAD_SNAP_FAIL_MESSAGE, *, distance_m=None, road_name="", snapped_lat=None, snapped_lng=None):
        return {
            "ok": False,
            "lat": float(lat),
            "lng": float(lng),
            "snapped_lat": snapped_lat,
            "snapped_lng": snapped_lng,
            "distance_m": distance_m,
            "road_name": road_name or "",
            "message": message,
        }

    try:
        url = (
            "https://router.project-osrm.org/nearest/v1/driving/"
            f"{lng},{lat}"
            "?number=1"
        )

        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers={"User-Agent": "taxi-app"})
            r.raise_for_status()
            data = r.json()

        waypoints = data.get("waypoints") or []
        if data.get("code") != "Ok" or not waypoints:
            return fail("找不到附近可行駛道路，請點選道路附近。")

        wp = waypoints[0]
        loc = wp.get("location") or []
        if len(loc) < 2:
            return fail("找不到附近可行駛道路，請點選道路附近。")

        snapped_lng = float(loc[0])
        snapped_lat = float(loc[1])
        distance_m = float(wp.get("distance") or 0.0)
        road_name = str(wp.get("name") or "").strip()

        if distance_m > max_dist:
            return fail(
                ROAD_SNAP_FAIL_MESSAGE,
                distance_m=distance_m,
                road_name=road_name,
                snapped_lat=snapped_lat,
                snapped_lng=snapped_lng,
            )

        road_label = road_name or "最近道路"
        return {
            "ok": True,
            "lat": float(lat),
            "lng": float(lng),
            "snapped_lat": snapped_lat,
            "snapped_lng": snapped_lng,
            "distance_m": distance_m,
            "road_name": road_name,
            "message": f"已自動移到最近道路：{road_label}" if distance_m > 1 else "位置已確認在可行駛道路附近。",
        }
    except Exception as e:
        print(f"⚠️ snap-road api failed: {e}")
        return fail("道路定位服務暫時無法使用，請稍後再試。")


@app.get("/api/route")
async def api_route(fromLat: float, fromLng: float, toLat: float, toLng: float):
    try:
        url = (
            "https://router.project-osrm.org/route/v1/driving/"
            f"{fromLng},{fromLat};{toLng},{toLat}"
            "?overview=full&geometries=geojson"
        )

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, headers={"User-Agent": "taxi-app"})
            r.raise_for_status()
            data = r.json()

        routes = data.get("routes") or []
        if not routes:
            return {"coords": [], "dist": None}

        route = routes[0]
        geometry = route.get("geometry", {})
        raw_coords = geometry.get("coordinates") or []

        coords = []
        for item in raw_coords:
            try:
                lng, lat = item
                coords.append([float(lat), float(lng)])
            except Exception:
                continue

        dist = route.get("distance")
        dist_km = float(dist) / 1000.0 if dist is not None else None
        duration = route.get("duration")
        duration_sec = float(duration) if duration is not None else None

        return {
            "coords": coords,
            "dist": dist_km,
            "duration_sec": duration_sec,
            "duration_min": (duration_sec / 60.0) if duration_sec is not None else None,
        }
    except Exception as e:
        print(f"⚠️ route api failed: {e}")
        return {"coords": [], "dist": None}
    
# =========================
# Reverse Geocode
# =========================
@app.get("/api/reverse-geocode")
async def api_reverse_geocode(lat: float, lng: float):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": lat,
                    "lon": lng,
                    "format": "jsonv2",
                    "zoom": 18,
                    "addressdetails": 1,
                },
                headers={"User-Agent": "taxi-app"},
            )
            r.raise_for_status()
            data = r.json()

        address = data.get("address") or {}
        name_parts = [
            address.get("house_number"),
            address.get("road"),
            address.get("neighbourhood") or address.get("suburb"),
            address.get("city") or address.get("borough"),
        ]
        short_label = ", ".join([str(x) for x in name_parts if x])
        label = short_label or data.get("display_name") or f"地圖定位 {lat:.6f}, {lng:.6f}"

        return {
            "label": label,
            "display_name": data.get("display_name") or label,
            "lat": float(lat),
            "lng": float(lng),
        }
    except Exception as e:
        print(f"⚠️ reverse geocode failed: {e}")
        return {
            "label": f"地圖定位 {lat:.6f}, {lng:.6f}",
            "lat": float(lat),
            "lng": float(lng),
        }
    
# =========================
# Geocode
# =========================
@app.get("/api/geocode")
async def api_geocode(q: str):
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q, "format": "jsonv2", "limit": 5},
                headers={"User-Agent": "taxi-app"},
            )
            data = r.json()
            out = []
            for x in (data or []):
                try:
                    out.append({"label": x["display_name"], "lat": float(x["lat"]), "lng": float(x["lon"])})
                except Exception:
                    continue
            return out if out else [{"label": "Times Square", "lat": 40.758, "lng": -73.9855}]
        except Exception:
            return [{"label": "Times Square", "lat": 40.758, "lng": -73.9855}]
