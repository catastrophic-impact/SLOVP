# SLOVP: Simple Local Online Video Player

One window, two tabs: **YouTube** and **Rumble**. No accounts, no ads, no browser tab. Browse and search, keep favorite channels,
then play in [MPV](https://mpv.io/) or download with [yt-dlp](https://github.com/yt-dlp/yt-dlp).

SLOVP combines two standalone apps, kept as separate source trees:

- `src/youtube/`: the SLYTP code (lists via yt-dlp and YouTube's RSS feeds).
- `src/rumble/`: the SLRVP code (a hidden, text-only browser reads Rumble's pages; yt-dlp resolves streams with Chrome impersonation).

Only the tab you are looking at does any work. A tab is created the first time you press it. When you switch away, the tab you left is
suspended (its pending requests are dropped and its yt-dlp / hidden-browser work is stopped) and it picks up where it was when you come back.

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
