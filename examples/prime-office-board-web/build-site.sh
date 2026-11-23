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

# ホーム画面とタブのマーク。その会社のぶんがあれば差し替える。
# 無い会社（PRIME から引き継いだ元のアイコン）はそのまま。
ICON=""
if [ -f "$D/icon-192.$N.png" ] && [ -f "$D/icon-512.$N.png" ]; then
  cp "$D/icon-192.$N.png" "$D/icon-192.png"
  cp "$D/icon-512.$N.png" "$D/icon-512.png"
  ICON=1
fi

pick(){ sed -n "s/^[[:space:]]*$1:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$D/config.js" | head -n 1; }
BRAND=$(pick brand)
SUB=$(pick brandSub)
THEME=$(pick themeColor)
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

# その会社のアイコンがあるときだけ、タブのマークも絵文字からそれに替える。
if [ -n "$ICON" ]; then
  sed -i.bak -e "s|rel=\"icon\" href=\"[^\"]*\"|rel=\"icon\" href=\"./icon-192.png\"|" "$D/index.html"
fi
sed -i.bak \
  -e "s/\"name\": \"[^\"]*\"/\"name\": \"$T\"/" \
  -e "s/\"short_name\": \"[^\"]*\"/\"short_name\": \"$B\"/" \
  "$D/manifest.webmanifest"

# 起動時の下地の色。config に themeColor があるボードだけ替える。
if [ -n "$THEME" ]; then
  C=$(esc "$THEME")
  sed -i.bak \
    -e "s/\"background_color\": \"[^\"]*\"/\"background_color\": \"$C\"/" \
    -e "s/\"theme_color\": \"[^\"]*\"/\"theme_color\": \"$C\"/" \
    "$D/manifest.webmanifest"
fi
rm -f "$D/index.html.bak" "$D/manifest.webmanifest.bak"
echo "built: $TITLE"
