# Toothless asset prototype (design record, 2026-09-26)

Throwaway-quality scripts written while de-risking the Phase 1 Toothless asset (spec §5) before planning M2–M4.
They run headless: `blender --background --factory-startup --python assemble_v5.py` (module imports resolve from
this folder). Renders referenced below live in `docs/progress/img/prototype/`.

## Conventions

Blender space, metres: **X = dragon's left, −Y = forward (head), +Z = up**, ground at z = 0. Right-side parts mirror X.
glTF export (+Y up) maps Blender (x, y, z) → glTF (x, z, −y), so the dragon faces **+Z** in three.js.

## What was proven

| Question | Answer | Evidence |
|---|---|---|
| Sculpt technique (spec §5.2 step 2) | **numpy SDF → OpenVDB (Blender's bundled `openvdb` module) → Volume-to-Mesh** on `−sdf` with threshold 0. Metaballs not needed. 89 M voxels (7 mm) in ~50 s; 1 cm in ~15 s. | `SPIKE-RESULT.md`, `berk_sdf.py` |
| Film proportions | Skeleton-driven sculpt reads as Toothless: big domed head, forward eyes, paddle ears, short thick neck, deep chest, pillar legs, long tail with sawtooth dorsal spikes. | `v3-blockout-hero.png`, `head-vs-ref-front.png`, `v3-blockout-vs-ref-side.png` |
| Wing planform | Fan hub (wrist) ~⅓ of the half-span out; 7 long ribs (4.75 → 1.9 m) spread −6°…94°; scalloped trailing edge; hip wings on the tail base; long rudder-like tail fins. | `v4-planform-vs-ref-top.png`, `v4-wings-spread.png` |
| Fan-fold | Closing the ribs closes the membrane cleanly (`wing-fanfold-half.png`). Folded: humerus back along the flank, forearm forward, **inner halves of ribs back, the four long leading ribs' outer halves folded forward over them** (keeps the fold between shoulder and tail base). | `v4-wings-folded.png`, `rig_build.fold_wings` |
| Game mesh | **QuadriFlow** → clean symmetric quads, ~24 k faces, good flow around eyes/mouth/legs. Blender's QuadriFlow pre-check **rejects any edge shorter than 0.1 mm** (the VDB mesh had two) — run `bmesh.ops.dissolve_degenerate(dist=0.0006)` + `remove_doubles(0.0006)` + `recalc_face_normals` first. | `v5-quadriflow-wireframe.png` |
| Skinning | Blender automatic (heat) weights on the QuadriFlow body with **non-body bones' `use_deform` disabled during the bind** (wings, hip wings, tail fins, ears, tack) → 0 unweighted verts, smooth shoulder/hip deformation. Parts (eyes, ears, claws, membranes, spars) carry explicit vertex groups. | `v5-walk-deform.png` |
| Rig | ~100 bones generated from `anatomy.bone_specs()`; roll aligned so local Z ≈ world up (−Y for near-vertical bones) → for limbs and spine, **local X is the hinge axis**. | `anatomy.py`, `rig_build.py` |

## Solved after the first record (head_parts.py, head_test.py, assemble_v6.py)

- **Mouth** — `berk_sdf.polygon_slab` cuts a real slit through the head along the lip U (`sculpt_body.mouth_polygon`,
  `MOUTH_Z`, half-height 8 mm), so upper/lower jaw join only behind the corners. Interior faces get the `mouth` material
  (`head_parts.assign_mouth_material`, inset 3 cm so the lips read dark at rest). Jaw opens cleanly with **negative local-X**
  rotation (`head-yawn.png`, `head-snarl-teeth.png`). Retractable teeth rows sit inside the gums with a `teeth_out` key.
- **Eyelids** — parametric spherical-cap lid shells (upper + lower per eye, solidified) with `blink_L/R` keys
  (`head-neutral-lids.png`, `head-blink.png`); the heavy upper lid gives the film's sleepy look. The pupil is NOT a mesh — the
  engine eye shader draws it from the eye's planar UVs (TEXCOORD_0 = eye-frame x/y ÷ radius; back hemisphere v = −1).
- **Export** — `assemble_v6.py` produces one skinned mesh (7 materials, 43 k verts / 83 k tris), 101-joint skin, morphs
  `blink_L/R, teeth_out`, clips `bind, wings_folded, jaw_open` with FULL tracks for all bones; loads in three r186
  (`v6_test.html`: bbox 13.55 × 2.02 × 7.17 m).

Pitfalls found on the way: bones must sit inside the mesh volume (the jaw hinge in the slit gap broke heat weighting);
always `voxel_remesh` after VDB meshing (thin walls → non-manifold → heat weighting fails for every bone); shape-key
values become glTF default morph weights (zero them before export); GLTFLoader splits multi-material skinned meshes
into one SkinnedMesh per material (apply morphs/materials to all).

## Known gaps (the plan must close these)

1. ~~Mouth~~ solved (above). Remaining: tongue shape, corner creases.
2. ~~Eyelids / blink~~ solved (above). Remaining: lids leave a sliver at the outer corner of the far eye at full blink (raise upper-lid travel to ~100°, lower to ~−46°).
3. **Folded-wing polish**: a thin membrane skirt remains under the folded bundle; needs a pleat corrective and tuned inner-panel weights.
4. **Pose authoring**: the pelvis is the root bone, so poses like *sit* need counter-rotations up the spine (first attempt tipped the whole body).
5. **Tack**: saddle, harness straps (SDF shell bands), left pedal, prosthetic-fin linkage cable — not yet built.
6. **Export**: glTF with skin + morph targets + pose clips not yet exercised (watch the exporter's constant-track stripping; see spec §5.11).
7. **Brows**: lid ridges still read slightly frowny from the front; soften.

## Texturing decision (amends spec §5.2 step 6 / §5.8–5.9)

The mesh carries the medium forms (24 k quads keep the sculpted lids, lip line and muscle shapes), so the body uses
**procedural shading instead of UV bakes**: bump-mapped fine scales sampled triplanar in **bind-pose object space**
(a skinned mesh's `position` attribute *is* the bind pose, so the pattern sticks to the skin while animating), plus
**vertex-colour AO** baked in Blender and vertex-colour region masks (belly/dorsal/claws). This removes UV seams and
bake steps, and keeps close-ups sharp. A baked normal map can be added later if needed.
