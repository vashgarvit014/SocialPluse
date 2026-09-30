// Inspects the media url shapes actually present in stored posts.
import { readFileSync } from 'node:fs';

const raw = readFileSync('scheduled-posts.json', 'utf8');
let d;
try { d = JSON.parse(raw); } catch (e) {
  console.log('parse failed:', String(e).slice(0, 120));
  process.exit(0);
}
const posts = Array.isArray(d) ? d : (d.posts || []);
console.log('posts:', posts.length);

const classify = (u) => {
  if (u.startsWith('data:')) return 'DATA-URL';
  if (u.startsWith('http://') || u.startsWith('https://')) return 'ABSOLUTE-URL';
  if (u.startsWith('/')) return 'RELATIVE-PATH';
  if (u.startsWith('./') || u.startsWith('../')) return 'RELATIVE-PATH';
  return 'BARE-NO-SLASH';
};

const shapes = {};
const samples = {};
const seen = new Set();
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /\.(jpe?g|png|webp|gif|mp4|mov|webm|pdf)(\?|#|$)/i.test(v)) {
      const c = classify(v);
      shapes[c] = (shapes[c] || 0) + 1;
      if (!seen.has(c)) { seen.add(c); samples[c] = `${path}.${k} = ${v.slice(0, 70)}`; }
    } else if (v && typeof v === 'object') {
      walk(v, `${path}.${k}`);
    }
  }
};
walk(posts, 'root');

console.log('media url shapes:', JSON.stringify(shapes, null, 1));
for (const [c, s] of Object.entries(samples)) console.log(`  ${c}: ${s}`);
