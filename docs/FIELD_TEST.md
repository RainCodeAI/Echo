# Echo: Real-Phone Field Test

Automated browser tests cover the crew page in Chromium with a fake
microphone. Real phones behave differently: they lock their screens, take
calls, kill background pages, block the mic and clear storage. Run this
script on real phones **before the first pilot**, and again after any change
to the crew page.

**Time:** about 45 minutes per phone.

**You need:**
- the production (or staging) crew link
- a crew member's PIN
- the owner dashboard open on a laptop, to watch notes arrive

## Phones to test

At least the first two. Add the others if your pilot crews use them.

| # | Phone | How it's opened |
| --- | --- | --- |
| A | iPhone (iOS 17 or newer) | Safari, from a link in Messages |
| B | Android (Chrome) | Chrome, from a link in SMS |
| C | iPhone | Added to the Home Screen (Share → Add to Home Screen) |
| D | Any phone | Link opened from Facebook Messenger or WhatsApp (the in-app browser) |
| E | Older or cheaper Android (3 GB RAM or less) | Chrome |

Before each run, open **Phone check** at the bottom of the PIN screen and
screenshot it. It records what the phone supports.

## Scenarios

Tick each one per phone. "Expected" is what should happen. If something
else happens, write down what you saw, the time, and the phone. A screen
recording helps.

### 1. Basics
1. Open the link → enter the PIN → read the recording notice → **I understand**.
   - **Expected:** "Hi, <name>", with the job picker and the green button.
2. Record about 20 seconds about a real job (materials, a problem, a next step) → Stop → Submit.
   - **Expected:**
     - On the phone: "Sent, <name>".
     - On the dashboard: the note appears within seconds, then the AI summary within about a minute.
     - The audio plays back clearly.
3. Attach two photos: one taken with the camera, one from the library. Submit.
   - **Expected:** both photos show on the note.

### 2. Screen lock and app switching
1. Start recording and wait 30 seconds without touching the phone.
   - **Expected:** the screen stays on. Where Phone check says "Keep screen on: not supported", the screen may lock; go to step 2.
2. Start recording, talk for 10 seconds, then press the power button. Unlock.
   - **Expected:**
     - Recording has stopped with the amber message "Recording stopped because the screen locked…".
     - The first 10 seconds are kept and can be submitted.
3. Start recording, then switch to another app and come back.
   - **Expected:** same as step 2.

### 3. Calls and other apps
1. Start recording, then have someone call the phone. Decline, or answer and hang up.
   - **Expected:** recording stopped with "a call or another app took the microphone" (or the screen-lock message). The audio up to the call is kept.
2. Start recording while music or a podcast is playing.
   - **Expected:** recording works; the music may pause.
3. With Bluetooth headphones or the truck's Bluetooth connected, record a note.
   - **Expected:** it records (from the headset or the phone). If it fails, note the exact message.

### 4. The page gets killed
1. Start recording, talk for 15 seconds, then swipe the browser away in the app switcher (force close) **without** pressing Stop. Reopen the link.
   - **Expected:**
     - Straight to "Hi, <name>" with no PIN.
     - "Restored your unsent recording" and "This recording was cut off…".
     - About the first 10–15 seconds of audio (it's saved every 5 seconds). Submit works.
2. Record, Stop, type a few words, force close, reopen.
   - **Expected:** the full recording and the text are restored.
3. Phone E only: open the camera from **Add photo**, take three photos one after another, come back.
   - **Expected:** the page may have reloaded, but the photos taken before are still attached.

### 5. No signal
1. Turn on airplane mode. Record and submit.
   - **Expected:** "Saved on this phone", with the note shown in the waiting list.
2. With airplane mode still on, close the browser completely. Turn airplane mode off, reopen the link.
   - **Expected:** the note sends by itself within about 30 seconds. It appears **once** on the dashboard.
3. Weak signal (basement, back of a truck, or Wi-Fi switched off with 1 bar): record a 3-minute note and submit.
   - **Expected:** it sends eventually and is never duplicated. Note how long it took.

### 6. Microphone blocked
1. Block the microphone:
   - **iPhone:** in Safari, tap "aA" → Website Settings → Microphone → Deny.
   - **Android:** the lock icon → Permissions → Microphone → Block.
2. Tap record.
   - **Expected:** a message saying exactly where to re-allow it. Following those steps makes recording work again.
3. Phone D (in-app browser): tap record.
   - **Expected:** if it fails, the message says to open the page in Safari or Chrome, and how. Phone check marks "Browser" with a red cross.

### 7. Long recordings
1. Record for the full 10 minutes (leave the phone on a table, screen on).
   - **Expected:** it stops by itself at 10:00 with "Recordings stop at 10 minutes…". Submit works, and the audio is under 25 MB.
2. Check the dashboard.
   - **Expected:** the transcript covers the whole 10 minutes.

### 8. Shift and sessions
1. Leave the page open for an hour, then record.
   - **Expected:** it works without a PIN (sessions last 12 hours).
2. Next day, open the link again.
   - **Expected:** the PIN is asked again. Anything still waiting from yesterday sends after the PIN.
3. **Switch user** → another crew member's PIN → record.
   - **Expected:** the note is credited to the second person.

### 9. Storage cleanup (iPhone in Safari only, needs a week)
1. Submit a note in airplane mode.
2. Don't open Echo for 8 days. Then turn airplane mode off and open the link.
   - **Expected:** Safari may have deleted the waiting note. This is a known Safari limit.
   - Note the result. If the note was lost, tell crews on iPhone to **add Echo to the Home Screen** (phone C). Phone check already warns about this.

## Results log

| Date | Phone (model, OS, browser) | Scenarios passed | Problems (scenario #, what happened) | Tester |
| --- | --- | --- | --- | --- |
| | | | | |

## Known limits (by design)
- **Recording stops when the screen locks or you switch apps.** Phones cut
  off the mic for web pages in the background. The audio up to that point is
  kept, and Echo keeps the screen on while recording where the phone allows.
- **Audio is saved to the phone every 5 seconds while recording.** If the
  page is killed, the last few seconds can be lost.
- **No live transcript on some phones** (e.g. Firefox, some Android
  browsers). The audio is transcribed by the office's AI instead.
