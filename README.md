# SLOVP: Simple Local Online Video Player

One window, two tabs: **YouTube** and **Rumble**. No accounts, no ads, no browser tab. Browse and search, keep favorite channels,
then play in [MPV](https://mpv.io/) or download with [yt-dlp](https://github.com/yt-dlp/yt-dlp).

SLOVP combines two standalone apps, kept as separate source trees:

- `src/youtube/`: the SLYTP code (lists via yt-dlp and YouTube's RSS feeds).
- `src/rumble/`: the SLRVP code (a hidden, text-only browser reads Rumble's pages; yt-dlp resolves streams with Chrome impersonation).

Only the tab you are looking at does any work. A tab is created the first time you press it. When you switch away, the tab you left is
suspended (its pending requests are dropped and its yt-dlp / hidden-browser work is stopped) and it picks up where it was when you come back.

**Rumble tab:** besides your favorites, the sidebar has *Rumble Home* (rumble.com's homepage), *Live Streams* and a collapsible, searchable
*Categories* list. Favorited channels include their past live streams. Live streams play in MPV.

## Run from source

```
npm install
npm start
```

Data (favorites, playlists, prefs, helper binaries) lives in `config/` next to the project, or next to the AppImage when packaged.
Each tab keeps its own folder there (`config/youtube`, `config/rumble`); yt-dlp and ffmpeg are shared in `config/bin`.

## Requirements

MPV (Flatpak `io.mpv.Mpv` or native). ffmpeg is only for audio conversion and merged video downloads and can be fetched from inside the app.

## Build the AppImage

```
bash scripts/build.sh
```
(Run it inside an Ubuntu 22.04 distrobox; `bash scripts/setup-box.sh` provisions one.) The result is `release/SLOVP-<version>.AppImage`.

## Known limits

- Rumble Shorts cannot be played yet (yt-dlp has no support for them).
- The Rumble tab reads Rumble's public pages with a hidden browser at a slow pace, so a change to Rumble's markup can break it, and its terms of service apply to how you use it.
- Playlists are available in the YouTube tab only.

## License

MIT, see [LICENSE](LICENSE).
