import asyncio, os, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=1, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html?seed=18', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=300000)
        await pg.evaluate("window.__emilius.GAME.noAdapt = true")
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path=f'{OUT}/m1_menu.png', timeout=180000)
        await pg.tap('#bplay')
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/m2_ready.png', timeout=180000)
        await pg.evaluate("(() => { const E = window.__emilius; E.AUTO.on = true; E.doJump(); E.simulate(30); })()")
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path=f'{OUT}/m3_fly.png', timeout=180000)
        r = await pg.evaluate("(() => { const E = window.__emilius; E.simulate(260); E.showResults(); return JSON.stringify([E.SIM.phase, E.SIM.landing, E.computeScore()]); })()")
        print(r)
        await pg.wait_for_timeout(2000)
        await pg.screenshot(path=f'{OUT}/m4_result.png', timeout=180000)
        seen=set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    ims=[Image.open(f'{OUT}/{n}.png') for n in ['m1_menu','m2_ready','m3_fly','m4_result']]
    w,h=ims[0].size; out=Image.new('RGB',(w*2,h*2))
    for i,im in enumerate(ims): out.paste(im,((i%2)*w,(i//2)*h))
    out.save(f'{OUT}/grid.png')
asyncio.run(main())
