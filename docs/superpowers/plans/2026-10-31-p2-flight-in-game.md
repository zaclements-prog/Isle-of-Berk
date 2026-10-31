# Plan — Flight in the game world (Phase 2)

**Why.** The authored flight is in Blender: a standing takeoff, a running takeoff out of the gallop, the cruise flap
and the glide with transitions between them, and standing and running landings. Up to now it has only existed in
renders. The game still has no flight: Toothless walks, trots, gallops, climbs and jumps.

**What.** In the game you fly him. The authored clips play on the engine's skeleton while a flight controller moves
the body along a path steered by the camera. He takes off from a gallop or from standing, flaps or glides, banks
into turns, and lands. A running landing hands straight back to the gallop.

**Decisions (from the user).**
- Controls are camera-steered.
  - Shift-gallop plus Space takes off running; Space standing takes off in place.
  - In the air he flies toward where the camera looks: the mouse aims climbs, dives and turns, and he banks into
    turns.
  - Holding W flaps (climb and speed); releasing W glides; S brakes.
  - Space near the ground lands: a running landing when he is fast, a standing one when slow.
- The first milestone is the full loop: both takeoffs, flap and glide with smooth switching and banked turns, both
  landings, and a touchdown that is aware of the terrain.

## Architecture

The flight follows the jump's pattern (M6). A `FlightAction` owns the body while it runs:
- `mods.scripted`;
- the body solver's override, which gains **roll** for the bank;
- the planner's `autoStep`.

Flight clips play as pose layers at action order. The wings, body line, legs and arm springs come from Blender as
plain bone rotations. The pelvis is the engine's: placement comes from the flight state plus each clip's own per-frame
pelvis height and pitch.

### Clips (Blender → `toothless.poses.glb`, `flight.py` / `flight_loops.py` / `flight_run.py` / `flight_seq.py`)

Every flight clip is posed frame by frame by its own Blender code, exactly as the reels render it. Then each bone's
`matrix_basis` is keyed, along with the measured pelvis height (head, m above the ground plane) and pitch (+ nose up).
The pelvis track is in the glTF but masked off: the engine places the pelvis.

| Clip | Mask | Loop | Notes |
|---|---|---|---|
| `fly_flap` | all but pelvis | yes | cruise flap, 0.9 s; pelvis bob/pitch curves about their mean |
| `fly_glide` | all but pelvis | yes | glide, 4 s; same curves |
| `fly_takeoff` | all but pelvis | no | standing takeoff to the end of its 2nd climbing beat; height curve above the start ground, forward travel `x` |
| `fly_runtakeoff_wings` | wings | no | the wings opening low and rising to the top, played over the gallop, ending on a hind plant |
| `fly_runtakeoff` | all but pelvis | no | from the hind plant (push) through the climb; height, pitch, `x` |
| `fly_land` | all but pelvis | no | standing landing from the glide lead-in; height above the touchdown ground, pitch, `x`, touchdown time |
| `fly_runland` | all but pelvis | no | running landing to touchdown + a stride; hand-off to the gallop at gallop phase 0 |

`poses.json` gains a `flight` block per clip:
- `kind`;
- `height[]`, `pitch[]` and `x[]` per frame;
- markers: `push`, `liftoff`, `touchdown`, `beatPhaseEnd`;
- the loops' `speed` (m/s), and the glide's switch phase.

### Engine (`src/characters/dragon/actions/flight.ts`, `motion/flightPath.ts`)

- **`FlightPath`** carries the flight's own state:
  - world position, velocity, heading, pitch and bank;
  - a simple aero model: thrust when flapping, drag, lift that carries his weight at cruise speed, the glide's
    sink-rate polar, and a brake.
  - Steering follows the camera: heading toward the camera yaw, the climb angle toward the camera pitch, the bank
    from the turn rate (coordinated, `atan(v·ω/g)`), all through springs.
  - Terrain clearance: probe the ground ahead and below and pull up below a minimum height.
- **`FlightAction`** phases:
  1. `prep`: running only. The wings clip plays over the gallop, timed by the gait phase to end on the next hind
     plant.
  2. `takeoff`: the clip's height, pitch and `x` drive the body. The layer fades in from the ground pose over the
     push.
  3. `air`: the flap and glide layers cross-fade at phase gates. The flap leaves at mid-downstroke and the glide
     enters with the wings level, as `flap_to_glide` authors it. Their bob and pitch curves ride on the path. The
     bank rolls the body.
  4. `landing`: a touchdown spot is found ahead on the ground. The landing clip starts when its remaining glide
     distance matches. Its height curve is laid over the gap between the current altitude and the clip's, which
     closes before the flare. Legs go back to the IK for touchdown on uneven ground (the jump's forced steps).
  5. `runout`: running only. At touchdown the gait phase is set to 0 (hind touchdown) and the speed to the
     gallop's. The flight layer fades out over 0.35 s while the gallop's planner and cycles take over.
- **Wings:** during flight the WingController's demands are cleared, along with flare, lift and the loco wing lift.
  The flight layer overrides the fold layer on the wing bones.
- **Camera:** the orbit camera follows the chest at a longer distance in the air and keeps pitch control.

### Gates
- All existing Vitest suites stay green.
- New unit tests cover:
  - flight meta parsing;
  - FlightPath steering, banking and clearance;
  - the FlightAction phase sequence on a flat world: standing takeoff → air → landing, and running takeoff → air →
    running landing → gallop;
  - no NaN, a body never under the ground, and pelvis height and pitch continuity at every hand-off (no step over
    5 cm or 3° per frame).
- Visual review comes from lab captures of the game, at the in-engine render quality.

## Tasks
1. Bake the flight clips and their meta (Blender), and re-export `poses.glb` and `poses.json` only.
2. Engine: meta parsing, body roll override, FlightAction phases with clip playback and the hand-offs.
3. Camera-steered controls, flight path physics, terrain clearance, the camera in the air.
4. Tests, the HUD key help, captures for review, and a PR update.
