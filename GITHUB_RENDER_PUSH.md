# GitHub + Render Push Checklist

## What goes to GitHub

Push the cleaned project root with:

- `render.yaml`
- `MOBILE_DEPLOY.md`
- `GITHUB_RENDER_PUSH.md`
- `taxi-hotspot-backend_改版/taxi-hotspot-backend_改版`
- `taxi-dispatch-frontend_改版/taxi-dispatch-frontend_改版`

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
VITE_API_BASE=https://你的後端服務.onrender.com
```

## Commands after an empty GitHub repo is created

Replace the URL with your empty GitHub repository:

```powershell
git remote add origin https://github.com/你的帳號/taxi-smartdispatch.git
git branch -M main
git push -u origin main
```
