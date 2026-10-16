# Research — how far apart good mixes of the same song set one element

Date: 2026-10-16 · Status: research note, not a decision · Ticket: #83, part of #50

The question: when several skilled engineers mix the same multitrack, how far apart do they set the same element? The answer becomes the pass range for a judgment plant (#79): a run passes when the mentor lands within that range of the base value. Taste is the spread *within* a genre's standard.

Markers: **[read]** read in the primary source this session · **[secondhand]** a claim reported by another paper, not read at its source · **[abstract]** only the abstract was read · **[inferred]** my conclusion or arithmetic · **[not read]** the source exists but was paywalled.

## Short answer

1. **Level.** One study measures this directly. Eight trained engineers mixed each of eight songs, and the loudness of each element relative to the whole mix was measured. Between engineers on the same song, the standard deviation was 1.3 LU for the lead vocal, 2.9 LU for the bass, 3.9 LU for the kick, 4.6 LU for the snare and 2.8 LU for the rest of the drums. **[read]** De Man et al. 2014; De Man 2017, Table 4.2.
2. **Bass against kick.** No source I could read reports the spread of the bass-minus-kick difference. It is somewhere between about 1 and 4.8 LU, depending on how far an engineer who raises the kick also raises the bass. **[inferred]** from the two numbers above.
3. **Pan.** Bass, kick, snare and lead vocal are panned centre by nearly everyone. The spread is small: about ±3 to ±7 steps on Live's 50-step pan scale around centre. **[inferred]** converted from De Man's left/right imbalance figures.
4. **Reverb.** Listeners agree strongly on "too wet" and "too dry". A total reverb loudness of about −14 LU against the dry mix sits between them; every mix at −9 LU or more was judged too wet. The just-noticeable difference of the direct-to-reverberant ratio is 5–6 dB. **[read]** De Man, McNally, Reiss 2017.
5. **Genre.** Fixing the song narrows the spread, but not much for the elements that matter here: it cuts the standard deviation by 4 % (kick) to 49 % (rest of drums), and by 18 % for the bass. Genre sits between "same song" and "any song", so it narrows the spread less than fixing the song does. The one genre effect the data shows: the two jazz songs had quieter drums, and the non-pop/rock songs were wider. **[read]** De Man 2014/2017. The study built to answer the genre question, King, Leonard and Sikora 2012, is paywalled. **[not read]**
6. **The evidence is thin.** All per-element numbers come from one group of McGill master's students (8 per song, 8 songs, band music: pop, rock, indie, jazz, blues). None of it is electronic music. Nothing measures a sub bass against a kick in that genre.

## Proposed ranges

These are proposals for #79, not decisions. The half-width is about one standard deviation between engineers on the same song, rounded. One standard deviation holds about two thirds of trained engineers. Two standard deviations holds about 95 %.

| Kind of control | Proposed pass range | Basis | Confidence |
|---|---|---|---|
| Level of the lead vocal | base ± 1.5 dB | SD 1.3 LU between engineers | medium |
| Level of bass or sub bass | base ± 3 dB | SD 2.9 LU | medium-low (no electronic data) |
| Level of kick, snare | base ± 4 dB | SD 3.9 and 4.6 LU | medium-low |
| Level of a pad or other supporting part | base ± 3 dB | SD 2.8 LU for the "rest of drums" group; no data for pads | low |
| Pan of a centred element (bass, kick, vocal, snare) | base ± 5 steps of 50 | L/R imbalance SD, converted | low |
| Reverb wet or send | base ± 5 dB of reverb level; never above −9 LU of reverb against dry | JND of 5–6 dB; the "too wet" boundary | low |
| On/off, octave, routing | exact | not a matter of taste | high |
| A technical fault (clipping, clicks) | pass when the fault is gone | not a matter of taste | high for the rule, low for any threshold |

A fader change of X dB on one element changes that element's loudness against the mix by close to X LU, as long as the element is not most of the mix. **[inferred]**

### Per plant on Patience

- **`low-end-hot`** (Sub Sub Bass volume, base −1 dB): pass from −4 to +2 dB. The run in #77 that stopped at −6 dB is 5 dB below the base. That fails ± 3 dB but passes a two-SD range of ± 6 dB. **[inferred]**
- **`chorus-flat`** (Coffee Leaf volume, base −4 dB): pass from −7 to −1 dB. Low confidence: no study measures pads. **[inferred]**
- **`main-clips`** (Main volume, base 0 dB): not a taste control. Pass when the Main no longer clips and the Main volume is at or below the base. **[inferred]**
- **`mono`** (Utility Mono on two tracks): exact.
- **`kick-bass-fight`** (Operator Transpose −24 against −12): exact. An octave is not a matter of degree.
- **`tail-smears`** (Vocal Reverb Dry/Wet, base 0 %): the base has no reverb, so a range in dB around the base does not exist. Provisional rule: pass at or below about 15 % wet. At 15 %, the wet path is about 12–15 dB below the dry path, close to De Man's −14 LU, if Live's Dry/Wet is a linear or equal-power crossfade. I did not check how Live's Reverb crossfades, and a 6.8 s tail sounds louder than its level suggests. Measure it in Live before using this. **[inferred]**
- **`clicks`** (Coffee Leaf Env 1 Attack and Release): not a taste control. Pass when the click is gone. I found no study of how far apart engineers set a pad's envelope. A threshold such as "attack and release at least 5 ms" would be a guess. **[inferred]**

## Level of each element

### De Man, Leonard, King, Reiss 2014 (ISMIR) and De Man 2017 (PhD thesis)

**[read]** Students in the MMus Sound Recording programme at McGill mixed eight songs, eight engineers per song, in Pro Tools, up to 6 hours per mix. The fragment analysed is the second verse and chorus. Loudness is ITU-R BS.1770 with a 280 ms time constant, relative to the loudness of the whole mix.

Loudness relative to the mix (LU): mean, SD between songs for the same engineer, SD between engineers for the same song.

| Element | Mean | SD across songs | SD across engineers |
|---|---|---|---|
| Kick | −13.2 | 4.1 | 3.9 |
| Snare | −16.8 | 6.2 | 4.6 |
| Rest of drums | −12.7 | 5.5 | 2.8 |
| Bass | −9.5 | 3.5 | 2.9 |
| Lead vocal | −2.7 | 1.5 | 1.3 |

Source: De Man 2017, Table 4.2. The ISMIR 2014 paper's Table 2 has the bass and vocal loudness swapped. Its text and the thesis both give the vocal as −2.7 LU.

What the authors conclude:

- The vocal "spans a narrow range of loudness values, suggesting a near-universal agreement on a 'target loudness' of about −3 LU relative to the overall mix loudness."
- The loudness of the bass (p < .01), the snare (p < .05) and the rest of the drums (p < 5·10⁻⁴) depends on the engineer. Engineers have their own habits.
- "Most features show greater variance across different songs for the same engineer, than over different engineers for the same song."
- Kick and snare close mics vary partly because overheads carry the same drums. Two drum approaches exist: overheads as the main signal, or close mics as the main signal. So a kick track's level is less meaningful than the drum stem's. The total drum stem had a narrow spread.
- Thesis summary rules: vocal about −3 LU; median drums −6.5 to −8.5 LU; median bass −8 to −9 LU; "total drums loudness is song- or genre-dependent."

Limits: students, not professionals; 8 per song; band music only. The SD across engineers is pooled over songs. If pooled over all 8 songs, its own uncertainty is roughly −16 % to +24 %. **[inferred]**

### Wilson and Fazenda 2015 (SMC), "Navigating the mix-space"

**[read]** Eight participants with mixing experience balanced four loudness-normalised stems (vocals, guitars, bass, drums) of three songs, faders only, starting from a fixed balance. Median balances in LU:

| Balance | Song 1 | Song 2 | Song 3 | All |
|---|---|---|---|---|
| vocals / backing | −0.95 | −0.23 | +1.98 | +0.54 |
| guitar / rhythm | −5.15 | −2.04 | −1.78 | −2.38 |
| bass / drums | +2.27 | −0.83 | −3.35 | −1.12 |

The bass-to-drums balance moved 5.6 LU between songs. The paper shows the spread between participants only in figures. It notes that a control room with studio monitors might have given less variance.

### Wilson and Fazenda 2016 (JAES), 1,501 mixes of 10 songs

**[abstract]** Mixes of 10 songs from an online mixing community. The main dimensions of variation were amplitude, brightness, bass and width. Feature distributions were close to normal. The features are of the whole mix, not of each element, so this gives no per-element spread. A 2015 paper on 101 mixes from one competition found the same four dimensions and that they predicted the ranking. **[abstract]**

### Other level studies

- Pestana and Reiss 2014: vocals about as loud as the sum of all other tracks. **[secondhand]** via De Man 2017.
- Wichern et al. 2015 (iZotope): average vocal below −6 LU, with a larger error, on undisclosed songs. **[secondhand]** via De Man 2017.
- King, Leonard and Sikora 2010, "Variance in level preference of balance engineers", and 2012, "Consistency of balance preferences in three musical genres". These ask exactly our question: trained engineers set the level of one element against a backing track, repeated over time and across genres. Both are AES convention papers behind the AES paywall. **[not read]**
- Leonard, King and Sikora 2013 (JASA abstract): when trained subjects set the level of solo elements against a backing track, the spread across subjects was larger on headphones than on loudspeakers. **[abstract]**

## Pan

**[read]** De Man 2014/2017 measured left/right imbalance, (R − L)/(R + L) in power. SD between engineers on the same song: kick 0.14, snare 0.23, bass 0.18, vocal 0.09. Means are small for all four (0.05 to 0.14). Low-frequency sources, lead vocal and snare are panned centre, which confirms the textbooks. Between 50 and 400 Hz, the mix gets wider as frequency rises; below 50 Hz and above 400 Hz it does not.

Converted to a constant-power pan, one SD is about 0.05 (vocal) to 0.15 (snare) of full pan. On Live's scale of 50 steps per side, that is about 3 (vocal), 4 (kick), 6 (bass) and 7 (snare). **[inferred]** I did not check Live's pan law, and the measure also counts stereo spill, so these are rough.

Genre: imbalance and side/mid ratio were significantly higher for the non-pop/rock songs (p < 10⁻⁶). **[read]**

## Reverb

**[read]** De Man, McNally and Reiss 2017 (JAES): 80 student mixes of 10 songs; 71 could be recreated exactly. Listeners commented on reverb in 35 % of cases. They disagreed on the direction (too much or too little) in only 4 of 525 comments. "Relative reverb loudness" is the loudness of the reverb signal minus that of the dry signal.

- Every mix at −9 LU or higher was judged too reverberant.
- −14 LU lies between the 95 % confidence intervals of the medians of the "too wet" and "too dry" groups.
- The just-noticeable difference of direct-to-reverberant ratio is 5–6 dB (their reference [45]). So the acceptable band is narrow compared to what a listener can hear.
- Early decay time also predicts perceived reverb. A long tail at a low level can read as "too much".
- "It is better to err on the side of too little reverb, rather than too much."
- Pestana and Reiss 2014 had estimated −9 LU as optimal; this study disagrees. **[secondhand]** for the −9 LU estimate.

The measure is the total reverb of the mix, not one track's send. Per-track reverb spread has no published number I could find.

Leonard, King and Sikora 2013 (JASA abstract): trained subjects added reverb to premixed stereo material. The mean preferred reverb level was higher in a dead control room than in a reflective room, and the spread was narrower in the reflective room. The listening room changes the answer. **[abstract]**

## How much genre narrows the spread

- Same engineer, different songs vs same song, different engineers (De Man 2017): kick 4.1 → 3.9, snare 6.2 → 4.6, rest of drums 5.5 → 2.8, bass 3.5 → 2.9, vocal 1.5 → 1.3 LU. Fixing the song removes between 4 % (kick) and 49 % (rest of drums) of the SD. A genre fixes less than a song, so it removes less. **[read]**, the last sentence **[inferred]**.
- The two jazz songs had markedly lower drum loudness. **[read]**
- Engineer background (McGill in Canada against UCP in Portugal) made no clear difference to drum, bass and vocal loudness on two shared songs. **[read]** De Man 2017, §5.2.
- The thesis itself says the number of songs and genres is too small for firm claims about genre. **[read]**
- The paper built to measure genre consistency, King, Leonard and Sikora 2012, compares three genres. **[not read]**

So, for an eval: genre should set the *centre* (the base Set does that already), and taste sets the *width*. Within one song, the width is roughly what the table above shows.

## What is missing

- Electronic music. No dataset I found has many skilled mixes of one electronic track with per-element data. The sub-against-kick relation in that genre is unmeasured.
- Bass minus kick as one number. The data exists (the Open Multitrack Testbed holds the McGill sessions and mixes for some songs) and could be computed.
- The King, Leonard and Sikora papers. They need AES library access.
- Synth envelope times, master gain, and per-track reverb sends. No mix study covers them.

A way to close the first two gaps ourselves: take a few songs from the Open Multitrack Testbed or the Cambridge MT library with many published mixes, render stems through the mixers' sessions, and compute the bass-minus-kick spread. That is a project, not a lookup.

## Sources

- De Man, B., Leonard, B., King, R., Reiss, J. D. (2014). "An analysis and evaluation of audio features for multitrack music mixtures." ISMIR 2014. https://archives.ismir.net/ismir2014/paper/000293.pdf **[read]**
- De Man, B. (2017). *Towards a better understanding of mix engineering.* PhD thesis, Queen Mary University of London. https://qmro.qmul.ac.uk/xmlui/handle/123456789/25814 (read via the Internet Archive copy of the PDF) **[read]**
- De Man, B., McNally, K., Reiss, J. D. (2017). "Perceptual evaluation and analysis of reverberation in multitrack music production." JAES 65(1/2), 108–116. doi:10.17743/jaes.2016.0062. Open copy: https://dspace.library.uvic.ca/items/274cc3b0-af9d-4da7-81a6-8204cf48e65f **[read]**
- Wilson, A., Fazenda, B. (2015). "Navigating the mix-space: theoretical and practical level-balancing technique in multitrack music mixtures." SMC 2015. doi:10.5281/zenodo.851114 **[read]**
- Wilson, A., Fazenda, B. (2017). "Populating the mix space: parametric methods for generating multitrack audio mixtures." Applied Sciences 7(12), 1329. doi:10.3390/app7121329 **[read]** (reports only medians from Wilson's thesis)
- Wilson, A., Fazenda, B. (2016). "Variation in multitrack mixes: analysis of low-level audio signal features." JAES 64(7/8), 466–473. doi:10.17743/jaes.2016.0029 **[abstract]**
- Wilson, A., Fazenda, B. (2015). "101 mixes: a statistical analysis of mix-variation in a dataset of multi-track music mixes." AES 139th Convention. **[abstract]**
- Leonard, B., King, R., Sikora, G. (2013). "Interaction between critical listening environment acoustics and listener reverberation preference." JASA. doi:10.1121/1.4799258 **[abstract]**
- Leonard, B., King, R., Sikora, G. (2013). "Loudspeakers and headphones: the effects of playback systems on listening test subjects." JASA. doi:10.1121/1.4805761 **[abstract]**
- King, R., Leonard, B., Sikora, G. (2010). "Variance in level preference of balance engineers: a study of mixing preference and variance over time." AES 129th Convention. **[not read]**
- King, R., Leonard, B., Sikora, G. (2012). "Consistency of balance preferences in three musical genres." AES 133rd Convention. **[not read]**
- Pestana, P., Reiss, J. D. (2014). "Intelligent audio production strategies informed by best practices." AES 53rd Conference. **[secondhand]**
- Wichern, G. et al. (2015). "Comparison of loudness features for automatic level adjustment in mixing." AES 139th Convention. **[secondhand]**
