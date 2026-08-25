# @linxin666/dsh-miku-pet

English | [中文](README.zh.md)

A floating companion pet exclusively for Miku: hand-drawn PNG frame animations
with work / shop / stat gameplay. It coexists with the built-in dsh-pet under
the `/miku-pet` namespace (entry id `miku-pet`, host routes `/miku-pet/*`).

## What it does

- **Miku-only frame animations**: idle (stop), scratch, blink x2, eat, drag,
  fall-and-stand-up (standup)
- **Random idle with pity timer**: while idle, a dice is rolled every 5 seconds
  with a 60% chance to play a random action; after 2 consecutive misses the
  next roll is guaranteed (driven by `assets/config.jsonc` weights)
- **Drag**: the drag pose loops while held; on release it plays the
  fall-and-stand-up sequence once and returns to idle
- **Click / touch interaction**: a click adds a random `心情 +0~3` mood pulse;
  touching the head / body / legs rolls zone-specific outcomes (head 5% -> +5,
  body 10% -> +10, legs 10% -> +30 or 90% -> -5 affection) with a dedicated
  3-second animation and a fixed speech bubble
- **Passive coin income**: +1 coin is earned every minute (unconditional)
- **Work loop + wallet**: the menu's "Work" runs a continuous loop — every 10s
  one round is judged (+3 coins on success / -1 on failure) until interrupted;
  the wallet never goes below 0
- **Shop**: coins buy food that restores hunger (small +40 / large +80);
  a game coin (游戏币) item exchanges 10 coins for 1 game coin; a lucky lottery
  ticket costs 10 game coins, restores all stats by +10 and draws a prize
  instantly (1,000,000/0.01%, 500,000/0.08%, 6,666/0.35%, 1,000/1.2%, 50/98.36%)
- **Sleep**: the menu's "Sleep" loops a sleep animation (falling-asleep frames
  once, then the resting loop), restores +4 energy every 30s and wakes on
  click / drag
- **Stat bars**: hovering shows hunger / mood / energy (0-100) and affection
  (0-500) bars; hunger decays 1 per 60s (5 while working), mood 0.5, energy
  0.25; affection decays 1 per 300s while idle and is raised by touch
  interactions
- **Hover menu + rename**: a light anime-styled menu (name + rename / wallets /
  shop / work / sleep / play guide); the play guide opens a dedicated page
  listing every rule with the lottery odds and expected value; the name is
  stored in localStorage
- **Free drag positioning**: dragging moves the pet anywhere and the position
  persists (localStorage), with a "back to corner" action
- **Multi-instance + configurable**: the settings section can add pets and
  change size / position instantly

## Install

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-miku-pet
```

## Configuration

Gameplay pools and weights live in `assets/config.jsonc` (idle 40 /
categories 60, 5s dice, pity timer, drag / standup / clicks pools, phrases).

## Known limitations

- Frame assets are served as WebP (q90, 1024px); user-provided PNG frames in
  the DSH home animation directory remain supported.
- The custom work / shop / stat gameplay is plugin-specific; it does not map
  onto the built-in dsh-pet pet registry model.

## License

MIT. Adapted from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
(MIT); the Miku art and gameplay code are new additions in this package.
The Hatsune Miku character name, image, and likeness belong to Crypton Future
Media, INC.; the character-usage boundary and the Piapro Character License
reference live in [NOTICE.md](NOTICE.md).
