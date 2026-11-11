# Voice assistant eval script (v7)

You're about to record a YouTube video with Darkgrade Studio. You're alone at your desk, the camera's on a tripod facing you, and it starts out set up well for the light you have right now. Say it the way you'd talk while getting ready: short, half-finished, not performed. Wait where you'd naturally look at the screen to check what changed. About two minutes.

Start in **photo mode, not recording**, with live view on and Voice listening. Press **Stop** at the end.

---

## Script

Okay, let's see what we've got.

Hmm, that's a little dark. Bring it up a bit.

Little more.

Okay. Now the window behind me is way too bright. Too far, pull it back.

Can I get the waveform up, and zebras?

Am I clipping anywhere?

My skin's looking kind of green. Warm it up a touch.

Bit more.

Actually that's too warm. Back a little.

Is it actually focused on my eyes, or on the bookshelf behind me?

I always forget to check that.

Okay, switch over to video.

Turn on peaking for a sec.

Okay, focus is good. Turn it off.

Hmm, a bit flat. Bring the brightness down a touch and keep the shutter where it is.

No, undo that.

Alright, rolling.

Hey everyone, welcome back. Today we're talking about exposure, and why I stopped trusting auto.

Cut.

Let's go again. Rolling.

Hey everyone, welcome back to the channel.

Ugh. Cut. Take a still for the thumbnail.

Okay, back to photo, and kill the zebras.

Alright, I think that's it.

---

## Answer key

**No action** = no highlight and no tool call; a false trigger is worse than a miss. **Answer** = a reply under the line, nothing changed. All amounts are relative to wherever the camera started.

| What you said | Expected |
|---|---|
| "Okay, let's see what we've got." | **No action** |
| "That's a little dark. Bring it up a bit." | One change: brighter, about ⅓–½ stop |
| "Little more." | Brighter again, about ⅓ |
| "Okay. Now the window behind me is way too bright. Too far, pull it back." | One change: darker, about ⅓–⅔. Not two or three |
| "Can I get the waveform up, and zebras?" | Waveform on; zebras on |
| "Am I clipping anywhere?" | **Answer**, measured; nothing changed |
| "Skin's looking kind of green. Warm it up a touch." | Warmer, about +200–300 K |
| "Bit more." | Warmer again (not brighter) |
| "Actually that's too warm. Back a little." | Cooler, about −200 K (not darker) |
| "Is it actually focused on my eyes…?" | **Answer** (focus check); refocusing on the face is acceptable |
| "I always forget to check that." | **No action** |
| "Okay, switch over to video." | Movie mode of the same kind (Manual → Movie Manual) |
| "Turn on peaking for a sec." | Peaking on |
| "Okay, focus is good. Turn it off." | Peaking off (not recording, not focus) |
| "A bit flat. Bring the brightness down a touch and keep the shutter where it is." | Darker by about ⅓, using ISO or aperture; shutter unchanged |
| "No, undo that." | The previous change reversed |
| "Alright, rolling." | Start recording |
| "Hey everyone… stopped trusting auto." | **No action** (it's the take, and it mentions "exposure" and "auto") |
| "Cut." | Stop recording, every time |
| "Let's go again. Rolling." | Start recording again |
| "Hey everyone, welcome back to the channel." | **No action** |
| "Ugh. Cut. Take a still for the thumbnail." | Stop recording, then one photo |
| "Okay, back to photo, and kill the zebras." | Photo mode; zebras off |
| "Alright, I think that's it." | **No action** |

Also check: clear commands go green in under a second, nothing stays blue, and the transcript has every word.
