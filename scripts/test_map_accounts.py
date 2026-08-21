#!/usr/bin/env python3
from pathlib import Path

import map_accounts as acc
import map_catalog as cat


def test_register_login(tmp_path: Path) -> None:
    acc.ACCOUNTS = tmp_path
    acc.USERS_FILE = tmp_path / "users.json"
    acc.SESSIONS_FILE = tmp_path / "sessions.json"
    u = acc.register("Иван", "secret")
    assert u["name"] == "Иван"
    try:
        acc.register("Иван", "secret")
        raise AssertionError("duplicate")
    except RuntimeError:
        pass
    token, u2 = acc.login("Иван", "secret")
    assert acc.user_from_token(token)["id"] == u["id"]
    try:
        acc.login("Иван", "nope")
        raise AssertionError("bad pass")
    except RuntimeError:
        pass
    acc.logout(token)
    assert acc.user_from_token(token) is None


def test_save_roundtrip(tmp_path: Path) -> None:
    cat.set_maps_root(tmp_path / "maps")
    try:
        meta = cat.create_project("Тест")
        svg = cat.empty_svg()
        saved = cat.save_project(meta["slug"], svg=svg, state={"layerSeq": 2})
        bundle = cat.load_project_bundle(saved["slug"])
        assert "<svg" in bundle["svg"]
        assert bundle["state"]["layerSeq"] == 2
    finally:
        cat.set_maps_root(None)


if __name__ == "__main__":
    from tempfile import TemporaryDirectory

    with TemporaryDirectory() as d:
        test_register_login(Path(d))
        test_save_roundtrip(Path(d) / "p")
    print("OK map_accounts")
