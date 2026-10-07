"""Alat diagnosa login admin (sementara). Menanyakan username+password lalu menguji LANGSUNG
terhadap data/admin.json, menampilkan di tahap mana kegagalannya. Password tidak disimpan/ditampilkan.

    python scripts/check_login.py
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai_office.config import load_config
from ai_office.web.auth import AdminStore, verify_password


def main() -> int:
    config = load_config()
    store = AdminStore(config.data_dir / "admin.json")
    print(f"File admin : {store.path}")
    print(f"Ada?       : {store.exists()}")
    data = store.load()
    if not data:
        print("admin.json tidak ada / tidak terbaca. Jalankan: python scripts/set_admin.py")
        return 1
    print(f"Username tersimpan: {data.get('username')!r}")
    print(f"Hash prefix       : {str(data.get('password_hash'))[:30]}...")

    username = input("Coba username: ")
    password = getpass.getpass("Coba password: ")

    user_ok = username == data.get("username")
    pass_ok = verify_password(data.get("password_hash", ""), password)
    print(f"\nusername cocok : {user_ok}  (ketik {username!r} vs simpan {data.get('username')!r})")
    print(f"password cocok : {pass_ok}")
    if user_ok and pass_ok:
        print("\n=> Kredensial BENAR. Jika web tetap menolak, kemungkinan lockout "
              "(restart server) atau cookie. Restart `python run.py` lalu coba lagi.")
        return 0
    if not user_ok:
        print("\n=> Username tidak cocok (perhatikan huruf besar/kecil & spasi).")
    if not pass_ok:
        print("\n=> Password tidak cocok. Set ulang: python scripts/set_admin.py")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
