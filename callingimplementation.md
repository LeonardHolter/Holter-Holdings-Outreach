# Twilio Dialer Integration Plan — `/call` Page

---

## Phase 1: Twilio Setup (No Code)

1. Create a Twilio account and purchase 4 phone numbers
2. Enable **Voice** capability on all 4 numbers
3. In Twilio Console → create an **API Key** (not the Account SID/Auth Token) — safer for frontend use
4. Add to `.env.local`:
```
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY=
TWILIO_API_SECRET=
TWILIO_PHONE_NUMBERS=+16125550001,+16125550002,+16125550003,+16125550004
```
5. Create a free **S3 bucket or Supabase Storage bucket** for recording storage (Twilio hosts recordings but you want your own copy)

---

## Phase 2: Backend — Token + Call Initiation

**Step 1 — `POST /api/twilio/token`**
- Generates a short-lived Twilio Access Token with a Voice Grant
- Rotates which number is the caller ID (round-robin across your 4 numbers based on current minute or call count)
- Returns `{ token, callerId }`

**Step 2 — `POST /api/twilio/call`**
- Accepts `{ to, callerId }`
- Hits Twilio's REST API to initiate an outbound call from callerId → company phone
- Bridges the call to the browser via the Twilio Device SDK
- Sets `record: true` and `recordingStatusCallback: "/api/twilio/recording-webhook"`
- Returns `{ callSid }`

**Step 3 — `POST /api/twilio/recording-webhook`**
- Twilio hits this when a recording is ready
- Downloads the `.mp3` from Twilio's URL
- Uploads it to your storage bucket
- Saves the recording URL to a new `call_recordings` Supabase table (see Phase 3)

---

## Phase 3: Database

**New table — `call_recordings`**
```sql
id, company_id (FK), call_sid, caller_number, 
recording_url, duration_seconds, called_at, called_by
```

Add column to `companies`: `last_call_sid` (useful for debugging dropped calls)

---

## Phase 4: Frontend — `/call` Page

**Step 1 — Load Twilio Device on mount**
- On page load, hit `/api/twilio/token` to get a token
- Initialize `Twilio.Device` with that token (import via CDN or `@twilio/voice-sdk` npm package)

**Step 2 — Replace/augment the existing call button**
- "Call" button → hits `/api/twilio/call` with the company's phone number
- Show call status: `Connecting → In Call → Ended`
- Show active call duration timer

**Step 3 — In-call controls**
- Mute button (toggle `device.activeCall.mute()`)
- Hang up button (`device.activeCall.disconnect()`)
- Voicemail drop button — pre-record a voicemail MP3, play it to the call then auto-hang up

**Step 4 — Post-call flow**
- On hang up, the existing outcome modal fires as normal (response, notes, etc.)
- Silently attach the `callSid` to the outcome save so the recording gets linked when the webhook fires

---

## Phase 5: Recordings UI

Add a small "Recordings" drawer or tab on the company card in `/call` that lists past recordings for that company with a play button. Pull from `call_recordings` table filtered by `company_id`.

---

## Implementation Order

| Order | Task | Estimated Time |
|---|---|---|
| 1 | Twilio account + numbers + env vars | 30 min |
| 2 | `/api/twilio/token` endpoint | 1 hr |
| 3 | `/api/twilio/call` endpoint | 1 hr |
| 4 | Supabase `call_recordings` table | 30 min |
| 5 | `/api/twilio/recording-webhook` | 2 hrs |
| 6 | Frontend Twilio Device init + call button | 2 hrs |
| 7 | In-call UI (status, mute, hang up) | 2 hrs |
| 8 | Post-call callSid attachment | 1 hr |
| 9 | Recordings playback UI | 1 hr |

**Total: ~11 hours of focused dev work.** Realistically 2 solid days for your coder.

---

## Watch-Out

Twilio's recording webhook fires **asynchronously** — sometimes 30–60 seconds after hang up. Make sure the UI doesn't block on it. The recording just appears in the drawer once it's ready; don't tie it to the call outcome save flow.