"""Buat / perbarui kredensial admin AI Office.

Menanyakan username dan password secara INTERAKTIF (password tidak tampil), lalu menyimpan
username + HASH argon2id ke data/admin.json (di-gitignore, izin dibatasi).

Password TIDAK PERNAH ditulis ke file, log, atau argumen baris perintah.

Jalankan:
    python scripts/set_admin.py
    python scripts/set_admin.py --config config.yaml
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

# agar bisa dijalankan sebagai `python scripts/set_admin.py` dari root repo
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai_office.config import load_config
from ai_office.web.auth import AdminStore, hash_password

MIN_LEN = 8


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Set kredensial admin AI Office")
    parser.add_argument("--config", default=None, help="path config.yaml")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    store = AdminStore(config.data_dir / "admin.json")

    if store.exists():
        current = store.username()
        print(f"Admin sudah ada (username: {current}). Melanjutkan akan MENIMPA kredensial.")
        if input("Lanjutkan? [y/N]: ").strip().lower() != "y":
            print("Dibatalkan.")
            return 1

    username = input("Username admin: ").strip()
    if not username:
        print("Username tidak boleh kosong.", file=sys.stderr)
        return 1

    password = getpass.getpass("Password: ")
    if len(password) < MIN_LEN:
        print(f"Password minimal {MIN_LEN} karakter.", file=sys.stderr)
        return 1
    confirm = getpass.getpass("Ulangi password: ")
    if password != confirm:
        print("Password tidak cocok.", file=sys.stderr)
        return 1

    store.save(username, hash_password(password))
    print(f"Kredensial admin tersimpan di {store.path}")
    print("File ini berisi HASH password (bukan password asli) dan di-gitignore.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
