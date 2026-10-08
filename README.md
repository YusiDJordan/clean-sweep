# Clean Sweep

*(working title)* An isometric brawler by Snowbird Games. Karim, the night custodian at Noon Bank, knocks out bank robbers with his mop, and then he cleans up the lobby.

## Play

Open the GitHub Pages link for this repository in Chrome, Edge or Firefox on a computer. You need a keyboard and a mouse.

**New game** starts Karim's shift in the custodian's basement, a short tutorial that walks you through every tool and your first robber. Then he takes the stairs up to the lobby. **Continue** goes straight to the lobby.

| Key | Action |
| --- | --- |
| WASD | Move |
| Left click / J | Mop strike |
| Right click / K | Front kick |
| Hold Shift | Run |
| Space | Dodge roll |
| Q | Mop takedown |
| Hold C (Ctrl in the desktop version) | Clean with the tool in hand |
| 1 / 2 / 3 at the cart | Mop / vacuum / wheelbarrow |
| Esc | Tea break (pause) |

## Running it on your own computer

The game loads its models with `fetch`, so it has to be served by a web server rather than opened by double-clicking the file. From this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Credits

- Game, characters, props and animation work by Snowbird Games (Yusuf Othman).
- Built with [three.js](https://threejs.org) (MIT licence).
- Fonts are loaded from Google Fonts: Oswald, Permanent Marker and Noto Kufi Arabic.
- The bank sign's lettering is traced from Inter Display (SIL Open Font License) and DejaVu Sans (Bitstream Vera licence).
