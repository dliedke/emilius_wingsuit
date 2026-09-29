# Emilius — salto BASE de wingsuit em 3D no navegador

![Voando de wingsuit perto do lago](docs/screenshot.jpg)

Jogo de wingsuit e BASE jump feito só com HTML, CSS e JavaScript ([Three.js](https://threejs.org/)).
Você salta do cume de uma montanha, voa colado no relevo passando pelos portões,
abre o paraquedas e tenta pousar no alvo — e **a cada salto o mundo é outro**: montanhas, cristas, lagos,
neve, florestas, pássaros, portões e o local de pouso são gerados na hora.

Inspirado no vídeo [“My Most Breathtaking Wingsuit Flight Ever – Monte Emilius”](https://www.youtube.com/watch?v=i8wRc8LuLxc), do RitschWingsuit.

### Um mundo novo a cada salto

- Cada visita começa num mundo aleatório, com nome próprio (por exemplo "Aiguille d'Aurolara · 3508 m").
  O botão **Novo mundo** (tecla `N`) gera outro no menu e na tela de resultado; **Voar de novo** (`R`) repete o mesmo.
- O cume, a crista que desce dele, os vales e o traçado mudam de mundo para mundo. Na maioria dos mundos o traçado
  cruza a crista por uma **fenda entre duas torres**.
- **Portões aleatórios**: portões normais, a fenda (vale mais), o portão sobre a saída de um lago e **anéis de ouro**, menores.
- **Três tipos de pouso**: um campo no vale principal, uma **plataforma flutuando num lago** (cair na água ao lado dela
  ainda conta como pouso, um "Splash!") ou uma **encosta alta da montanha**, com um refúgio.
- Estação do ano, linha de neve e de árvores, cor da rocha, posição do sol, vento, névoa e nuvens variam por mundo.
- Bandos de gralhas-alpinas que se espalham quando você passa perto, e águias girando nas térmicas.
- Para repetir ou compartilhar um mundo, use o link com a semente (`?seed=12345`); o menu tem um botão
  **Copiar link deste mundo**.

## Jogar

▶️ **[Jogue agora no navegador](https://dliedke.github.io/emilius_wingsuit/)**

Ou abra `docs/index.html` num servidor web (veja abaixo) ou publique no seu próprio GitHub Pages.
Funciona em Chrome, Edge, Firefox e Safari recentes (precisa de WebGL 2). No celular também dá para jogar, com controles de toque.

### Publicar no GitHub Pages

1. Suba este repositório para o GitHub.
2. Vá em **Settings → Pages**.
3. Em *Build and deployment*, escolha **Deploy from a branch**, branch `main` e pasta `/docs`.
4. Depois de um ou dois minutos, o jogo fica disponível em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

O `docs/index.html` já vem pronto e carrega o Three.js pela CDN do jsDelivr. Não precisa instalar nada para publicar.

## Controles

| Wingsuit | |
|---|---|
| `W` / `↑` | Mergulhar: nariz para baixo, ganha velocidade |
| `S` / `↓` | Planar e fazer flare: troca velocidade por altura |
| `A` / `D` | Inclinar e curvar |
| `Espaço` | Saltar · abrir o paraquedas |

| Paraquedas | |
|---|---|
| `A` / `D` | Freio esquerdo / direito para curvar |
| `S` ou `Espaço` | Flare com os dois freios, a 3–5 m do chão |
| `W` | Tirantes dianteiros: desce mais rápido |
| `E` / `Shift` | Motor (paramotor): voa mais rápido e segura a altura, com 30 s de combustível |

| Geral | |
|---|---|
| `C` | Trocar câmera (perseguição, capacete, drone lateral, cinema) |
| `F` / `M` | Fumaça nos pés / som |
| `P` / `R` | Pausa / recomeçar |
| `N` | Novo mundo (no menu e no resultado) |
| `H` | Ajuda |

**Gamepad:** analógico esquerdo pilota, A é a ação, B troca a câmera, os gatilhos são os freios e RB (ou X) liga o motor.
**Celular:** arraste do lado esquerdo para pilotar, use o botão laranja para a ação e segure **MOTOR** sob o paraquedas.

### Como pontuar

- Voe perto do relevo para somar pontos de proximidade. Ficar perto por alguns segundos sobe o multiplicador.
- Passe pelos portões: 250 pontos cada, 500 no portão do lago e nos anéis de ouro, 750 na fenda entre as torres.
- Abra o paraquedas na faixa laranja do altímetro (a altura é medida acima do pouso). O bipe avisa a hora.
- Pouse no alvo. Sob o paraquedas, o marcador laranja na tela aponta o alvo, e o anel amarelo no chão (ou na água) mostra onde você vai tocar se seguir reto. O anel fica verde quando está em cima do alvo. A fumaça laranja mostra a direção do vento.
- Se não for alcançar o alvo, segure o motor: o marcador avisa quando for preciso, e a barra de baixo mostra o combustível.
- A **assistência de voo** (em Ajustes, ligada por padrão) levanta o nariz antes de uma batida e transforma toques rasantes em "raspadas" que custam pontos em vez de acabar o voo.

## Como funciona

- **Mundo procedural** (`src/terrain-core.js`): a partir da semente, decide o cume, a crista principal, o traçado com os portões (e a fenda, quando há), os vales, os lagos, o rio e o tipo de pouso; depois esculpe o relevo com ruído com derivadas, fBm erodido, cristas multifractais e vales escavados, e aplica os detalhes da face de saída, dos lagos e do pouso. A mesma função roda no Node, nos Web Workers e no jogo.
- **Geração em Web Workers** (`src/10-worldgen.js`): dois campos de altura aninhados (4 m no desktop e 8 m no celular perto do corredor de voo, 40 m no resto), com normais, sombra do sol, oclusão ambiente, mapas de vegetação e posição de árvores pré-calculados. Tudo o que pertence ao mundo fica em `R.world` e é descartado antes de gerar o próximo.
- **Terreno na GPU** (`src/30-scene.js`, `src/20-shaders.js`): chunks instanciados com 5 níveis de detalhe, geomorphing, saias contra frestas, textura de altura em float, sombreamento triplanar com bump por derivadas, névoa de altura, sombras analíticas do piloto e do velame e depth buffer logarítmico.
- **Física** (`src/50-flight.js`): passo fixo de 120 Hz, aerodinâmica da wingsuit com tabelas de sustentação e arrasto por ângulo de ataque e inclinação, sequência de abertura do paraquedas com choque de abertura, modelo de velame com freios, flare, vento e motor, e detecção de proximidade em 12 direções.
- **Pássaros** (`src/30-scene.js`): gralhas e águias instanciadas, com o bater das asas no vertex shader.
- **Câmeras** (`src/60-camera.js`), **áudio sintetizado com WebAudio** (`src/70-audio.js`), **teclado, toque e gamepad** (`src/80-input.js`).
- **Jogo** (`src/90-game.js`): pontuação, portões, replay gravado, HUD, minimapa, marcador do alvo, resolução adaptativa e ajustes salvos no `localStorage`.

## Estrutura

```
src/            código-fonte (arquivos numerados na ordem em que são concatenados)
  index.html    HTML e CSS da interface; o build injeta o JavaScript em <!--SCRIPT-->
build.js        junta tudo em um único HTML
docs/           versão pronta para o GitHub Pages (gerada pelo build)
tests/          testes visuais com Playwright (capturas de tela e simulação)
tools/          prévia do relevo em PNG, direto no Node
```

## Desenvolvimento

Requisitos: Node 18+ e Python 3 (só para o servidor local e os testes).

```bash
npm install            # baixa o Three.js para o build local
npm run build          # gera docs/index.html (GitHub Pages) e dist/emilius.html
npm run serve          # build local com Three.js offline + servidor em http://localhost:8765/local.html
```

Depois de editar qualquer arquivo em `src/`, rode `npm run build` de novo para atualizar o `docs/index.html`.

### Testes visuais (opcional)

Os scripts em `tests/` abrem o jogo num Chromium headless, pilotam com o piloto automático e salvam capturas de tela.
Eles esperam o servidor local rodando (`npm run serve`) em outro terminal.

```bash
pip install playwright pillow
python -m playwright install chromium
python tests/test_canopy.py saida/          # abertura do paraquedas, câmeras, pouso e replay
python tests/test_target.py saida/          # visibilidade do alvo sob o paraquedas
python tests/test_fixed.py                  # voa com comandos fixos e confere se não bate
python tests/test_worlds.py 1 12            # gera 12 mundos no jogo e voa cada um com o piloto automático
```

Para conferir muitos mundos direto na função do relevo (traçado livre, portões acima do chão, lagos que seguram a água):

```bash
node tools/validate-worlds.js 300           # valida os mundos 1 a 300
```

Para ver o relevo de um mundo de cima sem abrir o navegador:

```bash
node tools/terrain-preview.js 18            # mundo 18: gera preview.png com o traçado, os portões, os lagos e o alvo
```

No console do navegador, `window.__emilius` expõe o estado do jogo para depuração (por exemplo, `__emilius.AUTO.on = true` liga o piloto automático e `__emilius.newWorld(42)` gera o mundo 42).
Os testes abrem sempre o mesmo mundo (`local.html?seed=18`), para as capturas serem comparáveis.

## Créditos

- Voo original: [RitschWingsuit — Monte Emilius](https://www.youtube.com/watch?v=i8wRc8LuLxc).
- [Three.js](https://threejs.org/) (licença MIT), carregado pela CDN do jsDelivr.
- Fontes: Big Shoulders Display, Barlow Semi Condensed e Chivo Mono, do Google Fonts.
