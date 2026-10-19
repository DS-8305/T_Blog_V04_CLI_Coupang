@echo off
chcp 65001 >nul
echo ========================================================
echo  [티스토리 자동화 전용 크롬 (포트 9224) 실행]
echo ========================================================
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9224 --user-data-dir="%APPDATA%\tistory-blog-auto-v01\browser-profile" --no-first-run --no-default-browser-check https://www.tistory.com/auth/login
echo.
echo 전용 크롬 창이 열렸습니다.
echo 화면에 뜬 크롬 창에서 카카오/티스토리 로그인을 완료해 주세요.
echo 로그인을 완료한 뒤 창을 닫지 마시고 유지해 주세요.
echo ========================================================
pause
