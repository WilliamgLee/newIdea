// Menjalankan pustaka animasi JS di Node (tanpa browser) untuk test determinisme & validasi.
// Dipakai oleh tests/test_animation.py. Baca permintaan JSON dari argv[2], tulis hasil JSON ke stdout.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, "..", "ai_office", "animation");
const files = [
  join(base, "renderer", "core.js"),
  join(base, "characters", "characters.js"),
  join(base, "scenes", "backgrounds.js"),
  join(base, "scenes", "objects.js"),
  join(base, "scenes", "templates.js"),
];

const sandbox = { self: {}, Math, console };
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of files) vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });

const req = JSON.parse(process.argv[2]);
const out = sandbox.AIAnim.handle(req);
process.stdout.write(JSON.stringify(out));
