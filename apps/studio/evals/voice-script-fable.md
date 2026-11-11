# Voice assistant eval script (Fable take)

You're about to record a YouTube video with Darkgrade Studio. You're alone at your desk, the camera's on a tripod facing you, and it starts out set up correctly for the light you have right now, so everything you ask for is a nudge from there. Say it the way you'd talk while getting ready: short, half-finished, not performed. Pause wherever you'd naturally glance at the screen to see what changed. About two minutes.

Start in **photo mode, not recording**, with live view on and Voice listening. Press **Stop** at the end.

---

## Script

Okay, let's see what we've got.

Bit dark. Bring it up a little.

Little more.

Again.

Too far, pull it back.

Put the waveform up.

Am I clipping?

Zebras on.

Zebras on.

Yeah, the window's a bit hot, that's fine.

Bring it down a touch, but leave the shutter alone.

Looks kind of cold. Warm it up a touch.

Bit more.

Too far, back a little.

Show me the vectorscope.

Yeah, skin looks fine.

Okay, histogram instead.

Zoom in a bit.

Too tight, back out a little.

Is it focused on my eyes?

Refocus.

Peaking on, and lose the zebras.

Okay, sharp. Turn it off.

Switch to video.

What should my shutter be for this frame rate?

Darker, just a touch darker.

Actually no, undo that.

Where's my coffee. Okay.

Rolling.

Hey everyone, welcome back. Today's about exposure, and why I stopped leaving the camera on auto.

Cut.

Too fast. Let's go again. Rolling.

Hey everyone, welcome back. So for years I just let the camera focus wherever it wanted.

Cut.

Better. Back to photo.

Take a still.

Alright, I think that's it.

---

## Answer key

**No action** = no highlight and no tool call; a false trigger is worse than a miss. **Answer** = a spoken or written reply, nothing changed. Every amount is relative to wherever the camera is at that moment: "a small step" means roughly a third of a stop for brightness, or one small nudge of white balance or zoom.

| What you said | Expected |
|---|---|
| "Okay, let's see what we've got." | **No action** |
| "Bit dark. Bring it up a little." | One change: a small step brighter |
| "Little more." | A small step brighter again |
| "Again." | A small step brighter again (third in a row) |
| "Too far, pull it back." | One small step darker; not all the way back to the start |
| "Put the waveform up." | Waveform shown |
| "Am I clipping?" | **Answer**, measured from the picture; nothing changed |
| "Zebras on." | Zebras on |
| "Zebras on." (repeated word for word) | Zebras still on; not toggled off, no second effect |
| "Yeah, the window's a bit hot, that's fine." | **No action** (thinking out loud) |
| "Bring it down a touch, but leave the shutter alone." | A small step darker using ISO or aperture; shutter unchanged |
| "Looks kind of cold. Warm it up a touch." | One change: a small step warmer |
| "Bit more." | A small step warmer again (not brighter, not darker) |
| "Too far, back a little." | A small step cooler (not darker) |
| "Show me the vectorscope." | Vectorscope shown |
| "Yeah, skin looks fine." | **No action** |
| "Okay, histogram instead." | Histogram shown in place of the vectorscope |
| "Zoom in a bit." | A small step tighter |
| "Too tight, back out a little." | A small step wider (not cooler, not darker) |
| "Is it focused on my eyes?" | **Answer** (focus check); nothing changed |
| "Refocus." | Autofocus once |
| "Peaking on, and lose the zebras." | Two actions: focus peaking on; zebras off |
| "Okay, sharp. Turn it off." | Focus peaking off (not zebras, not the histogram, not recording) |
| "Switch to video." | Movie mode of the same kind as the photo mode it was in |
| "What should my shutter be for this frame rate?" | **Answer** (about double the current frame rate); nothing changed |
| "Darker, just a touch darker." | One small step darker; not two |
| "Actually no, undo that." | That darker step reversed, and nothing else |
| "Where's my coffee. Okay." | **No action** |
| "Rolling." | Start recording |
| "Hey everyone… leaving the camera on auto." | **No action** (it's the take; it mentions "exposure" and "auto") |
| "Cut." | Stop recording |
| "Too fast. Let's go again. Rolling." | Start recording once |
| "Hey everyone… focus wherever it wanted." | **No action** (it's the take; it mentions "focus"); no refocus |
| "Cut." | Stop recording, every time |
| "Better. Back to photo." | Photo mode |
| "Take a still." | One photo |
| "Alright, I think that's it." | **No action** |

Also check: clear commands go green in under a second, nothing stays blue, and the transcript has every word.
