# Jabal al-Nour: build notes

Built with the `worldsmith` skill (`/home/moey/.shared/skills/worldsmith`), source copied from Madinah Horizon
and adapted. Brief: `prompt.txt`.

## State (update after every step)

- Phase: DONE for review (2026-11-16). Not published: no GitHub repo, no push. Moey reviews first.
- Last critic capture: verify/iter-21 (6 poses 2560x1440 + flight); critic iterations at iter-09, 15, 17, 20, 21
  (5 of 5, stopping rule reached). Final verdict text: verify/iter-21/critic.md, highest severity "blocker" on the
  city, the mountain silhouette and the cave, which were "major" in iterations 3-4 with little change since:
  treated as critic noise, but the city and the cave are the honest weak spots.
- Minified index.html: 0 console errors at High, Low (nour=2) and each Time (nourTime=0/1/2): verify/final-*.
- Perf (verify/final-bench, dev.html, 2560x1440, 60 s flight, RTX 3070 shared with other worlds): GPU avg 5.56 ms,
  p99 8.49, max 8.75. Load to menu 3-5 s.
- Deliverables: index.html (~97 KB, ~39 KB gzipped), perf.txt, README.md with screenshots, prompt.txt, LICENSE.
- Known open items: city reads as repeated boxes from the mountain; the cave terrace is dark at dawn and its
  stairs are plain; Jabal al-Nour reads as a cone from far away; flight has a jump near the summit (frames 4-5).
- Found while building: the far-terrain mesh is back-facing from above in the shared madinah-horizon code, so its
  normals were flipped (unlit by the sun). Fixed here (`fl_` ignores facing for mat 1); the sibling worlds still
  have it. Not edited there.

## Geography (composed, not to scale)

Axes: +x east, -z north, y up, metres. The summit knob is at the origin.

| Feature | Real | Here |
|---|---|---|
| Jabal al-Nour | summit 642 m ASL, steep granite peak NE of the Haram; summit looks "as if two mountains are on top of each other" | a steep cone (196 m, 470 m radius) carrying a steeper knob (92 m, 115 m radius); summit about 308 m above the composed datum, ~285 m above its foot |
| The path | about 1,750 steps (sources vary: 600-1,750); the old route starts on the south side | zig-zag flights up the south-south-east face from the foot to the summit (~1,700 risers of 17 cm), turns paved as landings, every third turn a rest platform with a shade roof |
| Cave of Hira | about 3.7 m long, 1.6 m wide, in a gap among stacked rocks just below the top; Madain Project: it "faces the direction of the Kaaba" | a cleft under three leaning boulders 28 m below the summit on the south-west side, its mouth facing the Haram; shown from outside only, the inside is a dark void |
| Masjid al-Haram | ~4-5 km SW of the mountain | composed 3.4 km SW (bearing 220 deg), white arcaded wings around the open courtyard, the older inner portico, the north expansion, 10 minarets with crescent finials, the Kaaba as a plain black block with a plain gold band |
| Abraj al-Bait clock tower | ~601 m, clock faces 43 m across, golden crescent finial, just south of the Haram | podium, six hotel towers, the main tower to ~610 m with four 48 m clock dials (hands set per Time), stepped crown, crescent finial |
| Makkah | city fills the valleys between bare granite ranges | valley network drawn as segments; houses and blocks fill the floors, hotels and towers near the Haram; the sight line from the mountain to the Haram is kept low |

Sources checked 2026-11-16:
- Wikipedia, Jabal al-Nour (via search summaries): elevation 642 m; 1,750 steps.
- Madain Project, Jabal al-Nour (madainproject.com/jabal_al_nour): cave 3.7 m x 1.6 m, faces the direction of the
  Kaaba; summit "as if two mountains are on top of each other"; no vegetation but a few thorns.
- Discover Makkah (discovermakkah.sa, via search summary): ~4 km NE of the Haram; old path began on the southern
  side; cave a gap among stacked rocks ~3 m x 1.5-2 m; it says the entrance faces north with a small opening
  toward the Kaaba. The brief asked for the mouth facing the Kaaba, so this world follows Madain Project and the
  brief; noted here as a known disagreement between sources.
- The Clock Towers / Abraj Al Bait (Wikipedia, Britannica, Gulf News via search): 601 m (607 m in some tables),
  clock faces 43 m, green and white lighting at night.

Informed artistic guesses: the exact route of the path, the number and spacing of rest platforms and shade roofs,
wall and railing design, the summit wall ring, the cave's surroundings, the city's layout and building mix, the
Haram's massing, the clock tower's massing.

## Six poses (keys 1-6)

1. On a turn of the lower flights, looking up the zig-zag to the summit.
2. On an upper turn that sees furthest toward the Haram: the valley, the city, the clock tower.
3. On the summit platform, looking down the south-south-east face and the valleys.
4. On the terrace in front of the cave, looking at the mouth in the cleft.
5. Beside the cave mouth, looking out the way it faces: toward the clock tower and the Haram.
6. Flight: high north-east of the mountain, looking south-west over it to Makkah.

Fly path (60 s): up the flights (seven keys along the turns), over the summit, to the cave terrace, out from the
cave, around and up to pose 6.

## Time presets (localStorage nourTime, default Dawn)

| | Dawn | Golden hour | Night |
|---|---|---|---|
| key light | sun 6 deg up from bearing 72 (ENE) | sun 9 deg up from 250 (WSW) | moon 35 deg up from 140 (SE) |
| exposure | 0.98 | 0.74 | 2.7 |
| lights | x0.2 (street lamps going out) | x1 (a few windows) | x6: windows, street lamps, the Haram floodlit, the clock face white and green |
| sky | pink-gold horizon, last stars near the zenith | gold horizon, cirrus | stars on a fixed grid, moon disc, warm city glow low on the horizon |

The far ranges' long shadows reach the near field through a lit-height texture (2 m columns) and the far buildings
through a lit height per instance; the far terrain keeps its vertex-baked shadow.

## Critic intent paragraph

Jabal al-Nour above Makkah, Saudi Arabia, at dawn. A steep bare mountain of dark weathered granite boulders with a
stepped stone path and low walls zig-zagging up it, rest platforms, a summit, and just below the top a narrow
cave mouth in a cleft of leaning boulders (seen from outside only). Far below, the city of Makkah fills the valleys
between other bare brown mountains, with the Grand Mosque and the very tall clock tower visible in the distance.
Quiet, reverent, early light: peaks lit warm, valleys still in cool shadow, thin haze. No people, no text.

## Movement and audio

- Walk: eye 1.7 m, gravity, slide collision on the density field inside the near box (384 x 248 x 384 m at 1 m);
  outside it the walker follows the ground model. Fly (F, or E to lift off): radius 2.6 km, ceiling 900 m.
  Dev flight on P, benchmark B.
- Audio: wind bed with gusts, a whistle of the gusts that grows with height, air rush with speed, small birds and
  rock doves at dawn (fewer at golden hour, none at night), a distant city hum at night only. Nothing recited.
