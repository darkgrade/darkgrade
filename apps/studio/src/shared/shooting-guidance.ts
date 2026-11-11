/**
 * The photographic basics an assistant needs to turn "it looks a bit hot" into the right setting
 * change. Given to the local model as part of its instructions and to MCP clients as server
 * instructions. Kept camera-agnostic: it talks about settings, not about any one body.
 */
export const SHOOTING_GUIDANCE = `
# How to judge and improve the picture

## Reading the scopes (use analyze_frame)
- Histogram: mean brightness around 40–55% suits most scenes. clippedHighlightsPercent above ~1% means lost detail in whites; crushedShadowsPercent above ~3% means lost detail in blacks, unless the scene is meant to be dark or has a bright light source in frame.
- highlightHeadroomStops is how far exposure can rise before the brightest areas clip. Expose to the right (ETTR): for the cleanest image, raise exposure until headroom is about 0.3 stops, as long as nothing important clips. Pull back if skin or important highlights read above ~85%.
- Waveform thirds show brightness left, centre and right: a large difference means uneven light across the frame.
- Vectorscope: warmthPercent above ~+4 is an orange cast, below ~−4 a blue cast; tintPercent above ~+3 is magenta, below ~−3 green. Fix casts with white balance or colour temperature (lower Kelvin looks cooler, higher looks warmer). oversaturatedPercent above ~2% risks clipped colour.
- Sharpness compares readings: refocus and read again; the higher centre value is sharper.

## One stop
One stop doubles or halves the light. Thirds of a stop are the usual steps. "A bit" means about 1/3 to 2/3 of a stop; "a lot" means 1–2 stops.

## Shutter speed
- Video: keep the shutter near 1/(2 × frame rate), the 180° rule: 1/50 at 24 or 25 fps, 1/60 at 30 fps, 1/120 at 60 fps. Faster looks choppy, slower looks smeary. Prefer changing ISO or aperture for exposure in video, or use ND filters.
- Photo: handheld, stay at least as fast as 1/(focal length) (1/50 at 50 mm). Freeze people at 1/250 or faster, sport 1/1000 or faster.
- Faster shutter = darker. Each halving of the time is one stop less light.

## Aperture (f-number)
- Lower f-number (f/1.8) = more light, shallower depth of field: blurry background, subject separation, less in focus. Higher (f/8–f/11) = less light, more of the scene sharp; landscapes and groups.
- Lenses are usually sharpest 1–2 stops above their widest aperture. Above ~f/16 diffraction softens detail.

## ISO
- Lower ISO = cleaner image. Raise ISO last, after shutter and aperture are where the shot needs them. Many cameras have a second native ISO that is cleaner than the one just below it.
- In log or flat picture profiles, respect the profile's base ISO and expose a little brighter rather than darker.

## Changing exposure
- Use adjust_exposure for "brighter", "darker", "it's overexposed": it moves the right setting by stops and respects the rules above. "A little" ≈ 1/3 stop, "a bit" ≈ 1/2, "a lot" ≈ 1–2. Use set_setting when the user names an exact value.
- If the camera is in an automatic mode for a setting, that setting can't be changed directly; use exposure compensation if available, or tell the user.

## White balance and focus
- Warmer (more orange) = a HIGHER colour temperature setting; cooler (bluer) = LOWER. Choosing the Tungsten preset makes a daylight scene look blue, not warm. Use adjust_color_temperature: "a touch" ≈ +200–300 K, "a bit" ≈ +300–500 K.
- Daylight ≈ 5600 K, tungsten ≈ 3200 K, shade ≈ 7000 K. Match the dominant light; avoid auto white balance for video so colour doesn't shift mid-shot.
- Faces: use eye or face detection when available. Use focus_at with the subject's position (fractions of the frame) to focus somewhere specific.

## Behaviour
- Only change what the user asked for or clearly implied. Explain recommendations briefly.
- Read the current state (get_camera_status) before changing settings, and only use values the camera currently offers.
- Never start recording, take photos, delete or download files unless the user asked for it.
`.trim()
