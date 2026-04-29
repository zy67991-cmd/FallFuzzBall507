# GitHub + Render Push Checklist

## What goes to GitHub

Push the cleaned project root with:

- `render.yaml`
- `MOBILE_DEPLOY.md`
- `GITHUB_RENDER_PUSH.md`
- `backend`
- `frontend`

Do not push:

- `.env`
- `.venv`
- `node_modules`
- `dist`
- `*.zip`
- backend `data/`, `model/`, `outputs/`, `rewards/`, `MOD/`

The backend downloads model artifacts from R2 at Render startup.

## Required Render backend env vars

```text
PYTHON_VERSION=3.11.9
MODEL_ENABLED=1
R2_ENDPOINT=
R2_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

## Required Render frontend env vars

```text
VITE_API_BASE=https://your-backend-service.onrender.com
```
