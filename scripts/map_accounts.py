#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local accounts: username + password, per-user project folders."""
from __future__ import annotations

import hashlib
import json
import secrets
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS = ROOT / "accounts"
USERS_FILE = ACCOUNTS / "users.json"
SESSIONS_FILE = ACCOUNTS / "sessions.json"
COOKIE = "nasedniki"
SESSION_SEC = 30 * 24 * 3600
PBKDF2_ROUNDS = 120_000


def _load(path: Path, default):
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default
    return default


def _save(path: Path, obj) -> None:
    ACCOUNTS.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u["name"]}


def user_dir(uid: str) -> Path:
    return ACCOUNTS / uid


def user_maps(uid: str) -> Path:
    return user_dir(uid) / "maps"


def profile_path(uid: str) -> Path:
    return user_dir(uid) / "profile.json"


def load_profile(uid: str) -> dict:
    p = profile_path(uid)
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"last_slug": ""}


def save_profile(uid: str, prof: dict) -> dict:
    user_dir(uid).mkdir(parents=True, exist_ok=True)
    p = {**load_profile(uid), **prof}
    profile_path(uid).write_text(
        json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return p


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    )
    return salt, dk.hex()


def _users() -> dict:
    return _load(USERS_FILE, {"users": []})


def find_user_by_name(name: str) -> dict | None:
    want = name.strip().lower()
    for u in _users().get("users", []):
        if str(u.get("name") or "").strip().lower() == want:
            return u
    return None


def find_user_by_id(uid: str) -> dict | None:
    for u in _users().get("users", []):
        if u.get("id") == uid:
            return u
    return None


def _provision_maps(uid: str) -> None:
    dest = user_maps(uid)
    dest.mkdir(parents=True, exist_ok=True)
    shared = ROOT / "maps" / "catalog.json"
    users = _users().get("users", [])
    if len(users) == 1 and shared.is_file() and not (dest / "catalog.json").exists():
        shutil.copytree(ROOT / "maps", dest, dirs_exist_ok=True)
        return
    if not (dest / "catalog.json").exists():
        (dest / "catalog.json").write_text(
            '{"maps": []}\n', encoding="utf-8"
        )


def register(name: str, password: str) -> dict:
    name = (name or "").strip()
    password = password or ""
    if len(name) < 2:
        raise RuntimeError("имя слишком короткое")
    if len(password) < 4:
        raise RuntimeError("пароль от 4 символов")
    if find_user_by_name(name):
        raise RuntimeError("имя занято")
    uid = secrets.token_hex(8)
    salt, ph = hash_password(password)
    users = _users()
    user = {"id": uid, "name": name, "salt": salt, "pass": ph}
    users.setdefault("users", []).append(user)
    _save(USERS_FILE, users)
    _provision_maps(uid)
    save_profile(uid, {"last_slug": ""})
    return public_user(user)


def login(name: str, password: str) -> tuple[str, dict]:
    u = find_user_by_name(name or "")
    if not u:
        raise RuntimeError("неверный вход")
    _, ph = hash_password(password or "", u.get("salt") or "")
    if not secrets.compare_digest(ph, u.get("pass") or ""):
        raise RuntimeError("неверный вход")
    token = secrets.token_hex(24)
    sessions = _load(SESSIONS_FILE, {"sessions": {}})
    sessions.setdefault("sessions", {})[token] = {
        "user_id": u["id"],
        "exp": time.time() + SESSION_SEC,
    }
    _prune_sessions(sessions)
    _save(SESSIONS_FILE, sessions)
    _provision_maps(u["id"])
    return token, public_user(u)


def logout(token: str | None) -> None:
    if not token:
        return
    sessions = _load(SESSIONS_FILE, {"sessions": {}})
    sessions.get("sessions", {}).pop(token, None)
    _save(SESSIONS_FILE, sessions)


def _prune_sessions(sessions: dict) -> None:
    now = time.time()
    bag = sessions.setdefault("sessions", {})
    dead = [k for k, v in bag.items() if float(v.get("exp") or 0) < now]
    for k in dead:
        bag.pop(k, None)


def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    sessions = _load(SESSIONS_FILE, {"sessions": {}})
    rec = sessions.get("sessions", {}).get(token)
    if not rec:
        return None
    if float(rec.get("exp") or 0) < time.time():
        return None
    u = find_user_by_id(rec.get("user_id") or "")
    return public_user(u) if u else None


def cookie_token(header: str | None) -> str | None:
    if not header:
        return None
    for part in header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v.strip() or None
    return None


def set_cookie_header(token: str) -> str:
    return (
        f"{COOKIE}={token}; Path=/; Max-Age={SESSION_SEC}; "
        "SameSite=Lax; HttpOnly"
    )


def clear_cookie_header() -> str:
    return f"{COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"
