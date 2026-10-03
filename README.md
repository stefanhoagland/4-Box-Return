# 4-Box Return

A browser-based 2x2 multiviewer for checking that live events are actually on air across YouTube, Facebook, X and Kaltura.

## How it works

- **Viewer** (`/`): the wall screen. Four boxes, the wall title and a clock, nothing else. It follows the admin page live, so a TV or second monitor never needs touching.
- **Admin** (`/admin`): keep a list of streams (add one at a time or paste a list), pick which stream goes in each box, and set the wall title. Changes save straight away and every open viewer updates.

The stream list and box layout are saved on the server in `/config/wall.json`.

### What each box can play

- **YouTube**: video links (`watch?v=`, `youtu.be/`, `/live/`) and channel links (`/channel/UC…`, which play whatever that channel has live).
- **Facebook**: public video links, through Facebook's embedded video player.
- **Kaltura**: a Player v7 iframe embed URL, the shorthand `kaltura:<partnerId>/<uiConfId>/<entryId>`, or an HLS `playManifest` URL.
- **Any `.m3u8` HLS stream**: played with hls.js, with a real signal check. The box shows *Playing*, turns amber when video stops moving for 10 seconds, and red with *No signal* when the stream fails (it retries every 10 seconds).
- **X**: live broadcasts cannot be embedded, so the box links out for now. The backend relay in Phase 3 will play them.

Every box starts muted; press the speaker on one box to listen to it. Double-click the top bar for full screen.

### Audio meters

Each HLS box has a semi-transparent left/right peak meter (dBFS, -60 to 0, with peak hold) down its right edge. Meters keep moving on muted boxes. Browsers only allow audio after someone clicks or presses a key on the page, so the viewer shows **Click to turn on audio and meters** until then. On a wall screen that nobody touches, start Chrome with `--autoplay-policy=no-user-gesture-required` (or click once after it loads).

YouTube, Facebook and Kaltura iframe embeds keep their audio inside the embed where the page cannot read it, so their meters stay greyed out. Metering those needs the server to pull the stream itself (Phase 3).

Embedded players (YouTube, Facebook, Kaltura iframe) only show *Embed* as their status: the page cannot see inside them. Real live status for those arrives in Phase 2.

### Bulk import format

One stream per line; lines starting with `#` are ignored:

```
Main stage, https://www.youtube.com/watch?v=...
Overflow | https://www.facebook.com/.../videos/...
Room 2 - kaltura:1234567/45678901/1_abcd1234
https://example.com/live/stream.m3u8
```

## Run it with Docker (Unraid, Synology, any Docker host)

Every push to `main` publishes `ghcr.io/stefanhoagland/4-box-return:latest` (amd64 and arm64).

```sh
docker run -d --name 4-box-return -p 8080:8080 \
  -v /path/to/appdata/4-box-return:/config \
  -e ADMIN_PASSWORD=change-me \
  --restart unless-stopped ghcr.io/stefanhoagland/4-box-return:latest
```

On Unraid, use **Docker > Add Container** with:

| Field | Value |
| --- | --- |
| Name | `4-box-return` |
| Repository | `ghcr.io/stefanhoagland/4-box-return:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]/admin` |
| Port | Container port `8080`, host port `8080` (or any free port), TCP |
| Path | Container path `/config`, host path `/mnt/user/appdata/4-box-return` |
| Variable (optional) | Key `ADMIN_PASSWORD`, value of your choice. The admin login user name is `admin`. Leave it out for no password. |

Or copy [`unraid/4-box-return.xml`](unraid/4-box-return.xml) to `/boot/config/plugins/dockerMan/templates-user/` on the server and pick it from the template list.

## Develop

```sh
cd web && npm install && npm run build   # build the app once
cd ../server && npm run dev              # server on http://localhost:8080
cd ../web && npm run dev                 # optional: hot reload on http://localhost:5173 (API proxied to :8080)
```

`npm test` in `web/` and in `server/` runs the tests.

## Roadmap

1. ~~Phase 0: OBS stopgap~~ (optional, outside this repo)
2. **Phase 1: 2x2 viewer with an admin page** (this)
3. Phase 2: backend polls the YouTube, Facebook and Kaltura APIs and pushes LIVE / OFFLINE / UPCOMING to each tile
4. Phase 3: backend relay (yt-dlp) so X broadcasts and other non-embeddable streams play as HLS
5. Phase 4: ffmpeg black / freeze / silence detection and alerts (sound, Slack, SMS)
6. Phase 5: saved layouts per event, other grid sizes, schedules
