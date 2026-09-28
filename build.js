// Build: junta todos os fontes de src/ numa única página HTML autocontida.
//
//   node build.js          -> docs/index.html  (página completa, pronta para o GitHub Pages)
//                             dist/emilius.html (mesmo jogo, sem <html>/<head>, para hosts que já envolvem a página)
//   node build.js --local  -> dist/local.html + dist/three.module.js (Three.js local, para testes offline)
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src');
const order = ['00-core.js', '05-i18n.js', 'terrain-core.js', '10-worldgen.js', '20-shaders.js', '30-scene.js', '40-player.js', '50-flight.js', '60-camera.js', '70-audio.js', '80-input.js', '90-game.js'];
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

let js = '';
for (const f of order) {
  let s = fs.readFileSync(path.join(dir, f), 'utf8');
  s = s.replace(/^if \(typeof module !== 'undefined'\).*$/m, '');   // export só usado pelo Node (tools/)
  js += `\n// ---- ${f}\n` + s;
}

const local = process.argv.includes('--local');
if (local) js = js.replace(THREE_CDN, './three.module.js');

const favicon = Buffer.from(fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8')).toString('base64');

const body = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('<!--SCRIPT-->', `<script type="module">${js}\n</script>`);
const full = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}">
<meta name="description" content="Wingsuit e BASE jump em 3D no navegador, inspirado no voo do Monte Emilius.">
</head>
<body>
${body}
</body>
</html>
`;

const write = (rel, content) => {
  const out = path.join(__dirname, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  console.log('wrote', rel, (content.length / 1024).toFixed(1) + ' KB');
};

if (local) {
  const src = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js');
  const dst = path.join(__dirname, 'dist', 'three.module.js');
  if (!fs.existsSync(src)) { console.error('Rode "npm install" antes do build local (falta node_modules/three).'); process.exit(1); }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  write('dist/local.html', full);
} else {
  write('docs/index.html', full);
  write('dist/emilius.html', body);
}
