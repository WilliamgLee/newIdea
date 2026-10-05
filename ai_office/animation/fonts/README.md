# Font animasi

Pustaka memakai font membulat ramah anak. Urutan pencarian ada di `A.FONT`
(`renderer/core.js`): **Fredoka** -> Baloo 2 -> Comic Sans MS -> Segoe UI Black ->
Arial Rounded MT Bold -> sans-serif.

Agar hasil render konsisten di semua OS, pasang **Fredoka** (gratis, SIL Open Font License):

1. Unduh dari Google Fonts: https://fonts.google.com/specimen/Fredoka
2. Windows: pilih file `.ttf` (mis. `Fredoka-SemiBold.ttf`), klik kanan > **Install**.
3. Tidak perlu menaruh file di folder ini; renderer memakai font yang terpasang di sistem
   lewat nama `local(...)`. (Boleh juga menaruh `.ttf` di folder ini sebagai arsip.)

Tanpa Fredoka, animasi tetap jalan dengan font fallback yang tersedia di sistem.
