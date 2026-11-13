# Audio notes (Phase 0 spike, 6 Nov 2026)

## Outcome
The spike **worked**: `assets/audio/letters.js` ships 8 spoken letter clips (C H K L Q R S T) generated with a licence-clean synthesiser. Tones stay the default sound (`settings.sound = 'tones'`); letters are an option where `HF.audio.hasClips()` is true.

| Letter | Duration | MP3 bytes | Mean / peak (dBFS) |
|---|---|---|---|
| C | 313 ms | 1,794 | −20.5 / −10.4 |
| H | 392 ms | 2,186 | −20.5 / −8.4 |
| K | 366 ms | 2,055 | −20.4 / −11.0 |
| L | 470 ms | 2,578 | −20.5 / −9.3 |
| Q | 549 ms | 2,970 | −20.5 / −11.0 |
| R | 418 ms | 2,317 | −20.4 / −9.4 |
| S | 392 ms | 2,186 | −20.4 / −8.8 |
| T | 366 ms | 2,055 | −20.4 / −10.6 |

`letters.js` is 24.9 KB (base64 data URIs). Durations are after trimming; MP3 encoder padding is trimmed by Chromium's decoder, and `HF.audio` also measures any leading silence at decode and starts each clip after it (`start(when, offset)`).

**Not yet done:** nobody has listened to the clips (no audio output in this container). Before release, a person should play them with the sound check and confirm that each one is clearly the intended letter name. If one is unclear, regenerate with `voice=rms` (male US) or `awb` and compare.

## Engine, voice, licence
- **Engine:** Flite 2.2 (Carnegie Mellon University), Ubuntu package `libflite1` 2.2-6build3, used through ffmpeg 6.1.1's `flite` audio source (`-f lavfi -i flite=text=…:voice=…`). ffmpeg is only a build-time tool; nothing of it ships.
- **Voice:** `cmu_us_slt` (US English, female, 16 kHz clustergen voice built from the CMU ARCTIC "slt" recordings).
- **Licence:** the CMU Flite licence (Debian `copyright` file, "All other files"): free use, copying, modification, distribution and sale, provided that (1) the copyright notice and disclaimer are kept, (2) modifications are marked, (3) original authors' names are kept, (4) the authors' names are not used to endorse the product. The ARCTIC voice data carries a similar permissive CMU notice. No GPL, NC or eSpeak voice data is involved. The output audio is not covered by ffmpeg's licence.
- **Attribution to add to `NOTICE`:** "Spoken letters synthesised with Flite (Copyright © 1999–2016 Language Technologies Institute, Carnegie Mellon University; voice cmu_us_slt, CMU ARCTIC). Used under the Flite licence; the clips were trimmed, loudness-matched and re-encoded."
- Options rejected or not needed: Piper `en_US-ljspeech` (huggingface blocked here; Piper 1.8 is GPL and phonemises with eSpeak NG data), eSpeak (excluded by the brief), speechSynthesis (never in timed streams).

## How the clips were made (reproducible)
Letters are the non-rhyming consonant set C H K L Q R S T (PLAN §11). For each letter:

1. Synthesise: `ffmpeg -f lavfi -i "flite=text=C:voice=slt" -ar 22050 -ac 1 …`
2. Trim silence at both ends: `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,areverse,silenceremove=…same…,areverse`
3. Measure with `volumedetect`; apply one static gain so the mean level is −20 dBFS unless that would push the peak above −1 dBFS: `gain = min(−20 − mean, −1 − peak)`.
4. Fade 5 ms in and 15 ms out (no clicks), encode MP3 40 kbps mono 22.05 kHz: `-c:a libmp3lame -b:a 40k`.
5. Base64 each MP3 into `window.HF_AUDIO_CLIPS = { C: 'data:audio/mpeg;base64,…', … }`.

The script used (Python 3 + ffmpeg with libflite and libmp3lame), run as `python3 make_letters.py <workdir> assets/audio/letters.js slt`:

```python
import base64, json, re, subprocess, sys, os
out_dir, js_path = sys.argv[1], sys.argv[2]; voice = sys.argv[3] if len(sys.argv) > 3 else 'slt'
LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T']
TRIM = ('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,areverse,'
        'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,areverse')
def run(args): return subprocess.run(args, capture_output=True, text=True, check=True)
def stats(path):
    err = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-']).stderr
    return (float(re.search(r'mean_volume: (-?[\d.]+) dB', err).group(1)),
            float(re.search(r'max_volume: (-?[\d.]+) dB', err).group(1)))
clips = {}
for L in LETTERS:
    trimmed, mp3 = os.path.join(out_dir, f'trim_{L}.wav'), os.path.join(out_dir, f'{L}.mp3')
    run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'flite=text={L}:voice={voice}',
         '-af', TRIM, '-ar', '22050', '-ac', '1', trimmed])
    mean, peak = stats(trimmed)
    gain = min(-20.0 - mean, -1.0 - peak)
    af = f'volume={gain:.2f}dB,afade=t=in:st=0:d=0.005,areverse,afade=t=in:st=0:d=0.015,areverse'
    run(['ffmpeg', '-loglevel', 'error', '-y', '-i', trimmed, '-af', af, '-ar', '22050', '-ac', '1',
         '-c:a', 'libmp3lame', '-b:a', '40k', mp3])
    clips[L] = 'data:audio/mpeg;base64,' + base64.b64encode(open(mp3, 'rb').read()).decode()
open(js_path, 'w').write('window.HF_AUDIO_CLIPS = {\n' +
    ',\n'.join(f'  {L}: {json.dumps(clips[L])}' for L in LETTERS) + '\n};\n')
```
(The shipped file also has a comment header with the credit line.)

## How the app uses audio (js/core/audio.js)
- The AudioContext is created and resumed only inside a user gesture (`HF.audio.unlock()` in the Start click). Clips are decoded at unlock, each from a fresh ArrayBuffer, never during a stream.
- Tones: 8 pitches with no shared pitch class (E4 F#4 A4 B4 C#5 F5 G#5 A#5 = 329.6 … 932.3 Hz), triangle wave, 400 ms, 8 ms linear ramps.
- Sounds are scheduled with `start(when)` on the audio clock. `HF.timing.runStream` calls the block's `sound(trial, when)` one frame before the item's onset frame, with `when` mapped from the expected first visible frame via `getOutputTimestamp()`, plus `settings.audioOffsetMs` (Bluetooth correction).
- `latency()` (base/output latency) is stored in the stream log; auditory RTs are "estimated" and never used for progression.
- If the context stops running during an audio block, the block pauses (reason `audio`). An audio block will not start silently: if audio is not running at the first item, the run pauses with reason `audio` so the player can ask for a tap.
- iOS: `navigator.audioSession.type = 'playback'` during audio blocks (feature-detected), `'auto'` afterwards. `soundCheck()` plays three tones (or C, H, K) and returns the hint about volume, the silent switch and Bluetooth delay.
