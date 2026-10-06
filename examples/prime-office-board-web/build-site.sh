#!/bin/sh
# 設置ごとの公開用ビルド。Render の Build Command から呼ぶ。
#   sh examples/prime-office-board-web/build-site.sh fujisawa
#
# config.<名前>.js を config.js にし、ページを開く前に読まれる名前
# （URL を LINE などに貼ったときの題名、ホーム画面に置いたときの名前）を、
# その config の brand / brandSub に書き換える。JS が動く前に読まれる所なので、
# 画面の「設定」で名前を変えても、ここは次の公開まで変わらない。
# PRIME は Build Command がこのスクリプトを呼ばないので、何も変わらない。
set -e
D=$(dirname "$0")
N="$1"
if [ -z "$N" ] || [ ! -f "$D/config.$N.js" ]; then
  echo "config.$N.js がありません" >&2
  exit 1
fi
cp "$D/config.$N.js" "$D/config.js"

pick(){ sed -n "s/^[[:space:]]*$1:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$D/config.js" | head -n 1; }
BRAND=$(pick brand)
SUB=$(pick brandSub)
[ -n "$BRAND" ] || BRAND="ボード"
TITLE=$(printf '%s %s' "$BRAND" "$SUB" | sed 's/ *$//')

# sed の置き換え先に入る / と & を逃がす
esc(){ printf '%s' "$1" | sed 's/[\/&]/\\&/g'; }
T=$(esc "$TITLE")
B=$(esc "$BRAND")

sed -i.bak \
  -e "s/<title>[^<]*<\\/title>/<title>$T<\\/title>/" \
  -e "s/name=\"apple-mobile-web-app-title\" content=\"[^\"]*\"/name=\"apple-mobile-web-app-title\" content=\"$B\"/" \
  -e "s/content=\"スタッフ用 共有ボード\"/content=\"$T\"/" \
  "$D/index.html"
sed -i.bak \
  -e "s/\"name\": \"[^\"]*\"/\"name\": \"$T\"/" \
  -e "s/\"short_name\": \"[^\"]*\"/\"short_name\": \"$B\"/" \
  "$D/manifest.webmanifest"
rm -f "$D/index.html.bak" "$D/manifest.webmanifest.bak"
echo "built: $TITLE"
