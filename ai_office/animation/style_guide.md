# Panduan Gaya Animasi "AI Office"

Dokumen ini mengunci gaya visual agar semua video terasa dari satu channel. Nilai yang mengikat
ada di kode: `renderer/core.js` (`A.PAL`, `A.COLORS`, `A.FONT`), `characters/characters.js`,
`scenes/backgrounds.js`, dan `scenes/objects.js`.

## Kanvas
- Ukuran tetap **1080 x 1920** (vertikal, YouTube Shorts), **30 fps**.
- Garis tanah karakter: `GROUND_Y = 1290`. Teks layar di `TEXT_Y = 330`.
- Semua render **deterministik**: `renderFrame(plan, t)` menghasilkan frame yang sama untuk input
  yang sama. **Dilarang** `Math.random`, `Date`, atau animasi berbasis CSS/waktu nyata. Keacakan
  yang terlihat (kedip mata, posisi awan/konfeti) memakai hash deterministik `A.u.hash`.

## Warna (palet `A.PAL`)
- Langit cerah: `#6EC6FF` -> `#DDF4FF`. Matahari `#FFD43B`.
- Rumput `#7BD15A`, kayu `#D9A066`, pasir `#FCE3A8`, laut `#3FB8F5`.
- Warna garis/outline & teks gelap: **ink** `#3D2C4F` (bukan hitam murni, lebih ramah anak).
- Warna objek dari katalog (`A.COLORS`): tiap warna punya pasangan [terang, gelap] untuk isi +
  outline. Dipakai bila `scene.color` diisi.

## Karakter
- Dua karakter tetap: **Kiki** (kucing kuning, pemandu utama) dan **Bubu** (beruang cokelat).
- Rig sama: kepala bulat besar (proporsi anak), mata besar dengan **kedip** berkala, mulut yang
  **bergerak mengikuti timing suara** (lip-sync dari `plan.scenes[].words`), dua tangan.
- Pose: `idle, wave, point, jump, think, clap`. Emosi: `happy, excited, surprised, thinking, calm`.
- Garis tepi tebal, sudut membulat, pipi merona saat senang. Tidak ada detail menakutkan.

## Gerak
- Masuk/keluar halus: pop-in `outBack`, keluar menyusut. Karakter yang sama antar-scene
  **berpindah** mulus (tidak loncat), dengan hop kecil bila jaraknya jauh.
- Napas: badan naik-turun halus. Objek melayang pelan. Tempo tenang, tidak kedip tajam/flash.

## Teks di layar
- Font ramah anak membulat (`A.FONT`): Fredoka / Baloo 2, fallback Comic Sans / Arial Rounded.
  Lihat `fonts/README.md` untuk memasang Fredoka agar hasil konsisten lintas OS.
- Teks putih besar dengan **outline ink tebal** + bayangan lembut; otomatis dipecah 1-2 baris.

## Template scene (6)
`intro` (sapaan + kilau), `show_object` (1 objek besar, karakter menunjuk), `count_objects`
(objek muncul satu per satu + lencana angka), `compare` (2 objek + "vs"), `guess` (objek di balik
tanda tanya lalu terungkap dengan kilau), `outro` (pujian + konfeti).

## Menambah aset
- **Objek baru**: tambahkan `A.objects.<nama> = (ctx) => <svg>` di `scenes/objects.js`, lalu
  daftarkan namanya di `animation/catalog.yaml` (bagian `objects`). Jaga ukuran ~220px, titik
  pusat di (0,0), gunakan `ctx.color` bila objek bisa diwarnai.
- **Karakter/latar/template baru**: tambah di file terkait + `catalog.yaml`. Test
  `test_animation.py` memastikan katalog dan pustaka JS selalu cocok.
