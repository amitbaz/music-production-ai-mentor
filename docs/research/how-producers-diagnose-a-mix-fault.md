# Research — how producers diagnose a mix fault before fixing it

Date: 2026-10-17 · Status: research note, not a decision · Ticket: #128, part of #127

The question: when a producer or mix engineer gets a Live Set they did not make, how do they find a fault before they fix it? What do they ask first, what evidence do they gather, how do they confirm the cause, and how do they choose between fixes that sound the same? The faults in scope are the ones a plant can make: a level, a register (octave) error, a mute, a clash between two parts, an effect set wrong.

Markers: **[read]** read in the primary source this session · **[secondhand]** reported by someone else, not read at its source · **[inferred]** my own conclusion · **[not read]** the source exists but I could not reach it.

## Short answer

The sources share one loop. In order:

1. **Start from the complaint, then listen to the whole thing.** Mix Rescue starts from what the owner says is wrong ("the bass guitar became overbearing and rumbly"). Senior then listens to the raw tracks before he touches anything. **[read]**
2. **Compare with a reference, at the same loudness.** Senior's best alarm for masking is a commercial reference matched for loudness and tone. Katz warns that the louder of two versions will sound better, even by a tenth of a dB, so every comparison must be level-matched. **[read]**
3. **Do not trust the part the complaint names.** In the metal Mix Rescue the "problem bass" was fine. The fault was the kick, and the drums interacting with it. Soloing the bass showed it was evenly played. The fault only existed in context. **[read]**
4. **Isolate by switching things off, one at a time.** Toggle the mute of each suspect track while listening to the part that suffers. If it "takes a step forward" when a track goes off, that track is the culprit. For effects, bypass each return for a few seconds and listen again. **[read]**
5. **Use a measurement to confirm, not to decide.** Spectrum overlays of two parts, a mono check, a second pair of speakers. Senior: "be very wary if [software] contradicts the evidence of your own ears." **[read]**
6. **Fix, then judge the fix in the full mix, never in solo.** "It's what your tracks sound like in the context of the mix that really counts." **[read]**

**Where they disagree.** Mostly on how far to trust the eye. Senior uses a spectrum analyser to diagnose the low end, because small-studio speakers lie there, but puts the ear above the software. Katz trusts calibrated, level-matched listening and says the ear is easily fooled ("You are not immune to psychoacoustics"). They also differ on where to put the fix: Senior often fixes on a *different* track from the one that sounds wrong (cut the competing part, not the victim). Elsewhere he goes back to the source (reprogram the MIDI, replace the sample) rather than process.

**How they choose between fixes that sound the same.** No source I read covers two fixes that sound *identical*. They choose between fixes that sound *similar* by asking: which has the fewest side effects, which gives more control, which is the lightest touch, and which keeps what already works. Katz adds: no processing at all when the recording does not need it. **[read]** For the mentor this suggests one rule: among fixes that sound the same, prefer the one that changes the fewest things and is easiest for the user to see and undo. **[inferred]**

## The diagnosis steps, with the evidence

### 1. Ask what is wrong, and hear it whole

- Each Mix Rescue opens with the owner's complaint, in their words. Metal (Jan 2011): the owner said "the bass guitar became overbearing and rumbly well before the bass part was really audible enough in the balance." **[read]**
- Senior then listens to the raw tracks. Rearranging (Mar 2020): "Auditioning Roger's raw tracks in Reaper, I quickly discovered some reasons for these low-end difficulties." Durban (May 2009): "it was immediately apparent that the kick was much too distant and woolly." **[read]**
- Katz, on listening before judging: "So my first advice would be to try not to leap to conclusions." **[read]** (Weiss interview, Part 1.)

### 2. Compare with a reference

- Senior, on finding masking: "there are various things that alert me to masking, but none better than mix referencing." Match the mix to commercial releases for loudness and tone. Anything not clearly audible next to them may be masked. **[read]** (SOS Q&A, Mar 2018.)
- Senior also used the owner's references to set the low end in the metal mix: "After a trawl through some reference mixes that Johnny had sent, it was clear that extreme low frequencies played little part in the style." **[read]**
- Katz, on why the comparison must be level-matched: "make sure that the output levels of the two units exactly match within a tenth of a dB … Because if not, the louder of the two will probably sound better." And: "even a tenth or two dB louder … gives the impression of having more depth and dimension." He says this about comparing two units, but the same effect applies to comparing a mix with its fix. **[read]** (Weiss interview; the extension to before/after is **[inferred]**.)

