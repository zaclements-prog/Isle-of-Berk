# Plan 6: Rough-terrain obstacle interactions (task #11)

**Goal.** Toothless crosses uneven ground and obstacles the way a big cat does. He picks his way across, steps over or
onto what is in his path, and keeps every paw honest:
- slip ≤ 1 cm;
- penetration and float ≤ 2 cm;
- proxies ≤ 2 cm.

None of the existing gates may regress.

## The rough lanes

`src/dev/lab/course.ts` (`ROUGH_LANES`, east of the steps, clear of every other script) has six lanes. Each runs along
−Z from z = −8 to −38:

| Lane     | What                                                                 |
|----------|----------------------------------------------------------------------|
| rubble   | 140 flattened rocks, 0.08–0.25 m                                     |
| logs     | 7 logs across the lane to step over, r 0.12–0.22 m (≤ 0.44 m tall), skewed ±20° |
| broken   | 0.6 m blocks with tops 0.02–0.35 m                                   |
| mounds   | 12 sunk flattened spheres, crests 0.2–0.5 m                          |
| ditch    | two 0.6 m platforms (a 0.3 m entry step) with a 1.2 m gap            |
| angled   | a 0.5 m platform skewed 35°: up onto one edge, down off the far one  |

`ROUGH_SCRIPTS` runs a walk (prowl), a trot and a gallop down each lane; each must travel 14 m. They are not gated
yet. The Motion Lab can play them (`berk.lab.play('rough-logs-walk')`).

## Where things stand

Run with the pose library loaded:

- **Before this plan:** 8 of 18 pass. With the authored cycles off it is also 8 of 18, failing on different lanes,
  so the weakness is in the planner, body and contact system, not the cycles.
- **Now:** 14 of 18 pass. Over rough ground the gallop is held to a trot, the hold lasts 2 s past the last
  rough patch, and the gallop runs end inside their lanes (see "Done" below).
- **Still failing:**
  - logs trot: penetration 6.9 cm;
  - broken-ground walk: penetration 3.1 cm, float 8.8 cm;
  - broken-ground gallop: penetration 4.8 cm;
  - mounds trot: float 3.4 cm.

## What the diagnosis found

1. **The body rides the terrain probe, not the paws.**
   - `BodySolver.ride` with `terrainFollow` 1 rides each leg pair on the mean of three ground probes under its joints.
   - A log or a rock under the shoulders, with the front paws on the floor beside it, lifts the shoulders by about
     a third of its height.
   - The front legs then fall short: they float 2–8 cm even when he is standing still.
   - Capping that lift at the supports breaks ramps, climbing and hops, which all need the probe to lead.
   - Fix direction: tell narrow obstacles from rising ground. Options include a median that keeps the leading
     behaviour on ramps, or probing the planted paws' own spans.
2. **Short legs settle only halfway.** The proportional `shortfallLower` leaves half of a leg's shortfall. An
   integral term fixed broken-ground floats but changed the boulder and gallop gates chaotically, so it was taken out
   until (1) is fixed.
3. **Swinging paws graze rises next to the foothold.** The edge check only flags rises over 15 cm, so a paw lands
   beside a block 3–15 cm higher and its pad clips the block.
   - Preferring level footholds helped on broken ground but perturbed the boulder gate.
   - Placing the paw from above (travel finished before the final drop) wrecked the gallop's swing timing.
   - Fix direction: a pad-sized clearance check on the landing, plus a vertical final approach only at walk and trot.
4. **Gallop on rough ground.** At 10 m/s every rough lane fails: a paw sinks into an obstacle or a stance slips.
   Galloping across rubble is not what an animal does either, so rough ground caps the gallop to a trot (see "Done").
   The gallop runs still fail, so the next step is an earlier and stronger brake.
5. **Fragile gates.** boulders, idle-turn and gallop-straight sit within millimetres of their limits, and any change
   to footfall timing or hip position can flip them. Fixing (1) and (3) properly should widen those margins, rather
   than more tuning.

## Done

- The rough lanes and `ROUGH_SCRIPTS`, playable in the Motion Lab.
- **Picking his way** (`tuning.rough`, `DragonCharacter.roughCap`):
  - a 4×3 grid of ground probes ahead, reaching farther the faster he goes;
  - roughness = the largest height off their least-squares plane, so ramps and side slopes read as smooth;
  - from 6 cm of roughness, the gallop is capped to trot speed, also while climbing (the mounds), and the cap is
    held for `roughHold` (2 s), so a flat top between obstacles doesn't let him re-accelerate.
- From Plan 5, still in place:
  - the ground guard for swinging paws;
  - the planner stepping short of an obstacle it can't clear;
  - the IK re-aim at clamped joints.

## Next

1. Body ride: tell narrow obstacles from rising ground (finding 1). Then bring back the integral lowering (finding 2).
2. Landing clearance under the pad, and a vertical final approach at walk and trot (finding 3).
3. Gallop: an earlier and stronger brake before rough ground (finding 4).
4. Gate the rough lanes once they pass, then record lab videos of each lane.
