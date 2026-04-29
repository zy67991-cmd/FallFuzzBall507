import os
from pathlib import Path

import boto3
from dotenv import load_dotenv


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

REQUIRED_ENV = (
    "R2_ENDPOINT",
    "R2_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
)

FILES_TO_UPLOAD = {
    BASE_DIR / "data/test_hourly.parquet": "data/test_hourly.parquet",
    BASE_DIR / "data/taxi_zone_centroids.csv": "meta/taxi_zone_centroids.csv",
    BASE_DIR / "model/xgb_demand_poisson.model": "model/xgb_demand_poisson.model",
    BASE_DIR / "outputs/pred_next_hour_advanced.csv": "outputs/pred_next_hour_advanced.csv",
    BASE_DIR / "outputs/next_hour_rank_top20.csv": "outputs/next_hour_rank_top20.csv",
    BASE_DIR / "outputs/heatmap.html": "outputs/heatmap.html",
}


def _require_env():
    values = {name: os.getenv(name) for name in REQUIRED_ENV}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise RuntimeError(
            "Missing required R2 environment variables: " + ", ".join(missing)
        )
    return values


def _content_type(path: Path):
    if path.suffix == ".html":
        return "text/html"
    if path.suffix == ".csv":
        return "text/csv"
    if path.suffix == ".parquet":
        return "application/octet-stream"
    return None


def upload_files():
    env = _require_env()
    print(f"Uploading project artifacts from {BASE_DIR} to R2...")

    s3 = boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
        region_name=os.getenv("AWS_DEFAULT_REGION", "auto"),
    )

    for local_path, r2_key in FILES_TO_UPLOAD.items():
        if not local_path.exists():
            print(f"Skip missing file: {local_path}")
            continue

        extra_args = {}
        content_type = _content_type(local_path)
        if content_type:
            extra_args["ContentType"] = content_type

        print(f"Upload {local_path.name} -> {r2_key}")
        s3.upload_file(
            str(local_path),
            env["R2_BUCKET"],
            r2_key,
            ExtraArgs=extra_args,
        )

    print("R2 upload complete.")


if __name__ == "__main__":
    upload_files()
