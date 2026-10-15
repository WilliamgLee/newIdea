# Kiki Classroom

*A tiny AI office that makes learning videos for kids, built by someone whose first YouTube
channel was buried by a copyright strike.*

The first time I saw the little yellow dollar sign next to my videos, I didn't know what it meant.
I found out quickly: limited ads, then fewer views, then almost none. That channel was my first
side hustle. Kiki Classroom is what I built after I understood why it failed.

---

## The office

Kiki Classroom works like a small office with six AI staff. Each one does a single job, then walks
the result over to the next desk. That is literal: the dashboard is a pixel-art office where you
can watch them do it.

```
topic ──▶ Scriptwriter ──▶ Child Safety Advisor ──▶ ✋ I approve the script
      ──▶ Voice ──▶ Animator ──▶ Editor ──▶ ✋ I approve the video ──▶ Delivery
```

Out comes a 30-second vertical video for children aged 3 to 6: Kiki the cat counting apples,
finding the odd one out, guessing what hides behind a question mark, or dancing to music notes.
It runs entirely on my laptop, and it is not monetised, on purpose. The reason for that is part of
the story.

---

## Version 0 · 2024, by hand

I was in high school and wanted income that didn't eat my study time. Shorts seemed perfect.

Every video took the same route. I picked channels close to my idea as reference, saved matching
clips from TikTok, asked ChatGPT to shape them into a storyline and script, generated the voice
with ElevenLabs, and edited everything myself. It was slow, but the channel got monetised and made
its first **$7**. Small, but real, and enough to make me want more.

## Version 0.5 · Hiring a friend

To upload faster, I brought in a friend and paid per video uploaded.

He used clips from YouTube instead of TikTok. Copyright claims followed, then the yellow dollar,
then silence. New uploads stopped reaching anyone, and I quit.

It took me a while to admit the real cause. I never told him the rules: where clips could come
from, what was off-limits, what to check before publishing. I paid for quantity and left quality
undefined. That's on me, not him.

## Version 1 · The office

At university I wanted to try again, differently. A friend of mine makes Roblox videos for young
kids. To me they look ridiculous. They also get millions of views. I studied what his videos share
and landed on short learning videos for toddlers, closer to Cocomelon than to anything I had made
before.

This time I didn't want to edit a single frame by hand. I like tinkering with AI, so I tried to
automate the whole chain, script to voice to final cut, with Claude as my coding partner.

The voice nearly ended it early. edge-tts was free but sounded flat, nothing a three-year-old would
sit through. Coqui's XTTS-v2 sounded warm and ran on my own GPU, until I read its licence:
non-commercial use only. I chose to respect that rather than look for a loophole, and the goal
changed with it. If this couldn't earn money, it could still be something useful for kids.

---

## Four rules the office follows

Each rule exists because I broke it once.

### Rule 1 · Nothing borrowed

My first channel died from borrowed footage, so nothing in a Kiki Classroom video comes from
someone else. Characters, objects and backgrounds are drawn as SVG by code, frame by frame. The
three background tracks are composed in code and synthesised note by note. The interface fonts are
open-licensed and shipped with the project. There is no licence to check because there is nothing
to license.

### Rule 2 · Write the rules down before handing off work

I never gave my friend the rules. The office gets them in writing.

The Scriptwriter (a local language model) must answer in a strict JSON format that only accepts
characters, objects and templates that actually exist, and code rejects scripts that break the
structure. The Child Safety Advisor then grades every script against seven written criteria:
simple words, nothing scary, no adult themes, no brands or personal data, correct facts, a clear
lesson, and no pressure on kids to like, subscribe or buy. A script that fails goes back to the
writer with the reasons attached.

### Rule 3 · Check the machine, don't guess

I started with Qwen2.5 7B, and it kept crashing. My fix was a 100-second pause before the Safety
Advisor, so the GPU could "rest". It worked once, then failed every time after.

The GPU wasn't tired. It was full. My laptop's RTX 4050 has 6 GB of video memory; the 7B model
alone needs about 4.7 GB, plus room for the conversation, plus whatever Windows is already using.
When a model doesn't fit, Ollama doesn't refuse; it quietly pushes part of it onto the CPU and
slows down until requests time out. Pausing changed nothing, because Ollama keeps a model loaded
for minutes after its last request and the voice model holds memory between jobs too. Most likely
the first run only worked because it started with an empty GPU.

So I stopped guessing. The office now runs Qwen2.5 3B, which fits with room to spare, and before
the voice model loads, the pipeline asks Ollama to unload and keeps checking until the memory is
actually free.

The same rule applies to facts. A 3B model will happily draw a blue apple or a cow that says
"woof". Instead of hoping the Safety Advisor notices, code checks a small fact dictionary: natural
colours for each object, the sound each animal makes, the sides of each shape, and whether the
counting matches the objects on screen.

### Rule 4 · A person has the last word

However good the checks get, a child's video is not something to publish unseen. I approve every
script before it is voiced and every video before it leaves the office. That step is not a
temporary safeguard. It is part of the design.

---

## What it can't do (yet)

- **Earn money.** XTTS-v2 is non-commercial, so the project isn't monetised.
- **Look like a studio.** Code-drawn animation is clean and consistent, but it is not Cocomelon.
- **Be trusted blindly.** A small model still makes mistakes the fact dictionary doesn't know
  about, which is exactly why Rule 4 exists.
- **Speak Indonesian.** XTTS-v2 doesn't support Bahasa Indonesia, so the videos are in English.
- **Run without my laptop.** Everything lives on one 6 GB GPU that has to stay switched on.

## If I had a budget

Two ideas wait on money rather than time.

**Fine-tuning.** Every script I approve is a perfect example of what the office should write. With
enough of them, a small model trained on my own approvals could get the format and tone right the
first time.

**Leaving the laptop.** Hosted APIs for writing, checking and voice, with n8n orchestrating the
steps, so the office keeps working with my laptop closed and model size stops being decided by
6 GB of memory.

Either way, Rule 4 stays.

---

## Spec sheet

- **Thinks with:** Qwen2.5 3B via Ollama, local. No fine-tuning yet; strict JSON schemas, code
  validation and retries keep it on track.
- **Speaks with:** Coqui XTTS-v2, local, with word timings estimated for lip-sync and subtitles.
- **Draws with:** 2 characters, 29 objects, 6 backgrounds and 10 scene templates in SVG, rendered
  in headless Chromium.
- **Edits with:** ffmpeg, adding word-by-word subtitles and background music that ducks under the
  narration.
- **Runs on:** one laptop with an NVIDIA RTX 4050 (6 GB VRAM).
- **Checked by:** 268 automated tests.
