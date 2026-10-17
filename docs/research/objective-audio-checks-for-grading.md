# Research — objective audio checks that could grade a run

Date: 2026-10-17 · Status: research note, not a decision · Ticket: #130, part of #127

The question: which objective audio checks could grade an eval run, and which faults can each one tell apart? The checks are the null test, pitch detection, integrated loudness and true peak, energy per band, mono sum loss and stereo correlation. For each: which faults in scope it grades (levels, register, mutes, a clash, an effect set wrong), whether it tells two fixes that sound the same apart (it should not), what makes it read differently when Live plays the same Set twice, and whether it needs the Main or each track. How audio leaves Live is decided on the listening map (#50, #51). This note takes capture as given.

Markers: **[read]** read in the primary source this session · **[computed]** my arithmetic from a formula or a published filter · **[inferred]** my conclusion, not stated by a source · **[not found]** I looked and found no primary source.

## Short answer

1. **The null test is too strict to pass a fix, but it is the right check for "nothing else changed".** Two fixes that sound the same almost never null. A 0.1 dB gain difference leaves a residual only 39 dB down, and a 1 dB difference leaves one 18 dB down. **[computed]** So a null cannot grade a judgment plant, and it fails a Pitch device that does the job of Operator's Transpose whenever the two differ at all. It is still the best way to show that a track the mentor did not touch is unchanged.
2. **A null test fails when the same Set plays twice, unless every device on the track is deterministic.** Live's own engine nulls completely: Ableton tests its mixing and rendering with cancellation tests. **[read]** But many devices are random or free-running on purpose. Patience uses Drift, and Drift gives "every voice … a different randomization" of pitch and filter. **[read]** Two copies of a sound with random phase do not cancel: on average, the residual is 3 dB *louder* than either copy. **[computed]** So each track needs its own floor: play the base twice, null it against itself, and measure what is left.
3. **No primary source gives a "near silence" threshold for a null.** **[not found]** The reference points are: Ableton expects complete cancellation **[read]**. Ethan Winer calls −80 dB "the edge of audibility … under the most favorable conditions" and expects wires to null 60 dB or more below the signal **[read]**. Dither at 16 bits alone sits near −93 dBFS **[computed]**. The floor measured from the base against itself is a better threshold than any fixed number. **[inferred]**
4. **Feature checks pass equal fixes, and need each track.** Pitch, loudness, band energy and correlation are blind to phase. Any control that brings the same sound back reads the same. On the Main they mix everything together: a 6 dB change on the sub moves the Main's loudness by only about 0.4 to 1.3 LU **[inferred]**, and the kick confuses a pitch detector. So most of them need each track alone.
5. **No single check grades all five faults; three together cover them.** Pitch plus band energy per track grades register: pitch alone would pass a high-pass on the sub that leaves the octave wrong **[inferred]**. Loudness per track grades levels and mutes, and gives a number to hold against a judgment range (ADR 0024). Band energy per track grades a clash. Correlation grades the mono plant. True peak on the Main grades clipping. An effect set wrong (the reverb plant) shows up in loudness, correlation and energy in the gaps between phrases, but none of the six checks is made for it.

## The table

| Check | Faults in scope it grades | Tells equally good fixes apart? | What breaks it in Live | Needs Main or each track |
|---|---|---|---|---|
| **Null test** (the fixed Set against the base, one polarity-flipped) | All five, but only as "same or not". It cannot say a level is inside a range, or by how much a sound is wrong. | **Yes, wrongly.** A fader against an EQ shelf, Transpose against a Pitch device, any small gain or phase difference: each leaves a residual. A 0.1 dB difference is −39 dB, 1 dB is −18 dB. | Anything random or free-running (list below). Reverb and delay tails left over from before the window. Any time offset: one sample at 48 kHz leaves −18 dB at 1 kHz. Dither. Sample-rate conversion. | **Each track.** On the Main, one random track spoils the whole null. |
| **Pitch detection** (lowest sounding note) | Register: an octave plant. Part of a clash, when the clash is about register. | **No.** The same notes give the same pitch, whichever control set them. But a high-pass that leaves a part's harmonics may still read as the right pitch, so it must go with band energy. | Octave errors of the detector itself (the same on the base and the fix, so a comparison cancels them). Chords on one track. Vibrato and detune from Drift or Analog's Error (cents, not octaves). Very short notes. A sub near 40 Hz needs windows of at least 25 ms. | **Each track.** On the Main the kick, which is also pitched, and the other parts get in the way. |
| **Integrated loudness and true peak** (ITU-R BS.1770) | Levels, measured in LU against a judgment range. Mutes: the track goes silent. Clipping on the Main: true peak above 0 dBTP. | **No** for loudness: any control that makes a track X dB louder reads X LU. **Sometimes** for true peak, because peaks depend on how partials line up in phase. | Little for integrated loudness. Random devices move it a little, and so do window edges and tails. True peak moves run to run when oscillators run free. | **Main** for clipping and the overall level. **Each track** for a level plant. |
| **Energy per band** (for example below 60 Hz) | Register: the energy moves up one octave band. The level of the low end. A clash: two tracks with energy in the same band at the same time. Mutes. A high-pass "fix" that took the sub's fundamental away. | **No**, as long as the spectrum comes back. | Little within one track. On the Main, the sum of a kick and a free-running sub in the same band depends on their phase. | **Each track** for a clash and for register. The Main gives only the total. |
| **Mono sum loss and stereo correlation** | The mono plant: correlation goes to +1. Width and phase faults. Part of an effect set wrong: a wet reverb lowers correlation. | **No.** Turning Mono off, or removing the Utility, reads the same. | Random stereo: Drift's Stereo and Unison voices, Wavetable unison, Operator's Pan < Rnd, Auto Pan's random shapes, Reverb's Chorus. A long average steadies it. I did not measure how much. | **Each track** to find which part is mono. **Main** for the image as a whole. |

## Each check

### Null test

How it works: subtract the base from the fixed Set, sample by sample. Silence means the two are identical. Winer: "If the signals … are identical, the result is silence … Otherwise, the remaining residual can be assessed for audibility based on its volume level and content." A null test "doesn't actually 'measure' anything — yet it reveals all differences between two signals". **[read]** Winer 2019.

What it grades: everything, and nothing in degree. A level plant fixed to within 1 dB of the base leaves a residual 18 dB below the track, which is clearly audible. **[computed]** `20·log10|1 − 10^(g/20)|`: 0.01 dB → −59 dB, 0.1 dB → −39 dB, 0.5 dB → −25 dB, 1 dB → −18 dB, 3 dB → −8 dB.

Why it tells equal fixes apart: it compares waveforms, and two fixes that sound the same rarely make the same waveform. An EQ shelf and a fader differ in phase. A Pitch device in front of Operator changes the note Operator receives, so anything in the patch that follows the key changes too: Operator's envelopes (Time < Key), filter (Freq < Key) and LFO (Rate < Key) all follow note pitch. **[read]** Live manual, Operator. Whether Operator's own Transpose also moves them is not stated. **[not found]**

Time alignment: one sample of offset at 48 kHz leaves a residual of −44 dB at 50 Hz, −18 dB at 1 kHz and −4 dB at 5 kHz. A hundredth of a sample still leaves −58 dB at 1 kHz. **[computed]** `20·log10(2·sin(π·f·τ))`. Winer makes the same point for analog paths: "A phase difference as small as 0.006° is enough to limit the null depth to less than –80 dB". **[read]** So the base and the fix must be captured from the same song position, sample-aligned. Aligning by cross-correlation fixes whole samples, not fractions. **[inferred]**

Thresholds people use:

- Ableton tests neutral operations for "complete phase cancellation" and "perfect phase cancellation". **[read]** Audio Fact Sheet 39.2.1, 39.2.4.
- Winer: a null down to −80 dB "is at the edge of audibility with certain types of program material under the most favorable conditions". Wires null "60 dB or more below the input signals". His tester's floor is −110 dB. **[read]** Winer 2019.
- Floors of the format: TPDF dither at 16 bits is about −93 dBFS against a full-scale sine, and the 32-bit float step near full scale is about −144 dB. **[computed]** So a residual near −90 dBFS in a 16-bit file can be dither alone.
- I found no standard or manufacturer that sets a pass threshold for a music null test. **[not found]** Forum posts quote anything from −38 dB to −80 dB. I did not use them.

What follows: the threshold should come from the track itself. Play the base twice, null it against itself, and keep that residual as the track's floor. A deterministic track nulls to the float floor. A track with Drift on it may not null at all, and then the null test cannot grade that track. **[inferred]**

### Pitch detection

The standard single-pitch method is YIN (de Cheveigné and Kawahara 2002). It searches a difference function for the period. Its main failure is the "subharmonic error, sometimes called 'octave error'". Errors are counted as "gross" when the estimate is more than 20 % off. **[read]** In the paper's tests, the integration window was 25 ms, the search range 40 to 800 Hz, and the window should be "at least as large as the maximum expected period". **[read]** A 40 Hz sub has a 25 ms period. **[computed]**

What it grades: register. An octave is 1200 cents, and Drift's or Analog's random detune is a few cents. So a tolerance of half a semitone (±50 cents) passes the right octave and fails the wrong one with a wide margin. **[inferred]** The detector's own octave errors happen the same way on the base and on the fix when the sound is the same, so comparing against the base cancels most of them. **[inferred]**

Its blind spot: YIN models one periodic signal. **[read]** A mix of a kick, a sub and a pad is not that, so pitch on the Main is unreliable. The kick's body is pitched too. A part played as chords on one track has the same problem. **[inferred]** And a high-pass that removes a sub's fundamental can leave its harmonics at the right spacing, so a period detector may still report the right note. That fix does not bring the sound back, and only band energy shows it. **[inferred]** This matters: in the `kick-bass-fight-told` series, the most common wrong fix was a high-pass on the sub (`evals/scores.md`).

### Integrated loudness and true peak

ITU-R BS.1770-5 defines loudness as K-weighted mean square, summed over channels, gated in 400 ms blocks that overlap by 75 %, with an absolute gate at −70 LKFS and a relative gate 10 dB below the level measured after the first gate. **[read]** EBU Tech 3341 adds the time scales: Momentary is a 0.4 s sliding window and Short-term a 3 s window, both ungated. Its compliance test signals must read within ±0.1 LU. **[read]** EBU R 128 sets −23 LUFS for broadcast and a maximum of −1 dBTP. **[read]** That target is for broadcast, not for grading a mix; here only the method matters.

K-weighting and the low end: the second stage of the filter is a high-pass. From the published 48 kHz coefficients, the whole K-weighting reads −8.3 dB at 30 Hz, −5.4 dB at 41 Hz, −2.9 dB at 60 Hz and +0.7 dB at 1 kHz. **[computed]** So a sub counts for less in the loudness of the Main. With the bass about 9.5 LU below the mix (De Man's mean, in `how-far-apart-good-mixes-set-one-element.md`), a 6 dB rise in the bass raises the mix by about 1.3 LU. If the sub sits 15 LU below the mix, the rise is about 0.4 LU. **[inferred]** Measurable, but small next to anything else that changed. On the track itself, a fader change of X dB reads exactly X LU, because the weighting is the same on both sides of the comparison. **[inferred]**

What it grades: a level plant, as an LU difference from the base on that track. That is the same unit as the judgment ranges proposed in #83. A mute reads as a track below the −70 LKFS gate. Clipping on the Main reads as a true peak above 0 dBTP.

True peak: BS.1770 oversamples 4 times at 48 kHz, so 192 kHz, to find peaks between samples. Sample-peak meters can under-read: "for individual transients … under-reading of these can commonly be several dBs". **[read]** Live processes in 32-bit float, **[read]** so a Main at +6 dB does not clip inside Live. It clips where the signal becomes fixed-point: the converter, or a 16- or 24-bit export. **[inferred]** A capture in float will show peaks above 0 dBFS, and that is the check. True peak depends on how the partials line up. When oscillators run free, the peak moves between plays even though the loudness does not. **[inferred]**

### Energy per band

This is not a standard measure. It is a filter bank, or the bins of an FFT, summed over time. **[inferred]** Per track, it shows where a part's energy sits. The `kick-bass-fight` plant moves the sub's energy up one octave band, roughly from 40–60 Hz to 80–120 Hz, depending on the notes. A high-pass on the sub empties the bottom band. A clash shows as two tracks with energy in the same band in the same 400 ms block. **[inferred]**

On the Main only the total is known. Where a kick and a sub share a band, their sum depends on their relative phase. If the sub's oscillators run free, the low band of the Main changes between plays. **[inferred]** This is why a clash needs each track.

### Mono sum loss and stereo correlation

A correlation meter reads +1 when the two channels are "exactly the same (in phase)" and −1 when they are "perfectly out of phase". It is "used in stereo to ensure that the left and right signals will sum to mono without any cancellation of frequencies". **[read]** iZotope Insight 2 help. The usual definition is the normalised cross-correlation of L and R at zero lag. **[inferred]** Mono sum loss carries almost the same information. For two channels of equal power, the power of L+R is 2·(1+r) times one channel's, so r = 0 loses 3 dB against r = 1, and r = −1 cancels. **[computed]** Reporting both is reporting one thing twice. Correlation per band (for example below 120 Hz) is more useful than one number for the whole range. **[inferred]**

What it grades: the `mono` plant. Utility's Mono on Coffee Leaf and Drums sets those tracks' correlation to +1. Any fix that brings the width back reads the same, whether it turns Mono off or removes the device. A wet reverb lowers a vocal's correlation, so correlation is part of a check for the `tail-smears` plant. **[inferred]**

## What makes Live play differently twice

Live's core is neutral. Undithered rendering at the hardware sample rate, playback without transposition, unstretched warping in Beats, Tones, Texture or Re-Pitch, summing at any single mix point (64-bit), routing, and bypassed effects all cancel completely in Ableton's tests. **[read]** Audio Fact Sheet 39.2. Non-neutral, but deterministic: Complex and Complex Pro warping, sample-rate conversion and transposition, volume automation, panning (constant power, +3 dB at the sides), clip fades, consolidating, grooves. **[read]** 39.3. These change the sound in the same way on every play, so they do not break a comparison against the base. **[inferred]**

What changes from one play to the next, from the Live 12 manual **[read]** unless marked:

- **Free-running oscillators.** Operator: "With R disabled, the oscillator is free-running." Its LFO too. Analog's LFO has Retrig and Offset. Simpler's LFO resets to its Offset only with Retrigger on. Wavetable's LFO resets "on each new MIDI note" only when Retrigger is on. Drift's LFO "If off, the LFO is free-running."
- **Random values on purpose.**
  - Drift: "The Drift slider adds slight variation to each voice … Every voice in Drift has a different randomization for the oscillators and filter frequency." Patience uses Drift (`evals/sets/patience/README.md`).
  - Analog: Error adds "random tuning error … to each note", and the vibrato's Error adds "random deviation" per voice.
  - Operator: Pan < Rnd, the S&H and noise LFO shapes, and the "Noise White" waveform ("truly random noise").
  - Wavetable's Shimmer and Noise unison modes jitter pitch "at random intervals".
  - Sampler's round robin in Random and Other modes.
  - LFO shapes named Random, Wander or S&H in Auto Pan, Auto Filter and others.
  - Echo's Noise, and its Wobble, "an irregular modulation of the delay time".
  - Beat Repeat's Chance and Variation.
  - A note's Chance below 100 % in a clip, and Velocity Deviation. The manual names both. I did not confirm from the manual that Velocity Deviation re-rolls on every play. **[not found]**
  - A groove's Random, "random timing fluctuation".
- **Operator has no Drift control.** The ticket names "Operator's Drift". In the Live 12 manual, Drift is a separate instrument, and Operator's randomness is the free-running oscillators, Pan < Rnd and the S&H or noise LFO. **[read]**
- **Modulated reverb.** Reverb's Chorus "adds a little modulation and motion to the diffusion". Whether it restarts at the same phase on each play is not stated. **[not found]**
- **Tails.** "Stopping playback during a reverb or delay tail will allow the tail to continue." **[read]** 39.2.7. So what a reverb or delay holds when a window starts depends on what played before it. Start every capture from the same bar, after silence, with the same pre-roll. **[inferred]**
- **Tempo-synced modulation.** Auto Pan's Phase Offset shifts each LFO channel "relative to the beat grid", so a synced Auto Pan lines up with the song position, not with when play began. **[read]** For the other synced LFOs the manual does not say where the phase starts. **[not found]**
- **Freezing removes randomness.** "Any devices with random parameters (e.g., the Chance control in the Beat Repeat device) will no longer exhibit random behavior after freezing." **[read]** 39.2.7. That is a way to make a track nullable, but freezing changes the Set, so it is not for grading. **[inferred]**
- **Dither.** "Dithering … is inherently a non-neutral procedure". Export offers Rectangular, Triangular (the default) and POW-r 1–3 below 32 bits. **[read]** 39.3.4 and 5.1.3.3. Dither is random noise, so two dithered renders never null below its level. Capture at 32-bit float, without dither. **[inferred]**

## A grade these checks could support

A proposal for #127, not a decision. **[inferred]**

1. **Calibrate once per base Set.** Play the base twice (better, several times) through the same capture, and record each check's spread on each track and on the Main: the null residual, the pitch per note, the loudness, the band energies, the correlation. That spread is each check's tolerance. A track whose base does not null against itself is marked as one the null test cannot grade.
2. **Nothing else changed.** Every track the mentor did not touch, if it is deterministic, must null against the base down to its floor. This is the audio form of ADR 0020's "nothing else differs from the base".
3. **The sound came back.** On the planted track, and on any track the mentor did touch, each feature must land within its tolerance of the base. For a judgment plant, the track's loudness must land within the range from #83 instead.
4. **Main checks.** True peak no higher than the base's, and Main loudness within the calibrated spread.

Per plant on Patience:

| Plant | Check that grades it | Needs |
|---|---|---|
| `low-end-hot` (sub +6 dB) | Loudness of Sub Sub Bass within the judgment range (±3 dB in #83); its band energy below 60 Hz | Sub Sub Bass |
| `chorus-flat` (pad −16 dB) | Loudness of Coffee Leaf in the chorus within its range | Coffee Leaf |
| `main-clips` (Main +6 dB) | True peak on the Main back at the base's; Main loudness within the spread | Main |
| `mono` (Utility Mono on two tracks) | Correlation of Coffee Leaf and Drums back at the base's | those two tracks |
| `kick-bass-fight` (sub an octave up) | Pitch of Sub Sub Bass within ±50 cents of the base, **and** its energy below 60 Hz back | Sub Sub Bass (and Kick, for the clash) |
| `tail-smears` (reverb 60 % wet) | No single check. Loudness up, correlation down, energy in the gaps between phrases. A per-track null works if Reverb's Chorus is deterministic | Vocal Main |
| `clicks` (pad attack and release near 0) | Energy in the high bands at each chord change; a null on Coffee Leaf if Drift's randomness is off | Coffee Leaf |

## Open questions

- How large is the spread of each check when Patience plays twice? Nobody has measured it. It decides whether the null test can grade any track of Patience at all, since Drift is on some of them. A throwaway script on the capture prototype from #51 could answer it.
- Does each capture path from #51 deliver samples aligned to the song position, so a base and a fix line up exactly? Link Audio windows by beat time; the process tap does not know the song position.
- Do muted tracks still reach a per-track capture? This is already open on #50.
- Fixes that move the sound on another track, such as a sidechain on the sub or an EQ on the kick for a clash, cannot pass "nothing else changed" by construction. Whether such a fix is right is a question for #127, not for a check.
- The `tail-smears` plant has no check of its own. A decay measure in the gaps (how fast energy falls after the vocal stops) would be one. It is not in this ticket's list.

## Sources

- ITU-R BS.1770-5 (11/2023), *Algorithms to measure audio programme loudness and true-peak audio level*. https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf **[read]** gating, K-weighting coefficients (Tables 1 and 2), true peak (Annex 2), under-read.
- EBU Tech 3341, *Loudness Metering: 'EBU Mode' metering to supplement EBU R 128*. https://tech.ebu.ch/docs/tech/tech3341.pdf **[read]** time scales, Table 1 tolerances.
- EBU R 128, *Loudness normalisation and permitted maximum level of audio signals*. https://tech.ebu.ch/docs/r/r128.pdf **[read]** −23 LUFS, −1 dBTP.
- Ableton Live 12 Reference Manual. **[read]**
  - Audio Fact Sheet: https://www.ableton.com/en/live-manual/12/audio-fact-sheet/
  - Live Instrument Reference (Operator, Drift, Analog, Simpler, Sampler, Wavetable): https://www.ableton.com/en/live-manual/12/live-instrument-reference/
  - Live Audio Effect Reference (Reverb, Echo, Auto Pan, Beat Repeat): https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/
  - Live MIDI Effect Reference (Pitch): https://www.ableton.com/en/live-manual/12/live-midi-effect-reference/
  - Editing MIDI (Chance, Velocity Deviation): https://www.ableton.com/en/live-manual/12/editing-midi/
  - Using Grooves: https://www.ableton.com/en/live-manual/12/using-grooves/
  - Managing Files and Sets (export, dither): https://www.ableton.com/en/live-manual/12/managing-files-and-sets/
- A. de Cheveigné and H. Kawahara, "YIN, a fundamental frequency estimator for speech and music", *JASA* 111(4), 2002, doi:10.1121/1.1458024. Read from a mirror: https://cagnazzo.wp.imt.fr/files/2013/05/2002_JASA_YIN.pdf **[read]**
- Ethan Winer, "You Can DIY! Building a Null Tester Device", audioXpress, June 2019. https://audioxpress.com/article/you-can-diy-building-a-null-tester-device **[read]**
- iZotope, Insight 2 help, Sound Field (correlation meter). https://s3.amazonaws.com/izotopedownloads/docs/insight200/en/sound-field/index.html **[read]**
- Mauch and Dixon, "pYIN", ICASSP 2014: the probabilistic successor to YIN. **[not read]** The download failed.
