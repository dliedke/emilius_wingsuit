import asyncio, json, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 480, 'height': 270})
        logs = []
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        await pg.evaluate("window.__emilius.startPlay()")
        for assist in ['true', 'false']:
            await pg.evaluate(f"window.__emilius_set = (() => {{ const s = JSON.parse(localStorage.getItem('emilius.settings') || '{{}}'); }})()")
            for pitch in [-1, -0.5, 0, 0.5, 1]:
                r = await pg.evaluate(f"(() => {{ const E = window.__emilius; E.SETTINGS_REF.assist = {assist}; E.resetRun(); E.doJump(); const o = E.simulateFixed(45, {pitch}, 0); return JSON.stringify([o, E.GAME.scrapes]); }})()")
                rows, scr = json.loads(r)
                print('assist', assist, 'pitch', pitch, '->', rows[-1], 'scrapes', scr, '| t=4..', rows[4:9:2])
        r = await pg.evaluate("(() => { const E = window.__emilius; E.SETTINGS_REF.assist = true; E.resetRun(); E.AUTO.on = true; E.AUTO.gate = 0; E.doJump(); const o = E.simulate(260, true); return JSON.stringify([o[o.length-1], E.GAME.gatesPassed, E.GAME.scrapes, E.computeScore()]); })()")
        print('autopilot:', r)
        for l in logs: print(l)
        await b.close()
asyncio.run(main())
