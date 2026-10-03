# 4-Box Return

A browser-based 2x2 multiviewer for checking that live events are actually on air across YouTube, Facebook, X and Kaltura.

## What works today (Phase 1)

- Four tiles in a 2x2 grid; paste a link into each and give it a label.
- **YouTube**: video links (`watch?v=`, `youtu.be/`, `/live/`) and channel links (`/channel/UC…`, which play whatever that channel has live).
- **Facebook**: public video links, through Facebook's embedded video player.
- **Kaltura**: a Player v7 iframe embed URL, the shorthand `kaltura:<partnerId>/<uiConfId>/<entryId>`, or an HLS `playManifest` URL.
- **Any `.m3u8` HLS stream**: played with hls.js, with a real signal check. The tile shows *Playing*, turns amber when video stops moving for 10 seconds, and red with *No signal* when the stream fails (it retries every 10 seconds).
- **X**: live broadcasts cannot be embedded, so the tile links out for now. The backend relay in Phase 3 will play them.
- Every tile starts muted. Press the speaker on one tile to listen to it; only one tile plays audio at a time.
- Double-click a tile's bar, or press its ⛶ button, for full screen. **Full screen** in the top bar fills the screen with the whole wall.
- The layout is saved in your browser. **Share link** copies a URL with the four streams built in, so a wall screen or a colleague opens the same layout.

Embedded players (YouTube, Facebook, Kaltura iframe) only show *Embed* as their status: the page cannot see inside them. Real live status for those arrives with the backend in Phase 2.

## Run it

```sh
cd web
npm install
npm run dev        # http://localhost:5173
```

`npm test` runs the unit tests, `npm run build` produces a static site in `web/dist` that any static host can serve.

## Run it with Docker (Unraid, Synology, any Docker host)

Every push to `main` publishes `ghcr.io/stefanhoagland/4-box-return:latest` (amd64 and arm64). It is a static site on port 8080 and stores nothing on the server, so it needs no volumes.

```sh
docker run -d --name 4-box-return -p 8080:8080 --restart unless-stopped ghcr.io/stefanhoagland/4-box-return:latest
```

On Unraid, use **Docker > Add Container** with:

| Field | Value |
| --- | --- |
| Name | `4-box-return` |
| Repository | `ghcr.io/stefanhoagland/4-box-return:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]/` |
| Port (Add another Path, Port...) | Container port `8080`, host port `8080` (or any free port), TCP |

Or copy [`unraid/4-box-return.xml`](unraid/4-box-return.xml) to `/boot/config/plugins/dockerMan/templates-user/` on the server and pick it from the template list.

If the repository is private, the image is private too: either make the package public under the repo's **Packages** settings, or log Unraid in to `ghcr.io` with a GitHub personal access token that has `read:packages`.

## Roadmap

1. ~~Phase 0: OBS stopgap~~ (optional, outside this repo)
2. **Phase 1: static 2x2 web app** (this)
3. Phase 2: backend polls the YouTube, Facebook and Kaltura APIs and pushes LIVE / OFFLINE / UPCOMING to each tile
4. Phase 3: backend relay (yt-dlp) so X broadcasts and other non-embeddable streams play as HLS
5. Phase 4: ffmpeg black / freeze / silence detection and alerts (sound, Slack, SMS)
6. Phase 5: saved layouts per event, other grid sizes, schedules
