import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
views = json.loads(sys.argv[2])
W = int(sys.argv[3]) if len(sys.argv) > 3 else 800
H = int(sys.argv[4]) if len(sys.argv) > 4 else 450
os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': W, 'height': H})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        await pg.evaluate("document.getElementById('menu').hidden = true; document.getElementById('scrim').hidden = true; window.__emilius.GAME.noAdapt = true;")
        for name, v in views.items():
            await pg.evaluate(f"window.__emilius.lookFrom({json.dumps(v[0])}, {json.dumps(v[1])}, {v[2] if len(v) > 2 else 60})")
            await pg.wait_for_timeout(3000)
            await pg.screenshot(path=f'{OUT}/{name}.png', timeout=180000)
        seen = set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    names = list(views.keys())
    ims = [Image.open(f'{OUT}/{n}.png') for n in names]
    w, h = ims[0].size
    cols = 2
    rows = (len(ims) + 1) // 2
    out = Image.new('RGB', (w * cols, h * rows))
    for i, im in enumerate(ims): out.paste(im, ((i % cols) * w, (i // cols) * h))
    out.save(f'{OUT}/grid.png')
asyncio.run(main())
