@echo off
cd /d C:\name
set EXPO_PACKAGER_HOSTNAME=172.26.140.69
set EXPO_PORT=8081
set AI_SERVER_PORT=8787
set CI=1
"C:\Users\heoju\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/start-dev-ai.mjs > C:\name\dev-ai.log 2> C:\name\dev-ai.err.log
