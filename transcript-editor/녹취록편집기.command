#!/bin/bash
# 더블클릭하면 녹취록 편집기가 열립니다. (맥 전용 실행 파일)
cd "$(dirname "$0")" || exit 1

# 인터넷에서 내려받은 파일에 붙는 '격리' 표시를 풀어 줍니다(실패해도 무시).
xattr -dr com.apple.quarantine . >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(+process.versions.node.split(".")[0]>=18?0:1)'; then
  osascript -e 'display dialog "Node.js(18 이상)가 필요합니다.\n확인을 누르면 설치 페이지가 열립니다. 설치한 뒤 이 파일을 다시 더블클릭하세요." buttons {"확인"} default button 1 with icon caution' >/dev/null 2>&1
  open "https://nodejs.org/ko/download"
  exit 1
fi

if [ ! -d node_modules/@anthropic-ai/sdk ]; then
  echo "처음 한 번만 필요한 구성요소를 설치합니다. 잠시만 기다려 주세요…"
  npm install --no-audit --no-fund || { echo; echo "설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요."; read -n 1 -s -r -p "아무 키나 누르면 닫습니다."; exit 1; }
fi

node server.mjs
status=$?
echo
read -n 1 -s -r -p "종료되었습니다. 아무 키나 누르면 창이 닫힙니다."
exit $status
