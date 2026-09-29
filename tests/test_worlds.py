import asyncio, json, sys
from playwright.async_api import async_playwright

# Builds a series of worlds in the running game (through the "new world" flow)
# and flies each one with the autopilot: gates passed, landing or crash.
# usage: python tests/test_worlds.py [first_seed] [count]
FIRST = int(sys.argv[1]) if len(sys.argv) > 1 else 1
COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 12

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 480, 'height': 270})
        logs = []
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:8765/local.html?seed=18', wait_until='domcontentloaded')
        await pg.wait_for_function('window.__emilius !== undefined', timeout=240000)
        seeds = list(range(FIRST, FIRST + COUNT))
        res = await pg.evaluate("""async (seeds) => {
          const E = window.__emilius, out = [];
          for (const seed of seeds) {
            await E.newWorld(seed, false);
            E.startPlay(); E.AUTO.on = true; E.doJump();
            E.simulate(420);
            const T = E.TC, L = E.SIM.landing;
            out.push({ seed, type: T.LZ.type, gates: E.GAME.gatesPassed + '/' + T.GATES.length, phase: E.SIM.phase,
                       result: E.SIM.crashCause || (L && (L.splash ? 'splash' : L.kind)), dist: L ? Math.round(L.dist) : null,
                       fuelUsed: Math.round((1 - E.SIM.fuel) * 100) + '%', memory: E.R.renderer.info.memory });
          }
          return out;
        }""", seeds)
        landed = 0
        for r in res:
            print(json.dumps(r))
            landed += r['phase'] == 'landed'
        print(f'landed {landed}/{len(res)}')
        for l in logs: print(l)
        await b.close()

asyncio.run(main())
