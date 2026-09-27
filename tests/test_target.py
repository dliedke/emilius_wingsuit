import asyncio, os, sys, json
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
        await pg.goto('http://localhost:8765/local.html', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        await pg.evaluate("window.__emilius.GAME.noAdapt = true; window.__emilius.startPlay(); window.__emilius.AUTO.on = true; window.__emilius.doJump();")
        for i in range(200):
            r = await pg.evaluate("(() => { const E = window.__emilius; E.simulate(1); return E.SIM.phase === 'fly' && E.SIM.pos.y - E.TC.LZ.h < 640 ? 'low' : E.SIM.phase; })()")
            if r in ('low', 'deploy', 'canopy', 'landed', 'crashed'): break
        print('phase', r)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/t0_fly.png', timeout=180000)
        for i in range(40):
            r = await pg.evaluate("(() => { const E = window.__emilius; E.simulate(1); return E.SIM.phase; })()")
            if r in ('deploy', 'canopy', 'landed', 'crashed'): break
        print('phase', r)
        async def shot(n, w=2200):
            await pg.wait_for_timeout(w)
            await pg.screenshot(path=f'{OUT}/{n}.png', timeout=180000)
            st = await pg.evaluate("(() => { const E = window.__emilius, s = E.SIM; return JSON.stringify({ph: s.phase, agl: Math.round(s.pos.y - E.groundHeight(s.pos.x, s.pos.z)), d: Math.round(Math.hypot(s.pos.x - E.TC.LZ.x, s.pos.z - E.TC.LZ.z)), pred: [Math.round(E.AID.px), Math.round(E.AID.pz)], a: E.AID.a.toFixed(2), cls: document.getElementById('lzmark').className, hint: E.AID.hint, lbl: document.querySelector('.lzm-lbl').innerText.replace(/\\n/g,' | ')}); })()")
            print(n, st)
        await pg.evaluate("window.__emilius.simulate(0.6)")
        await shot('t1_deploy', 800)
        await pg.evaluate("window.__emilius.simulate(3.5)")
        await shot('t2_canopy_high')
        # player-controlled: turn away from the target to check the edge arrow
        await pg.evaluate("window.__emilius.AUTO.on = false")
        await pg.evaluate("(() => { const E = window.__emilius; E.SIM.heading = Math.atan2(E.TC.LZ.x - E.SIM.pos.x, -(E.TC.LZ.z - E.SIM.pos.z)) + 2.6; })()")
        await shot('t3_facing_away', 3000)
        await pg.evaluate("window.__emilius.AUTO.on = true; window.__emilius.simulate(20)")
        await shot('t4_canopy_mid')
        await pg.evaluate("window.__emilius.CAM.mode = 1")
        await shot('t5_helmet')
        await pg.evaluate("window.__emilius.CAM.mode = 0")
        # descend until ~70 m AGL
        for i in range(60):
            agl = await pg.evaluate("(() => { const E = window.__emilius; E.simulate(1); const s = E.SIM; return s.phase === 'canopy' ? s.pos.y - E.groundHeight(s.pos.x, s.pos.z) : -1; })()")
            if agl < 90: break
        await shot('t6_low')
        for i in range(60):
            agl = await pg.evaluate("(() => { const E = window.__emilius; E.simulate(0.5); const s = E.SIM; return s.phase === 'canopy' ? s.pos.y - E.groundHeight(s.pos.x, s.pos.z) : -1; })()")
            if agl < 30: break
        await shot('t7_final')
        # far view of the LZ from the exit direction with a debug camera
        await pg.evaluate("(() => { const E = window.__emilius, L = E.TC.LZ; E.lookFrom([L.x + 1500, 0, L.z + 300, 650], [L.x, L.h, L.z], 50); })()")
        await shot('t8_far', 3000)
        await pg.evaluate("window.__emilius.lookFrom(null)")
        seen = set()
        for l in logs:
            if l not in seen: seen.add(l); print(l[:300])
        await b.close()
    from PIL import Image
    names = ['t0_fly', 't1_deploy','t2_canopy_high','t3_facing_away','t4_canopy_mid','t5_helmet','t6_low','t7_final','t8_far']
    ims = [Image.open(f'{OUT}/{n}.png') for n in names]
    w, h = ims[0].size
    out = Image.new('RGB', (w * 2, h * 5))
    for i, im in enumerate(ims): out.paste(im, ((i % 2) * w, (i // 2) * h))
    out = out.resize((w * 2 * 3 // 4, h * 5 * 3 // 4))
    out.save(f'{OUT}/grid.png')
asyncio.run(main())
