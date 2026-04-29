@echo off
chcp 65001 >nul
title Taxi Dispatch Frontend 啟動器

echo ========================================
echo Taxi Dispatch Frontend 一鍵啟動器
echo ========================================
echo.

REM 自動切到這個 bat 所在資料夾
cd /d "%~dp0"

echo 目前資料夾：%cd%
echo.

REM 檢查 package.json
if not exist "package.json" (
    echo [錯誤] 找不到 package.json
    echo 請把這個 start_frontend.bat 放到 taxi-dispatch-frontend 專案資料夾裡面。
    echo 也就是跟 package.json 同一層。
    echo.
    pause
    exit /b 1
)

REM 檢查 npm 是否存在
where npm >nul 2>nul
if errorlevel 1 (
    echo [錯誤] 找不到 npm 指令。
    echo 請先安裝 Node.js LTS 版本，並確認安裝時有勾選 Add to PATH。
    echo 下載： https://nodejs.org/
    echo 安裝完成後，請關掉 PowerShell / CMD 再重開。
    echo.
    pause
    exit /b 1
)

echo [OK] npm 已找到
npm -v
echo.

REM 如果沒有 node_modules，自動 npm install
if not exist "node_modules" (
    echo 偵測到尚未安裝前端套件，正在執行 npm install...
    npm install
    if errorlevel 1 (
        echo.
        echo [錯誤] npm install 失敗，請把上方錯誤截圖給我。
        pause
        exit /b 1
    )
) else (
    echo [OK] node_modules 已存在，略過 npm install
)

echo.
echo 即將啟動前端...
echo 網址通常是：http://localhost:5173/
echo.

REM 延遲開瀏覽器，避免 Vite 還沒啟動完成
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173/"

npm run dev

echo.
echo 前端已停止。
pause
EOF
zip -j /mnt/data/start_frontend_launcher.zip /mnt/data/start_frontend.bat
ls -l /mnt/data/start_frontend_launcher.zip /mnt/data/start_frontend.bat
