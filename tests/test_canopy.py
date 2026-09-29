import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 960, 'height': 540})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html?seed=18', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        await pg.evaluate("window.__emilius.GAME.noAdapt = true; window.__emilius.startPlay(); window.__emilius.AUTO.on = true; window.__emilius.doJump();")
        rows = []
        # fly until deploy starts
        for i in range(40):
            r = await pg.evaluate("(() => { const E = window.__emilius; const out = E.simulate(4, true); return JSON.stringify([E.SIM.phase, E.GAME.gatesPassed, out.slice(0,2)]); })()")
            ph = json.loads(r)
            rows.append(ph)
            if ph[0] in ('deploy', 'canopy', 'landed', 'crashed'): break
        print('phase after flight', rows[-1][:2])
        async def shot(n, w=2500):
            await pg.wait_for_timeout(w)
            await pg.screenshot(path=f'{OUT}/{n}.png', timeout=180000)
        await pg.evaluate("window.__emilius.simulate(0.8)")
        await shot('c1_deploy', 800)
        await pg.evaluate("window.__emilius.simulate(1.2)")
        await shot('c2_inflating', 800)
        await pg.evaluate("window.__emilius.simulate(4)")
        await shot('c3_canopy_chase')
        await pg.evaluate("window.__emilius.CAM.mode = 2")
        await shot('c4_canopy_side')
        await pg.evaluate("window.__emilius.CAM.mode = 3; window.__emilius.CAM.shot = null")
        await shot('c5_canopy_cinema')
        await pg.evaluate("window.__emilius.CAM.mode = 0")
        log = await pg.evaluate("JSON.stringify(window.__emilius.simulate(200, true))")
        L = json.loads(log)
        for r in L[-12:]: print(r)
        await shot('c6_landed', 1500)
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path=f'{OUT}/c7_result.png', timeout=180000)
        await pg.evaluate("window.__emilius.startReplay()")
        await shot('c8_replay1', 4000)
        await shot('c9_replay2', 6000)
        seen = set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    names = ['c1_deploy','c2_inflating','c3_canopy_chase','c4_canopy_side','c5_canopy_cinema','c6_landed','c7_result','c8_replay1','c9_replay2']
    ims = [Image.open(f'{OUT}/{n}.png') for n in names]
    w, h = ims[0].size
    out = Image.new('RGB', (w * 2, h * 5))
    for i, im in enumerate(ims): out.paste(im, ((i % 2) * w, (i // 2) * h))
    out = out.resize((w * 2 * 3 // 4, h * 5 * 3 // 4))
    out.save(f'{OUT}/grid.png')
asyncio.run(main())
