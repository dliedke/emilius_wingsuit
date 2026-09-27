import asyncio, os, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
VIEWS = [
    ('s1_near', "[L.x - 160, 0, L.z + 60, 25]", "[L.x, L.h + 25, L.z]", 55),
    ('s2_mid', "[L.x + 600, 0, L.z - 200, 300]", "[L.x, L.h + 20, L.z]", 55),
    ('s3_far', "[L.x - 1500, 0, L.z + 900, 700]", "[L.x, L.h + 20, L.z]", 55),
]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 800, 'height': 450})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        await pg.evaluate("document.getElementById('menu').hidden = true; document.getElementById('scrim').hidden = true;")
        for n, pos, tgt, fov in VIEWS:
            await pg.evaluate(f"(() => {{ const E = window.__emilius, L = E.TC.LZ; E.lookFrom({pos}, {tgt}, {fov}); }})()")
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f'{OUT}/{n}.png', timeout=180000)
        seen = set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    ims = [Image.open(f'{OUT}/{v[0]}.png') for v in VIEWS]
    w, h = ims[0].size
    out = Image.new('RGB', (w, h * len(ims)))
    for i, im in enumerate(ims): out.paste(im, (0, i * h))
    out.save(f'{OUT}/smoke_grid.png')
asyncio.run(main())
