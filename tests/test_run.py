import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
PLAN = sys.argv[2] if len(sys.argv) > 2 else 'full'
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        pg = await b.new_page(viewport={'width': 960, 'height': 540})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        t0 = time.time()
        await pg.goto('http://localhost:8765/local.html?seed=18', wait_until='domcontentloaded')
        try:
            await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        except Exception as e:
            print('TIMEOUT waiting for boot', e)
            await pg.screenshot(path=f'{OUT}/boot_fail.png')
            print('\n'.join(logs[-40:]))
            await b.close(); return
        print('boot seconds', round(time.time() - t0, 1))
        stats = await pg.evaluate('JSON.stringify(window.__emilius.WORLD.genStats)')
        print('genStats', stats)
        await pg.evaluate("window.__emilius.GAME.noAdapt = true")
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/01_menu.png', timeout=180000)
        async def shot(name, wait=1200):
            await pg.wait_for_timeout(wait)
            await pg.screenshot(path=f'{OUT}/{name}.png', timeout=180000)
        if PLAN in ('full', 'fly'):
            await pg.evaluate('(() => { const E = window.__emilius; E.startPlay(); E.AUTO.on = true; })()')
            await shot('02_ready', 1500)
            await pg.evaluate('window.__emilius.doJump()')
            await shot('03_exit', 700)
            log = await pg.evaluate('JSON.stringify(window.__emilius.simulate(6, true))')
            await shot('04_fly6')
            log2 = await pg.evaluate('JSON.stringify(window.__emilius.simulate(14, true))')
            await shot('05_fly20')
            log3 = await pg.evaluate('JSON.stringify(window.__emilius.simulate(20, true))')
            await shot('06_fly40')
            log4 = await pg.evaluate('JSON.stringify(window.__emilius.simulate(30, true))')
            await shot('07_fly70')
            log5 = await pg.evaluate('JSON.stringify(window.__emilius.simulate(40, true))')
            await shot('08_later')
            log6 = await pg.evaluate('JSON.stringify(window.__emilius.simulate(120, true))')
            await shot('09_end', 2500)
            for L in (log, log2, log3, log4, log5, log6):
                for row in json.loads(L):
                    print(row)
            await pg.wait_for_timeout(3000)
            await shot('10_result', 500)
        print('--- console ---')
        seen = set()
        for l in logs:
            if l in seen: continue
            seen.add(l); print(l[:400])
        await b.close()

asyncio.run(main())
