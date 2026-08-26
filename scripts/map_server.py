#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local editor server: auth, per-user projects, OSM search."""
from __future__ import annotations

import json
import sys
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import map_accounts as acc  # noqa: E402
import map_catalog as cat  # noqa: E402
import map_publish as pub  # noqa: E402
import map_themes as themes  # noqa: E402
import nasedniki_map as nas  # noqa: E402

HOST = "127.0.0.1"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    def _cors_headers(self) -> list[tuple[str, str]]:
        origin = (self.headers.get("Origin") or "").strip()
        allow = origin if origin else "*"
        return [
            ("Access-Control-Allow-Origin", allow),
            ("Access-Control-Allow-Credentials", "true"),
            ("Access-Control-Allow-Headers", "Content-Type"),
            ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
            ("Access-Control-Allow-Private-Network", "true"),
            ("Vary", "Origin"),
        ]

    def _json(self, code: int, obj, extra_headers: list[tuple[str, str]] | None = None) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in self._cors_headers() + (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in self._cors_headers():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def _send_svg(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in self._cors_headers():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _q_ids(self, u) -> list[str]:
        raw = (parse_qs(u.query).get("ids") or [""])[0]
        return [x.strip() for x in raw.split(",") if x.strip()]

    def _q_theme(self, u) -> str:
        q = parse_qs(u.query)
        return (q.get("theme") or q.get("style") or ["atlas-plain"])[0]

    def _q_ver(self, u) -> int | None:
        raw = (parse_qs(u.query).get("version") or [""])[0]
        return int(raw) if raw.isdigit() else None

    def _v1_get(self, u) -> bool:
        path = u.path.rstrip("/") or "/"
        theme = self._q_theme(u)
        ids = self._q_ids(u)
        ver = self._q_ver(u)
        if path in ("/v1/maps",):
            self._json(200, {"maps": pub.list_maps()})
            return True
        if path in ("/v1/themes",):
            self._json(200, {"themes": themes.list_themes()})
            return True
        if path.startswith("/v1/themes/"):
            tid = path.split("/")[-1]
            self._json(200, themes.get_theme(tid))
            return True
        if not path.startswith("/v1/maps/"):
            return False
        rest = path[len("/v1/maps/") :]
        as_svg = rest.endswith(".svg")
        if as_svg:
            rest = rest[:-4]
        parts = [p for p in rest.split("/") if p]
        if not parts:
            self._json(200, {"maps": pub.list_maps()})
            return True
        mid = unquote(parts[0])
        try:
            geom = pub.filter_zones(pub.load_geometry(mid, ver), ids)
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return True
        if as_svg or (len(parts) == 2 and parts[1] == "svg"):
            self._send_svg(themes.render_svg(geom, theme).encode("utf-8"))
            return True
        if len(parts) == 1:
            self._json(
                200,
                {
                    "id": geom.get("id"),
                    "title": geom.get("title"),
                    "version": geom.get("version"),
                    "viewBox": geom.get("viewBox"),
                    "zones": len(geom.get("zones") or []),
                    "theme_default": "atlas-plain",
                },
            )
            return True
        if parts[1] == "outline":
            self._json(200, pub.outline_from_geom(geom))
            return True
        if parts[1] == "geometry":
            self._json(200, geom)
            return True
        self._json(404, {"error": "нет маршрута /v1"})
        return True

    def _nasedniki_get(self, u) -> bool:
        path = u.path.rstrip("/") or "/"
        if path in ("/nasedniki", "/nasedniki/map"):
            self.send_response(302)
            self.send_header("Location", "/prototype/cartographer.html")
            self.end_headers()
            return True
        q = parse_qs(u.query)
        style = (q.get("style") or q.get("theme") or ["nasedniki-journal"])[0]
        ids = self._q_ids(u)
        ver = self._q_ver(u)
        mid = (q.get("map") or ["samara"])[0]
        try:
            if path in ("/nasedniki/api/map.svg", "/nasedniki/map.svg"):
                self._send_svg(
                    nas.assemble_svg(mid, style, ids, ver).encode("utf-8")
                )
                return True
            if path in ("/nasedniki/api/map", "/nasedniki/api"):
                self._json(200, nas.assemble(mid, style, ids, ver))
                return True
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
            return True
        return False

    def _user(self) -> dict | None:
        return acc.user_from_token(acc.cookie_token(self.headers.get("Cookie")))

    def _need_user(self) -> dict | None:
        u = self._user()
        if not u:
            self._json(401, {"error": "войди в аккаунт"})
            return None
        cat.set_maps_root(acc.user_maps(u["id"]))
        return u

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/me":
                user = self._user()
                if not user:
                    self._json(200, {"user": None})
                    return
                prof = acc.load_profile(user["id"])
                cat.set_maps_root(acc.user_maps(user["id"]))
                cat.import_shared_projects()
                self._json(
                    200,
                    {
                        "user": user,
                        "last_slug": prof.get("last_slug") or "",
                        "maps": cat.load_catalog().get("maps") or [],
                    },
                )
                return
            if u.path == "/api/maps":
                user = self._need_user()
                if not user:
                    return
                cat.import_shared_projects()
                self._json(200, cat.load_catalog())
                return
            if u.path == "/api/search":
                if not self._user():
                    self._json(401, {"error": "войди в аккаунт"})
                    return
                q = (parse_qs(u.query).get("q") or [""])[0].strip()
                if not q:
                    self._json(400, {"error": "пустой запрос"})
                    return
                try:
                    self._json(200, {"hits": cat.search_regions(q)})
                except Exception as e:
                    self._json(502, {"error": str(e)})
                return
            if u.path in ("/api/svg", "/api/project"):
                user = self._need_user()
                if not user:
                    return
                slug = (parse_qs(u.query).get("slug") or [""])[0].strip()
                try:
                    bundle = cat.load_project_bundle(slug)
                except FileNotFoundError:
                    self._json(404, {"error": "нет svg"})
                    return
                except RuntimeError as e:
                    self._json(400, {"error": str(e)})
                    return
                acc.save_profile(user["id"], {"last_slug": slug})
                if u.path == "/api/svg":
                    body = bundle["svg"].encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self._json(200, bundle)
                return
            if u.path.startswith("/v1/"):
                if not self._v1_get(u):
                    self._json(404, {"error": "нет /v1"})
                return
            if u.path.startswith("/nasedniki"):
                if not self._nasedniki_get(u):
                    self._json(404, {"error": "нет /nasedniki"})
                return
            if u.path == "/" or u.path == "/editor":
                self.send_response(302)
                self.send_header("Location", "/prototype/cartographer.html")
                self.end_headers()
                return
            super().do_GET()
        finally:
            cat.set_maps_root(None)

    def do_POST(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/auth":
                body = self._read_json()
                action = (body.get("action") or "").strip()
                try:
                    if action == "register":
                        user = acc.register(body.get("name") or "", body.get("password") or "")
                        token, user = acc.login(user["name"], body.get("password") or "")
                        self._json(
                            200,
                            {"ok": True, "user": user},
                            extra_headers=[("Set-Cookie", acc.set_cookie_header(token))],
                        )
                        return
                    if action == "login":
                        token, user = acc.login(
                            body.get("name") or "", body.get("password") or ""
                        )
                        self._json(
                            200,
                            {"ok": True, "user": user},
                            extra_headers=[("Set-Cookie", acc.set_cookie_header(token))],
                        )
                        return
                    if action == "logout":
                        acc.logout(acc.cookie_token(self.headers.get("Cookie")))
                        self._json(
                            200,
                            {"ok": True},
                            extra_headers=[("Set-Cookie", acc.clear_cookie_header())],
                        )
                        return
                except RuntimeError as e:
                    self._json(400, {"error": str(e)})
                    return
                self._json(400, {"error": "нужен action login/register/logout"})
                return
            if u.path == "/api/pen-log":
                body = self._read_json()
                logp = ROOT / "prototype" / "pen-session.jsonl"
                logp.parent.mkdir(parents=True, exist_ok=True)
                with logp.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(body, ensure_ascii=False) + "\n")
                n = sum(1 for _ in logp.open(encoding="utf-8"))
                self._json(200, {"ok": True, "n": n})
                return
            if u.path.startswith("/v1/maps/") and u.path.rstrip("/").endswith("/publish"):
                user = self._need_user()
                if not user:
                    return
                mid = unquote(u.path[len("/v1/maps/") :].split("/")[0])
                body = self._read_json()
                slug = (body.get("slug") or mid).strip()
                copy_name = (body.get("name") or "").strip() or None
                try:
                    bundle = cat.load_project_bundle(slug)
                except FileNotFoundError:
                    shared = cat.MAPS / slug / "map.svg"
                    if not shared.is_file():
                        self._json(404, {"error": "нет svg проекта"})
                        return
                    svg = shared.read_text(encoding="utf-8")
                    meta_p = cat.MAPS / slug / "meta.json"
                    meta = (
                        json.loads(meta_p.read_text(encoding="utf-8"))
                        if meta_p.is_file()
                        else {"slug": slug, "name": mid}
                    )
                    if copy_name:
                        meta = dict(meta)
                        meta["name"] = copy_name
                    snap = pub.publish(mid, svg, meta)
                    self._json(200, {"ok": True, "map": snap["id"], "version": snap["version"]})
                    return
                meta = dict(bundle.get("map") or {"slug": slug})
                if copy_name:
                    meta["name"] = copy_name
                snap = pub.publish(mid, bundle["svg"], meta)
                self._json(200, {"ok": True, "map": snap["id"], "version": snap["version"]})
                return
            if u.path != "/api/maps":
                self.send_error(404)
                return
            user = self._need_user()
            if not user:
                return
            body = self._read_json()
            action = (body.get("action") or "").strip()
            if action == "create":
                meta = cat.create_project(body.get("name"))
                acc.save_profile(user["id"], {"last_slug": meta["slug"]})
                self._json(200, {"ok": True, "map": meta})
                return
            if action == "rename":
                slug = (body.get("slug") or "").strip()
                meta = cat.rename_project(slug, body.get("name") or "")
                self._json(200, {"ok": True, "map": meta})
                return
            if action == "delete":
                slug = (body.get("slug") or "").strip()
                cat.delete_project(slug)
                maps = cat.load_catalog().get("maps") or []
                prof = acc.load_profile(user["id"])
                if (prof.get("last_slug") or "") == slug:
                    nxt = maps[0]["slug"] if maps else ""
                    acc.save_profile(user["id"], {"last_slug": nxt})
                self._json(200, {"ok": True, "maps": maps})
                return
            if action == "save":
                slug = (body.get("slug") or "").strip()
                meta = cat.save_project(
                    slug, svg=body.get("svg"), state=body.get("state")
                )
                acc.save_profile(user["id"], {"last_slug": slug})
                self._json(200, {"ok": True, "map": meta})
                return
            if action == "load":
                slug = (body.get("slug") or "").strip()
                query = (body.get("query") or "").strip()
                hit = body.get("hit")
                if not slug:
                    self._json(400, {"error": "нужен slug проекта"})
                    return
                if not query and not hit:
                    self._json(400, {"error": "нужно query или hit"})
                    return
                meta = cat.load_into_project(
                    slug, query or (hit or {}).get("name") or "", hit=hit
                )
                acc.save_profile(user["id"], {"last_slug": slug})
                self._json(200, {"ok": True, "map": meta})
                return
            query = (body.get("query") or "").strip()
            hit = body.get("hit")
            if not query and not hit:
                self._json(400, {"error": "нужно query или hit"})
                return
            meta = cat.create_map(query or hit.get("name") or "", hit=hit)
            self._json(200, {"ok": True, "map": meta})
        except RuntimeError as e:
            msg = str(e)
            code = 502 if "Overpass" in msg else 400
            self._json(code, {"error": msg})
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": str(e)})
        finally:
            cat.set_maps_root(None)


def _seed_publish() -> None:
    if pub.latest_version("samara"):
        return
    svg_p = cat.MAPS / "samara" / "map.svg"
    if not svg_p.is_file():
        return
    meta_p = cat.MAPS / "samara" / "meta.json"
    meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.is_file() else {
        "slug": "samara",
        "name": "Самарская область",
    }
    pub.publish("samara", svg_p.read_text(encoding="utf-8"), meta)
    print("published samara v1")


def main() -> int:
    acc.ACCOUNTS.mkdir(parents=True, exist_ok=True)
    cat.MAPS.mkdir(parents=True, exist_ok=True)
    cat.seed_samara()
    _seed_publish()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"editor: http://{HOST}:{PORT}/prototype/cartographer.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("stop")
    return 0


if __name__ == "__main__":
    sys.exit(main())
