#!/usr/bin/env python3
"""
bump_good.py — поднять эталонные .good-файлы до текущего состояния карты.

Использовать ТОЛЬКО когда вы действительно довольны состоянием (карта валидна,
верификатор зелёный). Скрипт копирует текущие map.svg/state.json в их .good-эталоны
и прогоняет verify_map_good.py, чтобы зафиксировать новую базовую линию.

После запуска обязательно закоммитьте изменившиеся .good отдельным осмысленным
коммитом (например: "chore: bump samara baselines to <состояние>"), чтобы смена
эталона была видна в истории и проверяема.

НЕ бампать на каждом микро-шаге отладки — иначе верификатор перестанет ловить
реальные регрессии.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPDIR = ROOT / "accounts" / "01601a7495be1aed" / "maps" / "samara"
VERIFY = ROOT / "scripts" / "verify_map_good.py"


def bump(src_name: str) -> bool:
    src = MAPDIR / src_name
    if not src.is_file():
        print(f"  skip {src_name}: файл отсутствует")
        return False
    dst = MAPDIR / (src_name + ".good")
    shutil.copyfile(src, dst)
    print(f"  {src_name} -> {src_name}.good  ({src.stat().st_size} bytes)")
    return True


def main() -> int:
    print("== Поднятие эталона samara ==")
    bump("map.svg")
    bump("state.json")  # state.json в gitignore, но .good-эталон всё же обновляем
    print("== Прогон верификатора ==")
    if not VERIFY.is_file():
        print(f"  WARN: верификатор не найден: {VERIFY}")
        return 0
    rc = subprocess.call([sys.executable, str(VERIFY)])
    if rc == 0:
        print("OK: эталон обновлён, верификатор зелёный.")
    else:
        print(
            "WARN: верификатор НЕ прошёл. Эталон уже скопирован, но, возможно,\n"
            "       текущее состояние невалидно. Проверьте вывод выше перед коммитом .good."
        )
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
