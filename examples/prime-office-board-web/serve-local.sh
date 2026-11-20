#!/bin/sh
# 手元で画面だけ見るための簡易サーバー。公開には関係しない。
# 使い方: sh serve-local.sh <会社名> [ポート]
# build-site.sh で config.js を差し替えた写しを作り、そこを配る。
# 本番の Supabase につなぐので、ログイン前の画面を見るだけに使う。
set -e
N=${1:-libregate}
PORT=${2:-8777}
D=$(dirname "$0")
OUT="${TMPDIR:-/tmp}/office-board-local-$N"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$D"/. "$OUT"/
cd "$OUT"
sh build-site.sh "$N" >/dev/null
echo "serving $N on http://localhost:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
