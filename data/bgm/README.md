# Musik latar (BGM)

Taruh file musik **bebas hak cipta** di folder ini (`.mp3`, `.wav`, `.m4a`, `.ogg`).
Editor akan memilih satu lagu secara otomatis (deterministik dari judul video), lalu
menurunkan volumenya saat ada narasi (ducking).

Folder ini di-gitignore (lihat `.gitignore`), jadi file musikmu tidak ikut ter-commit.
Kalau folder ini kosong, video tetap dibuat tanpa musik.

Sumber musik gratis yang aman untuk anak, mis.:
- YouTube Audio Library (filter: bebas royalti, "no attribution")
- Pixabay Music, Incompetech (Kevin MacLeod, cek lisensinya)

Atur volume & ducking di bagian `music:` pada `config.yaml`. Nonaktifkan dengan
`music.enabled: false`.
