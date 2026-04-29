# iPhone 外網操控部署說明

這個專案用 Render 正式部署成兩個服務：

- 後端：FastAPI Web Service
- 前端：Vite Static Site

iPhone 只需要開前端公開網址，例如 `https://taxi-dispatch-frontend.onrender.com`。所有 API 會透過 `VITE_API_BASE` 打到 Render 後端，不依賴本機 `127.0.0.1`、`localhost` 或同 Wi-Fi。

## 1. 後端 Render Web Service

Render 設定：

```text
Root Directory: taxi-hotspot-backend_改版/taxi-hotspot-backend_改版
Build Command: pip install -r requirements.txt
Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
Python Runtime: python-3.11.9
```

Environment variables：

```text
MODEL_ENABLED=1
R2_ENDPOINT=你的 R2 endpoint
R2_BUCKET=你的 R2 bucket
AWS_ACCESS_KEY_ID=你的 R2 access key
AWS_SECRET_ACCESS_KEY=你的 R2 secret key
```

部署後先測：

```text
https://你的後端服務.onrender.com/api/health
https://你的後端服務.onrender.com/api/snap-road?lat=40.758&lng=-73.9855
https://你的後端服務.onrender.com/api/orders
https://你的後端服務.onrender.com/api/drivers
```

`/api/health` 應回 `ok:true`，模型載入成功時會看到 `model_ready:true`。

## 2. 前端 Render Static Site

Render 設定：

```text
Root Directory: taxi-dispatch-frontend_改版/taxi-dispatch-frontend_改版
Build Command: npm install && npm run build
Publish Directory: dist
```

Environment variable：

```text
VITE_API_BASE=https://你的後端服務.onrender.com
```

如果前端部署後不是在 localhost 開啟，而且沒有設定 `VITE_API_BASE`，畫面會顯示「API 尚未設定」。這是正常保護，避免手機外網誤打 `127.0.0.1`。

## 3. iPhone 展示流程

1. 用 Safari 或 Chrome 開前端公開網址。
2. 進入乘客端，規劃上車點、目的地與車型。
3. 進入司機端，在地圖道路附近設定司機初始位置。
4. 乘客建立訂單後，司機端接單並查看車輛模擬。
5. 使用行動網路測試一次，確認不依賴電腦或同 Wi-Fi。

## 4. 常見問題

### 手機顯示 API 尚未設定

到 Render 前端 Static Site 的 Environment 頁面加入：

```text
VITE_API_BASE=https://你的後端服務.onrender.com
```

重新部署前端。

### 手機顯示目前無法連線到伺服器

先打開後端：

```text
https://你的後端服務.onrender.com/api/health
```

Render 免費服務冷啟動可能需要 30-60 秒。等後端醒來後重新整理前端。

### CORS 錯誤

後端目前允許跨來源 API 呼叫，正常不會擋 Render 前端。如果有錯，確認手機前端打到的是 Render 後端網址，不是 `127.0.0.1:8000`。

### 公園或非道路區域不能放車

這是預期行為。司機初始位置、乘客上車點、目的地和中途停靠點都會先經過 `/api/snap-road`，離可行駛道路太遠會被阻擋。
