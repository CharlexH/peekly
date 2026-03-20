import { minify } from "terser";
import { readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";

// Extract the script string from the TS source
const source = readFileSync("src/tracker/script.ts", "utf-8");
const match = source.match(/`([\s\S]*?)`;/);
if (!match) {
  console.error("Could not extract script from source");
  process.exit(1);
}

const script = match[1];

const result = await minify(script, {
  compress: { passes: 3, pure_getters: true, unsafe: true },
  mangle: true,
  toplevel: true,
});

if (!result.code) {
  console.error("Minification failed");
  process.exit(1);
}

const gzipped = gzipSync(Buffer.from(result.code));
console.log(`Original: ${script.length} bytes`);
console.log(`Minified: ${result.code.length} bytes`);
console.log(`Gzipped:  ${gzipped.length} bytes`);

if (gzipped.length > 1024) {
  console.warn("WARNING: Gzipped size exceeds 1KB target!");
}
