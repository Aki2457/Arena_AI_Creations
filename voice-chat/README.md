# 🎙️ Voice Chat

Group voice chat that runs in the browser. It is a static site hosted on **Vercel**.

- **Audio** goes straight from one browser to another over WebRTC (peer-to-peer, every person connects to every other person).
- **Signaling** (who's in the room, plus exchanging offers, answers and ICE candidates) uses **Supabase Realtime** Presence and Broadcast. No database tables are needed.
- Features: named rooms, invite links (`?room=name`), mute/unmute, a live speaking indicator, and join/leave notifications. Up to about 8 people per room.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page markup (the lobby screen and the room screen) |
| `style.css` | Styling |
| `app.js` | WebRTC and signaling logic |
| `config.js` | Supabase URL, the publishable key, and the STUN servers |
| `vendor/supabase.js` | Local copy of `@supabase/supabase-js` v2 (UMD build) |

## Run locally
```bash
cd voice-chat && python3 -m http.server 8000
```
Then open http://localhost:8000. The microphone only works on `localhost` or over HTTPS.

## Deploy
This folder is deployed as the Vercel project **voice-chat**, with **Root Directory** set to `voice-chat` and framework set to "Other" (no build step).

## Notes
- Only STUN servers are configured. Most home and mobile networks connect fine. Very strict networks (for example, some corporate firewalls) may need a TURN server, which you can add to `iceServers` in `config.js`.
