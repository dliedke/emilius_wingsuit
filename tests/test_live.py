import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
H = int(sys.argv[3]) if len(sys.argv) > 3 else 720
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
        await pg.evaluate("window.__emilius.GAME.noAdapt = true")
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path=f'{OUT}/l1_menu.png', timeout=180000)
        # controls panel
        await pg.click('#bhelp')
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{OUT}/l2_help.png', timeout=180000)
        await pg.click('#bhelpclose')
        await pg.keyboard.press('Space')
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/l3_ready.png', timeout=180000)
        await pg.evaluate("window.__emilius.AUTO.on = true")
        await pg.keyboard.press('Space')
        await pg.wait_for_timeout(9000)
        await pg.screenshot(path=f'{OUT}/l4_live_exit.png', timeout=180000)
        await pg.evaluate("window.__emilius.simulate(10)")
        await pg.wait_for_timeout(9000)
        await pg.screenshot(path=f'{OUT}/l5_live_trail.png', timeout=180000)
        await pg.keyboard.press('KeyC')
        await pg.wait_for_timeout(5000)
        await pg.screenshot(path=f'{OUT}/l6_helmet.png', timeout=180000)
        await pg.keyboard.press('KeyC'); await pg.keyboard.press('KeyC')
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=f'{OUT}/l7_cinema.png', timeout=180000)
        await pg.keyboard.press('KeyC')
        await pg.keyboard.press('KeyP')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/l8_pause.png', timeout=180000)
        seen = set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    names = ['l1_menu','l2_help','l3_ready','l4_live_exit','l5_live_trail','l6_helmet','l7_cinema','l8_pause']
    ims = [Image.open(f'{OUT}/{n}.png') for n in names]
    w, h = ims[0].size
    out = Image.new('RGB', (w * 2, h * 4))
    for i, im in enumerate(ims): out.paste(im, ((i % 2) * w, (i // 2) * h))
    out = out.resize((w, h * 2))
    out.save(f'{OUT}/grid.png')
asyncio.run(main())
