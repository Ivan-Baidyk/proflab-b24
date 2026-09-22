#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=============================================="
echo "  Установка виджета формирования КП (Bitrix24)"
echo "=============================================="
echo

prompt() {
  local label="$1"
  local def="$2"
  local val=""
  if [ -n "$def" ]; then
    printf '%s [%s]: ' "$label" "$def"
  else
    printf '%s: ' "$label"
  fi
  read -r val
  if [ -z "$val" ] && [ -n "$def" ]; then
    val="$def"
  fi
  printf '%s' "$val"
}

urlencode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

# --- параметры (можно задать через переменные окружения, иначе спросит) ---
B24_REDIRECT_URI="$(prompt "Публичный URL виджета (redirect_uri)" "${B24_REDIRECT_URI:-}")"
B24_DOMAIN="$(prompt "Домен портала Bitrix24" "${B24_DOMAIN:-}")"
B24_CLIENT_ID="$(prompt "Код приложения (client_id)" "${B24_CLIENT_ID:-}")"
B24_CLIENT_SECRET="$(prompt "Ключ приложения (client_secret)" "${B24_CLIENT_SECRET:-}")"
WEBHOOK_SEARCH_URL="$(prompt "Вебхук «Поиск каталога»" "${WEBHOOK_SEARCH_URL:-}")"
WEBHOOK_LOAD_URL="$(prompt "Вебхук «Загрузка КП»" "${WEBHOOK_LOAD_URL:-}")"
WEBHOOK_CREATE_URL="$(prompt "Вебхук «Создание КП»" "${WEBHOOK_CREATE_URL:-}")"
WEBHOOK_UNITS_URL="$(prompt "Вебхук «Единицы измерения»" "${WEBHOOK_UNITS_URL:-}")"

echo
echo "--- Проверка параметров ---"
for v in B24_DOMAIN B24_CLIENT_ID B24_CLIENT_SECRET B24_REDIRECT_URI WEBHOOK_SEARCH_URL WEBHOOK_LOAD_URL WEBHOOK_CREATE_URL WEBHOOK_UNITS_URL; do
  if [ -z "${!v}" ]; then
    echo "ОШИБКА: параметр $v не заполнен"
    exit 1
  fi
done
echo "OK"

# --- запись .env ---
cat > .env <<EOF
B24_DOMAIN=${B24_DOMAIN}
B24_REDIRECT_URI=${B24_REDIRECT_URI}
B24_CLIENT_ID=${B24_CLIENT_ID}
B24_CLIENT_SECRET=${B24_CLIENT_SECRET}
WEBHOOK_SEARCH_URL=${WEBHOOK_SEARCH_URL}
WEBHOOK_LOAD_URL=${WEBHOOK_LOAD_URL}
WEBHOOK_CREATE_URL=${WEBHOOK_CREATE_URL}
WEBHOOK_UNITS_URL=${WEBHOOK_UNITS_URL}
EOF
chmod 600 .env
echo ".env записан"

# --- сборка и запуск ---
echo
echo "--- Сборка Docker-образа ---"
docker build -t proflab-b24-app .

echo "--- Запуск контейнера ---"
docker rm -f proflab-b24 >/dev/null 2>&1 || true
docker run -d --name proflab-b24 \
  --network global-proxy-network \
  -v "$(pwd):/opt/proflab-b24" \
  --restart unless-stopped \
  proflab-b24-app

echo
echo "=============================================="
echo "  Авторизация OAuth"
echo "=============================================="
REDIRECT_ENC="$(urlencode "$B24_REDIRECT_URI")"
echo "Открой в браузере (залогинен в Bitrix24):"
echo
echo "  https://${B24_DOMAIN}/oauth/authorize/?client_id=${B24_CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_ENC}"
echo
echo "После «Разрешить» сервер сам обменяет код и зарегистрирует вкладку «Формирование КП»."