For the mentor: on a plant, the base Set is the reference. On a user's own Set there is none (an open item on #127).

### 3. The part that sounds wrong may not be the fault

- Metal Mix Rescue: "the frequency-balance of the supposedly problematic bass part was fine … the problems came not from the bass part, but from various other tracks that were interacting with it in the context of the full mix — chiefly, the drum tracks." **[read]**
- Same article: the kick and bass built up at 130 Hz. This "gave the subjective impression that the bass line wasn't very consistent, even though soloing the bass track revealed it to be quite evenly played." **[read]**
- Senior, on masking: if the vocal lacks presence, "the likelihood is that something else in the arrangement is obscuring a critical frequency range of the vocal." **[read]**

This matters for the clash plant: the symptom is on one track and the cause on another.

### 4. Isolate: mute, solo, bypass

- **Mute the suspects, one at a time.** "Try going back to the mix and toggling the mute button for any likely tracks, while all the time listening to the vocal sound and presence." The test for the culprit: does "the vocal take a step forward when you turn off the acoustic guitar?" **[read]** (SOS Q&A, Mar 2018.)
- **Solo to inspect one part, not to judge it.** Senior soloed the bass to check whether it was played evenly (it was). But: "Avoid EQ'ing in solo, because most people instinctively try to give every track a 'forward' sound if they work like that." **[read]** (Metal; Mix Mistakes #7.)
- **Bypass effects to judge them.** Near the end of a mix, "bypass each return for a few seconds during playback". This "can really help you to gauge whether each effect is set up right". **[read]** (Mix Mistakes #6.)
- **Live's own switches.** Each track has a Track Activator (its mute) and a Solo button. "By default, soloing a track simply mutes all other tracks." Return tracks stay audible only if Solo in Place is on. Every device has an Activator: "Turning a device off is like temporarily deleting it: the signal remains unprocessed." **[read]** (Live 12 manual, 18.6 and 23.2.1.)

A Live trap for the mentor: with Solo in Place off, soloing a track also silences its reverb and delay returns. A send effect set wrong then disappears from the solo, and the track sounds fine. **[inferred]** from manual 18.6.

### 5. Measure to confirm

- **Spectrum overlays of two parts.** Metal: the kick (yellow) and bass (red) traces on one analyser showed where they overlapped. Preslin Davis (Feb 2010): the bass "was overpowering the kick … in the crucial 100-200Hz region, while the kick was delivering more low bass below 70Hz." **[read]**
- **Mono.** "Listening to your mix in mono is a quick way to check if any stereo signal in your mix harbours phase problems." For masking, mono "often makes masking issues more obvious." Durban: "the bass was losing too much level and body in the transition to mono." **[read]**
- **Other speakers.** Metal: the last fault, "a persistent pitched kick-drum resonance … at 74Hz", only showed up "while checking out the track on some secondary speaker systems." Mix Mistakes #2: "Compare mixes on more than one listening system, if possible, and at different playback volumes." **[read]**
- **The ear wins over the meter.** Mix Mistakes #2: "Whatever any software tells you, though, be very wary if it contradicts the evidence of your own ears." On pitch software: it may "show some notes as 'correct' even when they're still audibly awry." **[read]**
- **Live's measuring devices.** Spectrum "performs real-time frequency analysis … with dB along the vertical axis and frequency/pitch along the horizontal" and "does not alter the incoming signal." EQ Eight shows the output spectrum when Analyze is on. Tuner shows "the nearest detected note name." Utility has a Mono switch and per-channel Phase inversion. The mixer meter shows peak and RMS; "RMS meters give a better impression of perceived loudness." **[read]** (Live 12 manual, 29.38, 29.15, 29.39, 29.40, 18.1.)

### 6. Fix, then judge in context

- "It's what your tracks sound like in the context of the mix that really counts." "When setting filter frequencies, make sure to listen within the context of the mix." **[read]** (Mix Mistakes #4, #7.)
- "Try to get the overall balance of your track working before you start applying" mix-bus processing. **[read]** (Mix Mistakes #10.)

## Fault by fault: the plants

| Plant | What the sources would check | Live-specific evidence |
|---|---|---|
| Level | Reference at matched loudness; the RMS meter; mute-toggle to hear what the part adds **[read]** | Track Volume, clip gain, device gains (Utility) — several places can hold the same change **[read]** |
| Register (octave) | Listen in context; a tuner or the analyser's pitch axis; reference **[inferred]** — no source I read treats an octave error directly | Tuner note name; Spectrum's pitch axis; the notes in the clip; a Pitch MIDI effect; the instrument's own transpose **[read]** |
| Mute | Mute and solo states; is the part in the mix at all **[inferred]** | Track Activator, clip deactivation, device Activator, a muted rack chain **[read]** for the first and third |
| Clash | Mute-toggle while listening to the victim; spectrum overlay of the two parts; mono **[read]** | Spectrum on each track, or EQ Eight's analyser **[read]** |
| Effect set wrong | Bypass the return for a few seconds and listen again **[read]** | Device Activator; Solo in Place, so soloing does not hide the return **[read]** |

## Choosing between fixes

What Senior says when he picks one fix over another:

- **Fewest side effects.** Offline pitch-shifting, because it tends "to produce the fewest unwanted artifacts with polyphonic audio." **[read]** (Clarity Of Sound, Nov 2010.)
- **Most control.** For the kick: "I opted again for the more controllable approach of layering a separate sample on top of the kick drum." **[read]** (Durban.)
- **Lightest tool that works.** On a piano part: multing or dynamic EQ "felt rather too much like using a sledgehammer to crack a nut", so he reprogrammed it, after which it was "a walk in the park to rebalance the track from the MIDI data." **[read]** (Clarity.)
- **Fix at the source when processing can't reach the cause.** The kick's late low end "was immune to these measures", so he added a sample. For the bass: "I opted to sidestep both of these thorny processing problems by simply reprogramming Axel's bass part by ear." **[read]** (Clarity.)
- **Fix the other part.** "If a given instrument isn't coming through well in that spectral area, apply some cuts to competing channels instead." Metal: a 3 dB cut at 130 Hz on the *kick*, to let the bass through. **[read]** (Mix Mistakes #7; Metal.)
- **Keep what already works.** On drums: "I was loath to do this with simple static EQ, as I liked their edgy sound." And from Preslin Davis: "it's important to remember who the music actually belongs to." **[read]**
- **Look at the arrangement first.** "The roots of many a mix problem can be traced back to the musical arrangement." **[read]** (Mix Mistakes #5.)

Katz on how much to do: "A little bit goes a long way. … Or don't use any, if the recording doesn't call for it!" **[read]** (Tape Op #116 bonus interview.)

### When two fixes truly sound the same

No source I read addresses this. They all choose between fixes that sound *different*, by ear. **[inferred]** from the absence.

For the octave case from #117 (a Pitch device at −12 st in front of Operator, against Operator's own Transpose), the Live manual says what could make them differ:

- Operator has "a global Transpose knob … the global transposition setting for the instrument." **[read]** (31.9.7, 31.9.10.3.)
- An oscillator in Fixed mode does "not respond to note pitch but instead play a fixed frequency." **[read]** (31.9.2.3.)
- "The rates of all envelopes can be controlled by note pitch." With Time < Key up, "the envelopes run faster when higher notes are played." **[read]** (31.9.4.)
- The Pitch MIDI effect changes the notes before they reach the instrument. **[read]** (30.5.)

So a Pitch device changes the note numbers Operator sees, and anything keyed to the note (Time < Key, key tracking) may follow it. The manual does not say whether Operator's Transpose also moves the note those controls see. If it does not, the two fixes can sound different on a patch that uses key tracking. **[inferred]** — unverified. A null test of both fixes against the base would settle it for any given patch.

This fits the rule already in the glossary's **Diagnosis**: two fixes that sound the same are both right, and when the patch makes that uncertain, gather more evidence. The sources add a tie-break the mentor can state: prefer the fix that changes fewest things, keeps what the owner made, and is easiest to see and undo. **[inferred]**

## Where the sources disagree

1. **Eye or ear.** Senior uses analysers to diagnose (overlays, low end on small speakers), but the ear has the last word. Katz trusts calibrated, level-matched listening, and warns that loudness alone changes what we hear. Both agree a measurement confirms; neither lets it decide alone.
2. **Solo.** Senior solos to inspect a part (is it played evenly?) and forbids judging tone in solo. Live's default solo also drops the returns, so a soloed track lies about its effects. The sources agree on the rule; they differ only on how much soloing to do.
3. **Where the fix goes.** Senior fixes on the symptom track, on the competing track, or back at the source (MIDI, sample, arrangement), case by case. Katz pushes fixes upstream: fix it in the mix, not in mastering. Neither gives a fixed order.

## What is missing

- **Senior's book.** *Mixing Secrets for the Small Studio* (chapters 3, 4 and 8 on low end, referencing and the raw balance) was not reachable: the free chapter PDFs on cambridge-mt.com returned 403. Everything from Senior here is from his Sound On Sound articles. **[not read]**
- **Katz's book.** *Mastering Audio* was not read. His views here come from two interviews. **[not read]**
- **Owsinski.** *The Mixing Engineer's Handbook* was not reachable. **[not read]**
- **Octave errors.** No source I read treats a part in the wrong octave as a mix fault. The steps for it here are inferred.
- **Mutes as faults.** The sources use mute as a test, not as a fault to find. Checking mute states first is inferred, and backed only by Live's manual.
- **Operator Transpose and key tracking.** Whether Operator's Transpose shifts the note that key tracking sees is not in the manual. A quick test in Live would answer it.

## Sources

- Senior, M. (2011, Sep). "Mix Mistakes." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-mistakes **[read]**
- Senior, M. (2011, Jan). "Mix Rescue: Mixing Metal." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-rescue-mixing-metal **[read]**
- Senior, M. (2010, Feb). "Mix Rescue: Preslin Davis." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-rescue-preslin-davis **[read]**
- Senior, M. (2009, May). "Mix Rescue: Chris Durban." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-rescue-chris-durban **[read]**
- Senior, M. (2010, Nov). "Mix Rescue: Clarity Of Sound." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-rescue-clarity-sound **[read]**
- Senior, M. (2020, Mar). "Mix Rescue: Rearranging." *Sound On Sound.* https://www.soundonsound.com/techniques/mix-rescue-rearranging **[read]**
- Senior, M. (2018, Mar). "Q. How can I locate the masking problems in my mix?" *Sound On Sound.* https://www.soundonsound.com/sound-advice/q-how-can-locate-masking-problems-my-mix **[read]**
- Katz, B. "Bob Katz Interview, Part 1." Weiss Engineering blog (2023). https://weiss.ch/blog/highend-hifi/bob-katz-interview-part-1/ **[read]**
- Katz, B. "Bob Katz Mastering Secrets: Bonus Interview." *Tape Op* #116. https://tapeop.com/interviews/116/bob-katz-bonus **[read]**
- Robjohns, H. (2003, Oct). Review of Katz, *Mastering Audio.* *Sound On Sound.* https://www.soundonsound.com/reviews/bob-katz-mastering-audio **[read]** (a review, used only for the book's scope)
- Ableton. *Live 12 Reference Manual*: 18 Mixing (18.1, 18.6), 23 Working with Instruments and Effects (23.2.1), 29 Audio Effect Reference (29.15 EQ Eight, 29.38 Spectrum, 29.39 Tuner, 29.40 Utility), 30 MIDI Effect Reference (30.5 Pitch), 31 Instrument Reference (31.9 Operator), 10 Editing MIDI (10.5.9.1 Transpose). https://www.ableton.com/en/manual/ **[read]**
- Senior, M. (2011/2018). *Mixing Secrets for the Small Studio.* Focal Press / Routledge. **[not read]**
- Katz, B. (2002/2015). *Mastering Audio.* Focal Press. **[not read]**
- Owsinski, B. *The Mixing Engineer's Handbook.* **[not read]**
