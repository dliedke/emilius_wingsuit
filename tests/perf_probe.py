import asyncio, os, sys, time, json
from playwright.async_api import async_playwright

async def main():
    W = int(sys.argv[1]) if len(sys.argv) > 1 else 960
    H = int(sys.argv[2]) if len(sys.argv) > 2 else 540
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': W, 'height': H})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        res = await pg.evaluate('''() => new Promise(res => {
            const t0 = performance.now(); let n = 0;
            const f = () => { n++; if (performance.now() - t0 < 8000) requestAnimationFrame(f); else res({ n, ms: performance.now() - t0, info: window.__emilius.R.renderer.info.render }); };
            requestAnimationFrame(f);
        })''')
        print(json.dumps(res))
        for l in logs[:30]: print(l[:300])
        await b.close()
asyncio.run(main())
