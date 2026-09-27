# Isle of Berk Rebuild — Program Roadmap

**Date:** 2026-09-26
**Status:** Approved in brainstorming (program decisions + phase order). Phase 1 has its own spec.
**Supersedes:** the `C:\Users\zacle\dragon-walk` game (June 2026), which stays playable until Phase 1 sign-off.

## Why a rebuild

The June game never reached a good place on assets, character motion or flight. A full read of the old
code (`dragon-walk/index.html`, 3,650 lines, single file) found:

- **Toothless is the wrong asset.** He is a Hunyuan3D-generated mesh frozen in a flat glide pose: legs too
  short to stand, neck too short to lift the head, and a taut spread wing membrane that cannot fold. Bone
  tweaks cannot fix proportions baked into geometry — the root cause of the "crawling" walk and the
  crumpled wing fold.
- **Everything else is primitives.** Village, trees, NPC dragons and villagers are boxes, cylinders and
  cones with canvas-drawn textures.
- **About a third of the code is dead** (a hidden legacy skeleton, hidden leg/wing meshes, a one-shot clip
  system that writes to hidden bones).
- **Flight** is a keyboard-banked energy model with stalls.
- Observed in-game (2026-09-26): wings half-raised on the ground, pollen motes reading as snow, the chase
  camera clipping into buildings, a huge white sun glare on the ocean from above, lime-blob eyes.
- The automated test browser renders on the Intel Iris Xe iGPU, not the RTX 3080 Ti — the old game's
  ~50 fps was measured there.

## Program decisions

| Decision | Choice |
|---|---|
| Art direction | **Animated-film look** (How to Train Your Dragon 2/3): appealing, expressive stylized characters in lush, richly detailed near-photoreal landscapes with warm cinematic light. |
| Asset sourcing | **CC0 world + characters built in-house.** Rocks, cliffs, ground/wood/stone textures and small props from CC0 scanned libraries (Poly Haven, verified reachable). Toothless, other dragons, Hiccup, villagers and Viking buildings built in Blender by script, designed for rigging and animation from day one. |
| Flight | **Mouse-steered cinematic.** Fly where you look. W = flap/accelerate, S = brake to a hover, Shift = dive/boost, Space = climb burst, A/D = barrel-roll dodge. Physically flavoured (dives gain speed, hard turns bleed it, banking is visual) but no stalls. |
| World | **Film-faithful Berk, ~4–5× bigger** than the old island: village terraced around the harbour cliffs, Great Hall carved into the mountain, the Cove, the Kill Ring, Raven Point forest, sea stacks. Detail concentrated where you land. |
| Characters | Toothless (hero), **Hiccup riding Toothless**, **other dragons**, **villagers**, **animals & ambient life**. |
| Sequencing | **Vertical slice first**: prove the pipeline at final quality in one small area before scaling out. |
| Toothless approach | **Sculpt + procedural motion**: script-sculpted standing model with fan-folding wings and a purpose-built rig; a live foot-planting gait engine with springs and an authored pose library. |

## Phases

Each phase gets its own spec → implementation plan → build → user sign-off.

1. **Vertical slice** — new engine foundation; Toothless rebuilt (model, rig, ground motion incl. cat-like
   climbing and personality idles, jump, plasma); the Cove at final quality.
   Spec: `2026-09-26-phase1-vertical-slice-design.md`.
2. **Flight + Hiccup** — the mouse-steered flight controller and camera; takeoff, flap, glide, bank, dive,
   hover, barrel roll, landing; procedural wing-beat on the Phase 1 wing rig; Hiccup modelled and rigged
   in-house, mounted on the saddle, leaning into turns and working the prosthetic-fin pedal; flight FX
   (wind trails, speed lines, cloud fly-through).
3. **Full Berk island** — terrain at the new scale with LOD/streaming, coastline and ocean, sea stacks,
   forests, the landmark sites; the Cove region stitched in; day/night cycle; the colour shrine returns.
4. **The village** — Berk-style Viking architecture (carved dragon-head gables, shields, painted wood,
   turf and thatch roofs), the Great Hall, docks and longboats, forge, dragon perches and feeding
   stations, CC0 props, fires and smoke, plasma-damageable buildings.
5. **Characters & life** — NPC dragons (Stormcutter, Deadly Nadder, Gronckle, Monstrous Nightmare) built on
   the Toothless pipeline and motion system; animated villagers (walk, work, wave, flee); sheep and yaks;
   bird flocks, fish and whales, butterflies.

## Cross-phase contracts (Phase 1 must honour these)

- **Species-agnostic dragon pipeline.** The build scripts are driven by a proportions file and emit rig
  metadata; the motion system reads that metadata, never hard-coded Toothless numbers. NPC dragons in
  Phase 5 reuse both.
- **Rider-ready Toothless.** He ships with the saddle, harness and prosthetic-fin linkage in Phase 1, so
  Hiccup mounts in Phase 2 without re-rigging.
- **Wing rig built for flight.** The Phase 1 wing skeleton (arm + fan ribs) is the one Phase 2 flies with.
- **Region system.** The Cove is a self-contained world region that drops into the Phase 3 island.
- **Sun-parameterised lighting.** Everything is lit from a sun direction, so Phase 3 can add day/night.
- **Quality presets** (High for the RTX 3080 Ti, Low for integrated graphics) exist from Phase 1 on.

## Features carried over from the old game

| Old feature | Returns in |
|---|---|
| Plasma blast (charge, bolt, explosion, scorch) | Phase 1 |
| Colour shrine skins (Night Fury / Night Light / Emerald / Albino) | Phase 3 |
| Plasma damage to buildings | Phase 4 |
| NPC dragons flying circuits and perching | Phase 5 |
| Villagers fleeing a charging dragon | Phase 5 |

## Retiring the old game

`dragon-walk` is not modified. After Phase 1 sign-off the desktop shortcut ("Isle of Berk") is repointed to
the new build; `dragon-walk` is kept as an archive.
