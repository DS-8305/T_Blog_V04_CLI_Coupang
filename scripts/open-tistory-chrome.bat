@echo off
chcp 65001 >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9224 --user-data-dir="%APPDATA%\tistory-blog-auto-v01\browser-profile" --no-first-run --no-default-browser-check https://www.tistory.com/auth/login
