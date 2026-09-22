import os, json, urllib.request, urllib.error, urllib.parse
from flask import Flask, request, redirect, send_from_directory

app = Flask(__name__)
BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
ENV = os.path.join(BASE, ".env")


def read_env():
    e = {}
    try:
        for line in open(ENV):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                e[k] = v.strip()
    except Exception:
        pass
    return e


def cfg():
    e = read_env()
    return {
        "client_id": e.get("B24_CLIENT_ID", ""),
        "client_secret": e.get("B24_CLIENT_SECRET", ""),
        "domain": e.get("B24_DOMAIN", ""),
        "redirect_uri": e.get("B24_REDIRECT_URI", ""),
        "webhook_search": e.get("WEBHOOK_SEARCH_URL", ""),
        "webhook_load": e.get("WEBHOOK_LOAD_URL", ""),
        "webhook_create": e.get("WEBHOOK_CREATE_URL", ""),
    }


def exchange(code, domain, cid, csec):
    endpoints = [
        "https://oauth.bitrix24.tech/oauth/token/",
        "https://" + domain + "/oauth/token/",
    ]
    for ep in endpoints:
        data = urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "client_id": cid,
            "client_secret": csec,
            "code": code,
        }).encode()
        req = urllib.request.Request(ep, data=data,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                t = json.loads(r.read())
                if "access_token" in t:
                    return t
        except Exception:
            continue
    return None


def bind(access, domain, handler):
    body = json.dumps({
        "auth": access,
        "PLACEMENT": "CRM_DEAL_DETAIL_TAB",
        "HANDLER": handler,
        "TITLE": "Формирование КП",
    }).encode()
    req = urllib.request.Request("https://" + domain + "/rest/placement.bind", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode()
    except urllib.error.HTTPError as e:
        return "HTTP %d %s" % (e.code, e.read().decode()[:300])


def extract_entity_id():
    v = request.values
    for k in ("PLACEMENT_OPTIONS[ID]", "PLACEMENT_OPTIONS_ID", "ENTITY_ID", "ID"):
        val = v.get(k, "")
        if val:
            return str(val)
    po = v.get("PLACEMENT_OPTIONS", "")
    if po:
        try:
            j = json.loads(po)
            if isinstance(j, dict):
                return str(j.get("ID", "") or j.get("id", ""))
        except Exception:
            pass
    return ""


def is_bitrix24_context():
    if request.values.get("code"):
        return True
    if request.values.get("APP_SID") or request.values.get("PLACEMENT") or request.values.get("PLACEMENT_OPTIONS"):
        return True
    return False


DENIED = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Доступ запрещён</title></head>
<body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f5f7">
<div style="text-align:center;color:#666;max-width:420px;padding:20px">
<h2 style="color:#333">Доступ только из Bitrix24</h2>
<p>Этот виджет работает внутри карточки сделки Bitrix24 (вкладка «Формирование КП»). Прямой доступ по ссылке закрыт.</p>
</div></body></html>"""

INSTALL_OK = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Установка завершена</title></head>
<body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f5f7">
<div style="text-align:center;color:#666;max-width:460px;padding:20px">
<h2 style="color:#2fa33a">Установка завершена</h2>
<p>Вкладка «Формирование КП» зарегистрирована в карточке сделки. Откройте любую сделку, чтобы проверить.</p>
</div></body></html>"""


@app.route("/", methods=["GET", "POST"])
def index():
    c = cfg()

    code = request.values.get("code", "")
    domain = request.values.get("domain", "") or c["domain"]
    if code:
        app.logger.info("OAuth code received, exchanging...")
        t = exchange(code, domain, c["client_id"], c["client_secret"])
        if t:
            ak = "B24_ACCESS" + "_TOKEN"
            rk = "B24_REFRESH" + "_TOKEN"
            with open(ENV, "a") as f:
                f.write(ak + "=" + t["access_token"] + chr(10))
                f.write(rk + "=" + t.get("refresh_token", "") + chr(10))
            os.chmod(ENV, 0o600)
            result = bind(t["access_token"], domain, c["redirect_uri"])
            app.logger.info("placement.bind result: %s", result)
            return INSTALL_OK, 200, {"Content-Type": "text/html; charset=utf-8"}

        return "OAuth exchange failed", 500

    if not is_bitrix24_context():
        return DENIED, 403, {"Content-Type": "text/html; charset=utf-8"}

    entity_id = extract_entity_id()
    placement = request.values.get("PLACEMENT", "") or request.values.get("placement", "")

    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    config = {
        "entity_id": entity_id,
        "placement": placement,
        "webhook_search": c["webhook_search"],
        "webhook_load": c["webhook_load"],
        "webhook_create": c["webhook_create"],
    }
    inject = "<script>window.AI_CONFIG = " + json.dumps(config, ensure_ascii=False) + ";</script>"
    html = html.replace("</head>", inject + "</head>")
    return html


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)
