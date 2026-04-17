# BrickQuest

A multiplayer tabletop arena game. Players use colored "bricks" as real-time
combat abilities; a DM runs the encounter from a separate screen. Runs on the
local network — players on phones, DM on a laptop.

## Running it

```
bash serve.sh
```

Prints your LAN IP. Open on any device on the same Wi-Fi:

- `http://<ip>:8080/arena_test.html` — solo arena (single-player test harness)
- `http://<ip>:8080/players.html` — multiplayer player screen
- `http://<ip>:8080/dm_screen.html` — DM control screen
- `http://<ip>:8080/test_players.html` — multiplayer test/dev harness

`serve.sh` runs a static file server on port 8080. For full multiplayer with
state and WebSockets, run `node server.js` instead.

## File map

| File | What it is |
|------|------------|
| `arena_test.html` | Standalone single-player arena. No server state, no multiplayer. Used to iterate on combat feel, brick abilities, and mobile UI. |
| `players.html` | Live multiplayer player client. |
| `dm_screen.html` | DM control panel for a running session. |
| `test_players.html` | Dev harness for multiplayer testing. |
| `server.js` | Node multiplayer server — HTTP + WebSockets + game state. |
| `game.js` | Shared game constants (spaces, zones, monsters, bricks). Used by `server.js`. |
| `serve.sh` | Static file server on `:8080` for quick mobile testing. |
| `package.json` / `package-lock.json` | Node dependencies for `server.js`. |

## Design notes

See [`NOTES.md`](./NOTES.md) — brick mechanics, class stats, signature moves,
skill paths, goblin stats, and a running log of Android-specific issues and
fixes.
