# Phase 1 · M2–M4 Toothless Asset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the proven Toothless prototype into a re-runnable, tested Blender pipeline that exports the final rigged asset (`toothless.glb` + `toothless.rig.json` + `toothless.poses.json`), and bind it in the engine with its film-look materials (scaled skin with rim light, procedural eyes, membranes, tack) in the Asset Viewer.

**Architecture:** `pipeline/blender/` holds a small library (`lib/`: SDF sculpting, mesh tools, scene hygiene, QA renders) and the Toothless build (`toothless/`: anatomy → sculpt → parts → wings → tack → skinning/shape keys/masks → poses → export), run headless through `run.ps1` and unit-tested inside Blender's Python. The engine side (`src/characters/dragon/`) loads the GLB + rig metadata into a `DragonAsset` and replaces placeholder materials by name.

**Tech Stack:** Blender 5.1.2 (headless Python, numpy, bundled `openvdb`), three.js 0.186.1, TypeScript 7, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-26-phase1-vertical-slice-design.md` §5 (Toothless asset). **Reference implementation:** `docs/superpowers/prototypes/toothless/` (+ its `README.md`) — every behaviour it proves must be preserved; renders in `docs/progress/img/prototype/` are the visual baseline.

## Global Constraints

- Blender: `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`, always `--background --factory-startup`, run via `pipeline/blender/run.ps1`.
- Blender space: metres, **X = dragon's left, −Y = forward (head), +Z = up**, ground z = 0; right side mirrors X. glTF/three space = Blender (x, y, z) → (x, z, −y): the dragon faces **+Z** in three.js.
- Bone names exactly as `anatomy.bone_specs()` produces (101 bones, `_L`/`_R` suffixes). The skeleton is locked by the tests in Task 2; later tasks must not rename or move bones.
- Body game mesh: QuadriFlow target **24000** faces. LOD0 total ≤ **90 000** triangles; GLB ≤ **6 MB**. (Amends spec §5.9's 30–40 k: the mesh now carries the sculpted forms instead of a baked normal map — see the prototype README "Texturing decision". Ledger ruling.)
- `anatomy.py` is the single source of truth for proportions and joints (the spec's `proportions.json` role); `rig.json` carries it to the engine.
- Bone names follow the prototype's locked convention (`ear_1_L`, `tailfin_rib1_L`, `hipwing_rib1_L`, `wing_rib1_a_L`, `pedal_L`, …) rather than the spec §5.5 table's illustrative spellings; there is no separate `wing_wrist` bone (the forearm's tail is the fan hub). The engine resolves bones through `rig.json` roles, never by spelling. (Ruling.)
- One hero LOD in Phase 1; LOD1/LOD2 (spec §5.9) are deferred to Phase 5, where NPC Night Furies need them. (Ruling.)
- Before QuadriFlow: `manifold_voxel_remesh` then `clean_degenerate` (QuadriFlow rejects any edge < 0.1 mm; thin walls break heat weighting).
- Every bone must lie inside the mesh volume at bind time (the jaw hinge sits below the mouth slit).
- Shape-key values are set to 0 before export. Pose clips key **every** bone and export with `export_animation_mode='NLA_TRACKS'`, `export_force_sampling=True`, `export_optimize_animation_size=False`, `export_optimize_animation_keep_anim_armature=True`.
- Custom per-vertex data travels in one **FLOAT_VECTOR** point attribute named **`_MASK`** (x = ambient occlusion, y = underside, z = dorsal spikes). It is deliberately not a colour attribute (the glTF exporter routes colour attributes through its COLOR_n path). The exporter writes it as glTF attribute `_MASK` (`export_attributes=True`); three.js GLTFLoader lower-cases unknown attributes → `geometry.attributes._mask` (vec3). Membranes are identified by their material, not by the mask.
- Tack and sculpt share the saddle footprint `anatomy.SADDLE_Y` / `anatomy.SADDLE_HALF_WIDTH`; no dorsal spikes are sculpted under the saddle (they would tent it).
- Materials by name (exact): `skin`, `membrane`, `eye`, `mouth`, `teeth`, `claw`, `prosthetic`, `leather`, `metal`.
- Blender hygiene: objects in named collections (`00_Studio`, `01_Toothless`, `02_Helpers` hidden), helpers deleted after use, orphans purged before every save, every object and mesh named.
- Outputs: `public/assets/characters/toothless/toothless.glb`, `toothless.poses.glb`, `toothless.rig.json`, `toothless.poses.json` (committed); `.blend` files go to `pipeline/blender/build/` (git-ignored); QA images to `docs/progress/img/toothless/` (committed).
- Engine materials that add shader hooks must be run through the app material pipeline (CSM + fog) **before** adding their own hooks (CSM's `setupMaterial` overwrites `onBeforeCompile`; `addCompileHook` then composes on top).
- Commits: write the message to a file with the Write tool and `git commit -F <file>`; end with your own model-accurate `Co-Authored-By:` trailer. Branch `phase1-slice`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `pipeline/blender/run.ps1` | run a Blender script headless, propagate the exit code |
| `pipeline/blender/lib/berk_sdf.py` | SDF primitives + `Sculpt` → OpenVDB → mesh (prototype verbatim) |
| `pipeline/blender/lib/meshtools.py` | manifold voxel remesh, degenerate cleanup, QuadriFlow, reports, symmetry error |
| `pipeline/blender/lib/scene.py` | reset, collections, orphan purge, save |
| `pipeline/blender/lib/qa_render.py` | clay render setup, camera shots, side-by-side composites |
| `pipeline/blender/tests/run_tests.py` | unittest discovery inside Blender |
| `pipeline/blender/tests/test_sdf.py`, `test_meshtools.py`, `test_anatomy.py`, `test_rig.py`, `test_sculpt.py`, `test_wings.py`, `test_assemble.py` | tests |
| `pipeline/blender/toothless/anatomy.py` | joints, bones, fan layouts, contacts, proxies, anchors, limbs, limits |
| `pipeline/blender/toothless/rig.py` | armature build + posing helpers (fold, jaw) |
| `pipeline/blender/toothless/sculpt.py` | body + head SDF sculpt, mouth polygon |
| `pipeline/blender/toothless/parts.py` | eyes (planar eye UVs), lids (blink/squint), teeth, tongue, ears, claws, mouth material |
| `pipeline/blender/toothless/wings.py` | fan membranes/spars for main wings, hip wings, tail fins (+ pleat keys) |
| `pipeline/blender/toothless/tack.py` | saddle, harness straps, pedal, linkage cable, prosthetic hardware |
| `pipeline/blender/toothless/assemble.py` | body weights, face shape keys, `_MASK` (ray-traced vertex AO + regions), join, weight limits |
| `pipeline/blender/toothless/poses.py` | pose clips (bind, wings_folded, wings_half, jaw_open) |
| `pipeline/blender/toothless/export.py` | GLB + `rig.json` + `poses.json` |
| `pipeline/blender/toothless/qa.py` | QA render sets + numeric checks |
| `pipeline/blender/toothless/build.py` | stage runner (`model`, `wings`, `tack`, `assemble`, `export`, `all`) |
| `tests/assets/glb.ts` | tiny GLB JSON-chunk reader for tests |
| `tests/assets/toothless.test.ts` | exported asset structure tests |
| `src/characters/dragon/rigMeta.ts` | rig.json types + validation |
| `src/characters/dragon/materials.ts` | skin/membrane/eye/… materials and their shader hooks |
| `src/characters/dragon/asset.ts` | `loadDragonAsset()` → `DragonAsset` |
| `tests/characters/rigMeta.test.ts`, `tests/characters/materials.test.ts` | engine-side tests |
| `src/dev/viewer/main.ts` | (modify) `?asset=toothless` loads the dragon asset with controls |

---

### Task 1: Blender runner, library and its tests

**Files:**
- Create: `pipeline/blender/run.ps1`, `pipeline/blender/lib/berk_sdf.py` (copy of `docs/superpowers/prototypes/toothless/berk_sdf.py`), `pipeline/blender/lib/meshtools.py`, `pipeline/blender/lib/scene.py`, `pipeline/blender/lib/qa_render.py`, `pipeline/blender/tests/run_tests.py`, `pipeline/blender/tests/test_sdf.py`, `pipeline/blender/tests/test_meshtools.py`
- Modify: `package.json` (scripts), `.gitignore` (add `pipeline/blender/build/`)

**Interfaces:**
- Produces: `berk_sdf.{Sculpt, sphere, ellipsoid, round_cone, tube, squashed, polygon_slab, box, smin, smax, rot, look_rot}`; `meshtools.{select_only(ob), manifold_voxel_remesh(ob, voxel), clean_degenerate(ob, dist=0.0006), quadriflow(ob, target_faces, symmetry=True, seed=0), mesh_report(ob) -> dict, symmetry_error(ob) -> float}`; `scene.{reset(), collection(name, hidden=False), move_to(ob, coll), purge_orphans(), save(path)}`; `qa_render.{setup_clay(scene), shoot(scene, out_dir, name, loc, target, lens=35, res=(1200, 800), ortho=None) -> str, composite(out_dir, name, left, right, h=520) -> str}`; npm scripts `blender:test`, `toothless:build`.

- [ ] **Step 1: Runner, test harness and scripts**

`pipeline/blender/run.ps1`:
```powershell
# Run a Blender Python script headless: run.ps1 <script.py> [args passed after --]
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$blender = 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
& $blender --background --factory-startup --python-exit-code 1 --python $Script -- @Rest
exit $LASTEXITCODE
```

`pipeline/blender/tests/run_tests.py`:
```python
"""Discover and run pipeline/blender/tests/test_*.py inside Blender; non-zero exit on failure."""
import os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "lib"), os.path.join(ROOT, "toothless"), HERE]
suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise RuntimeError("pipeline tests failed")
```

`package.json` — add to `"scripts"`:
```json
"blender:test": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/tests/run_tests.py",
"toothless:build": "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/toothless/build.py --stage all"
```

`.gitignore` — append `pipeline/blender/build/`.

- [ ] **Step 2: Write the failing tests**

`pipeline/blender/tests/test_sdf.py`:
```python
import unittest
import numpy as np
import berk_sdf as S


class SdfTests(unittest.TestCase):
    def test_sphere_distance(self):
        p = S.sphere((0, 0, 0), 1.0)
        np.testing.assert_allclose(p.fn(np.array([[2, 0, 0], [0, 0, 0], [0, 1, 0]], float)), [1.0, -1.0, 0.0], atol=1e-9)

    def test_ellipsoid_sign(self):
        d = S.ellipsoid((0, 0, 0), (1.0, 0.5, 0.25)).fn(np.array([[0, 0, 0], [0.9, 0, 0], [1.1, 0, 0], [0, 0.6, 0]], float))
        self.assertLess(d[0], 0); self.assertLess(d[1], 0); self.assertGreater(d[2], 0); self.assertGreater(d[3], 0)

    def test_round_cone_endpoints(self):
        d = S.round_cone((0, 0, 0), (1, 0, 0), 0.3, 0.1).fn(np.array([[-0.3, 0, 0], [1.1, 0, 0], [0.5, 0, 0]], float))
        np.testing.assert_allclose(d[:2], [0.0, 0.0], atol=1e-6)
        self.assertLess(d[2], 0)

    def test_tube_has_no_joint_bulge(self):
        t = S.tube([(0, 0, 0), (1, 0, 0), (2, 0, 0)], [0.2, 0.2, 0.2])
        np.testing.assert_allclose(t.fn(np.array([[1, 0.2, 0]], float)), [0.0], atol=1e-6)

    def test_smin_is_symmetric_and_below_min(self):
        a = np.array([0.1, -0.2, 0.5]); b = np.array([0.3, 0.0, 0.45])
        s1 = S.smin(a, b, 0.1); s2 = S.smin(b, a, 0.1)
        np.testing.assert_allclose(s1, s2, atol=1e-12)
        self.assertTrue(np.all(s1 <= np.minimum(a, b) + 1e-12))

    def test_polygon_slab_inside_outside(self):
        p = S.polygon_slab([[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.0, 0.1)
        d = p.fn(np.array([[0, 0, 0], [0, 0, 0.2], [2, 0, 0], [0.5, 0.5, 0.05]], float))
        self.assertLess(d[0], 0); self.assertGreater(d[2], 0); self.assertLess(d[3], 0)
        np.testing.assert_allclose(d[1], 0.1, atol=1e-9)

    def test_squashed_flattens_an_axis(self):
        f = S.squashed(S.sphere((0, 0, 0), 1.0), (0, 0, 0), (1, 1, 0.5))
        d = f.fn(np.array([[0, 0, 0.6], [0.9, 0, 0]], float))
        self.assertGreater(d[0], 0); self.assertLess(d[1], 0)


if __name__ == "__main__":
    unittest.main()
```

`pipeline/blender/tests/test_meshtools.py`:
```python
import os, unittest
import bpy
import berk_sdf as S
import meshtools as MT
import scene as SC


class MeshToolsTests(unittest.TestCase):
    def setUp(self):
        SC.reset()

    def test_report_on_cube(self):
        bpy.ops.mesh.primitive_cube_add()
        rep = MT.mesh_report(bpy.context.active_object)
        self.assertEqual((rep["verts"], rep["faces"], rep["tris"], rep["islands"]), (8, 6, 12, 1))
        self.assertEqual((rep["boundary_edges"], rep["nonmanifold_edges"]), (0, 0))

    def test_sculpt_remesh_quadriflow_symmetric(self):
        sc = S.Sculpt((-0.6, -0.6, -0.6), (0.6, 0.6, 0.6), 0.02)
        sc.add(S.ellipsoid((0, 0, 0), (0.5, 0.3, 0.25)))
        ob = sc.to_mesh("Ell", os.path.join(bpy.app.tempdir, "ell.vdb"))
        MT.manifold_voxel_remesh(ob, 0.02)
        MT.clean_degenerate(ob)
        rep = MT.mesh_report(ob)
        self.assertEqual((rep["boundary_edges"], rep["nonmanifold_edges"], rep["islands"], rep["short_edges"]), (0, 0, 1, 0))
        MT.quadriflow(ob, 2000)
        self.assertTrue(1500 <= len(ob.data.polygons) <= 2600, len(ob.data.polygons))
        self.assertLess(MT.symmetry_error(ob), 0.01)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run blender:test`
Expected: FAIL — `ModuleNotFoundError: No module named 'berk_sdf'` (and meshtools/scene).

- [ ] **Step 4: Implement the library**

`pipeline/blender/lib/berk_sdf.py`: copy `docs/superpowers/prototypes/toothless/berk_sdf.py` unchanged.

`pipeline/blender/lib/meshtools.py`:
```python
"""Mesh utilities for the asset pipeline (Blender)."""
import bpy
import bmesh
from mathutils import kdtree


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def manifold_voxel_remesh(ob, voxel):
    """Voxel remesh → a closed manifold surface (VDB meshing can leave thin non-manifold walls)."""
    select_only(ob)
    ob.data.remesh_voxel_size = voxel
    if bpy.ops.object.voxel_remesh() != {"FINISHED"}:
        raise RuntimeError(f"voxel_remesh failed on {ob.name}")


def clean_degenerate(ob, dist=0.0006):
    """Remove near-zero edges/doubles and make normals consistent (QuadriFlow rejects any edge < 0.1 mm)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def quadriflow(ob, target_faces, symmetry=True, seed=0):
    select_only(ob)
    ob.data.use_mirror_x = symmetry
    result = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=symmetry, mode="FACES", target_faces=target_faces, seed=seed)
    if result != {"FINISHED"}:
        raise RuntimeError("QuadriFlow refused the mesh — run manifold_voxel_remesh + clean_degenerate first")
    for p in ob.data.polygons:
        p.use_smooth = True


def mesh_report(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    rep = {
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "tris": sum(len(f.verts) - 2 for f in bm.faces),
        "boundary_edges": sum(1 for e in bm.edges if e.is_boundary),
        "nonmanifold_edges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary),
        "short_edges": sum(1 for e in bm.edges if e.calc_length() < 1e-4),
    }
    seen, islands = set(), 0
    for f in bm.faces:
        if f.index in seen:
            continue
        islands += 1
        stack = [f]
        while stack:
            g = stack.pop()
            if g.index in seen:
                continue
            seen.add(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        stack.append(h)
    rep["islands"] = islands
    bm.free()
    return rep


def symmetry_error(ob):
    """Largest distance from any vertex's X-mirror to the nearest vertex (metres)."""
    me = ob.data
    kd = kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co, i)
    kd.balance()
    worst = 0.0
    for v in me.vertices:
        m = v.co.copy()
        m.x = -m.x
        worst = max(worst, kd.find(m)[2])
    return worst
```

`pipeline/blender/lib/scene.py`:
```python
"""Scene hygiene helpers (see the Blender hygiene protocol)."""
import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def collection(name, hidden=False):
    sc = bpy.context.scene
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    coll.hide_render = hidden
    coll.hide_viewport = hidden
    return coll


def move_to(ob, coll):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)


def purge_orphans():
    for _ in range(10):
        if not bpy.data.orphans_purge(do_recursive=True):
            break


def save(path):
    purge_orphans()
    bpy.ops.wm.save_as_mainfile(filepath=path)
```

`pipeline/blender/lib/qa_render.py`:
```python
"""Clay QA renders and side-by-side reference composites."""
import math
import os
import bpy
import numpy as np
from mathutils import Vector


def setup_clay(sc):
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_backface_culling = False
    world = bpy.data.worlds.get("QA") or bpy.data.worlds.new("QA")
    sc.world = world
    world.color = (0.2, 0.22, 0.26)


def shoot(sc, out_dir, name, loc, target, lens=35, res=(1200, 800), ortho=None):
    os.makedirs(out_dir, exist_ok=True)
    cam_data = bpy.data.cameras.new(f"QA_{name}")
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    else:
        cam_data.lens = lens
    cam = bpy.data.objects.new(f"QA_{name}", cam_data)
    cam.location = loc
    sc.collection.objects.link(cam)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = (math.pi / 2 + math.asin(max(-1.0, min(1.0, d.z))), 0.0, -math.atan2(d.x, d.y))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    path = os.path.join(out_dir, name + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    return path


def _load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def _resize(px, h):
    H, W = px.shape[:2]
    w = int(round(W * h / H))
    return px[(np.arange(h) * H / h).astype(int)][:, (np.arange(w) * W / w).astype(int)]


def composite(out_dir, name, left, right, h=520):
    a = _resize(_load(left), h)
    b = _resize(_load(right), h)
    out = np.concatenate([a, np.ones((h, 8, 4), np.float32), b], axis=1)
    img = bpy.data.images.new(name, out.shape[1], out.shape[0], alpha=True)
    img.pixels = out.ravel()
    path = os.path.join(out_dir, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run blender:test`
Expected: `Ran 9 tests … OK`, exit code 0.

- [ ] **Step 6: Commit** (files above; message `feat(pipeline): headless Blender runner, SDF/mesh/scene/QA library with tests`).

---

### Task 2: Anatomy (locked skeleton + motion metadata) and rig module

**Files:**
- Create: `pipeline/blender/toothless/anatomy.py`, `pipeline/blender/toothless/rig.py`, `pipeline/blender/tests/test_anatomy.py`, `pipeline/blender/tests/test_rig.py`

**Interfaces:**
- Consumes: Task 1 library.
- Produces (anatomy): everything in the prototype `anatomy.py` **plus** `JAW_OPEN_SIGN = -1`, `MOUTH_ANCHOR`, `CONTACTS_L`, `SADDLE_Y = (-0.58, -0.16)`, `SADDLE_HALF_WIDTH = 0.20`, `CRANIUM_TOP`, `PROXIES`, `ANCHORS`, `LIMBS`, `blender_to_gltf(p) -> (x, z, -y)`, `proportions() -> dict`.
- Produces (rig): `build_armature(name="ToothlessRig")`, `reset_pose(rig)`, `aim(rig, bone, direction, up=(0,0,1))`, `rest_dir(rig, bone)`, `fold_wings(rig, amount)`, `pose_jaw(rig, amount)` (amount 0..1 → jaw rotation `JAW_OPEN_SIGN * 0.62 * amount` rad about local X).

- [ ] **Step 1: Write the failing tests**

`pipeline/blender/tests/test_anatomy.py`:
```python
import re
import unittest
import numpy as np
import anatomy as A

NAME = re.compile(r"^[a-z]+[a-z0-9_]*(_[LR])?$")


class AnatomyTests(unittest.TestCase):
    def setUp(self):
        self.specs = A.bone_specs()
        self.by = {b[0]: b for b in self.specs}

    def test_bone_count_and_unique_names(self):
        self.assertEqual(len(self.specs), 101)
        self.assertEqual(len(self.by), 101)

    def test_parents_exist_and_precede(self):
        seen = set()
        for name, head, tail, parent, _ in self.specs:
            if parent is not None:
                self.assertIn(parent, seen, f"{name} parent {parent} must come first")
            seen.add(name)

    def test_names_follow_convention(self):
        for name, *_ in self.specs:
            self.assertRegex(name, NAME)

    def test_left_right_mirror(self):
        for name, head, tail, *_ in self.specs:
            if name.endswith("_L"):
                other = self.by.get(name[:-2] + "_R")
                self.assertIsNotNone(other, name)
                np.testing.assert_allclose(other[1], [-head[0], head[1], head[2]], atol=1e-9)
                np.testing.assert_allclose(other[2], [-tail[0], tail[1], tail[2]], atol=1e-9)

    def test_no_degenerate_bones(self):
        for name, head, tail, *_ in self.specs:
            self.assertGreater(np.linalg.norm(np.asarray(tail) - np.asarray(head)), 0.02, name)

    def test_proportions(self):
        p = A.proportions()
        self.assertTrue(7.1 <= p["length"] <= 7.5, p)
        self.assertTrue(13.1 <= p["wingspan"] <= 13.9, p)        # spec 13.5 m ± 3 %
        self.assertTrue(1.2 <= p["shoulderHeight"] <= 1.4, p)    # withers (top of the shoulder blades), spec ≈ 1.3 m
        self.assertTrue(1.7 <= p["headTop"] <= 1.95, p)

    def test_contacts_on_the_ground_and_limbs_reference_bones(self):
        for leg, c in A.CONTACTS_L.items():
            for k in ("sole", "toe", "heel"):
                self.assertLess(c[k][2], 0.05, (leg, k))
        names = set(self.by)
        for side in ("L", "R"):
            for kind, limb in A.LIMBS.items():
                for b in limb["bones"]:
                    self.assertIn(f"{b}_{side}", names)

    def test_gltf_conversion(self):
        self.assertEqual(tuple(A.blender_to_gltf((1.0, 2.0, 3.0))), (1.0, 3.0, -2.0))

    def test_proxies_and_anchors_reference_bones(self):
        for name, bone, centre, radius in A.PROXIES:
            self.assertIn(bone, self.by, name)
            self.assertGreater(radius, 0.0)
        for key, (bone, pos) in A.ANCHORS.items():
            self.assertIn(bone, self.by, key)

    def test_saddle_footprint_sits_behind_the_wing_roots(self):
        y0, y1 = A.SADDLE_Y
        self.assertTrue(y0 < A.SADDLE_SEAT[1] < y1)
        self.assertGreater(y0, A.MAIN_WING_L["root"][1])
        self.assertLess(A.SADDLE_HALF_WIDTH, A.MAIN_WING_L["attach"][1][0])


if __name__ == "__main__":
    unittest.main()
```

`pipeline/blender/tests/test_rig.py`:
```python
import math
import unittest
import scene as SC
import rig as R


class RigTests(unittest.TestCase):
    def setUp(self):
        SC.reset()
        self.rig = R.build_armature()

    def test_armature_has_all_bones(self):
        self.assertEqual(len(self.rig.data.bones), 101)
        self.assertIsNone(self.rig.data.bones["pelvis"].parent)

    def test_fold_brings_the_wing_close_and_reset_restores(self):
        R.fold_wings(self.rig, 1.0)
        wrist = self.rig.pose.bones["wing_forearm_L"].tail
        self.assertLess(abs(wrist.x), 0.8)
        R.reset_pose(self.rig)
        self.assertAlmostEqual(self.rig.pose.bones["wing_forearm_L"].tail.x, self.rig.data.bones["wing_forearm_L"].tail_local.x, places=5)

    def test_jaw_opens_downward(self):
        R.pose_jaw(self.rig, 1.0)
        tip = self.rig.pose.bones["jaw"].tail
        rest = self.rig.data.bones["jaw"].tail_local
        self.assertLess(tip.z, rest.z - 0.05)


if __name__ == "__main__":
    unittest.main()
```
- [ ] **Step 2: Run to verify they fail**

Run: `npm run blender:test` → FAIL: `No module named 'anatomy'` / `'rig'`.

- [ ] **Step 3: Implement anatomy.py and rig.py**

`anatomy.py`: copy `docs/superpowers/prototypes/toothless/anatomy.py`, then append:
```python
JAW_OPEN_SIGN = -1          # the jaw opens with a NEGATIVE rotation about its local X (verified in the prototype)
MOUTH_ANCHOR = V(0, -2.20, 1.375)   # front of the mouth slit (plasma muzzle)

# paw contact points (left; mirror X for right) — sole centre, toe tip, heel. Derived from the sculpted paws
# (sculpt.build: paw pad ellipsoid at paw + (0, 0, 0.012) r (0.14, 0.18, 0.08); toes at paw + (±tx, fwd, -0.01) r 0.07 in y)
CONTACTS_L = {
    "front": {"bone": "front_toes", "sole": V(0.34, -0.86, 0.0), "toe": V(0.34, -1.05, 0.0), "heel": V(0.34, -0.68, 0.03)},
    "hind": {"bone": "hind_toes", "sole": V(0.33, 0.58, 0.0), "toe": V(0.33, 0.38, 0.0), "heel": V(0.33, 0.76, 0.03)},
}

# saddle footprint (shared by tack.py and sculpt.dorsal_spikes): between the wing roots and the waist
SADDLE_Y = (-0.58, -0.16)
SADDLE_HALF_WIDTH = 0.20      # stays inside the membrane attach line (x = 0.25)
CRANIUM_TOP = 1.72 + HEAD_OFFSET[2] + 0.235   # top of the cranium ellipsoid in sculpt.build (centre z 1.72 + HO, radius z 0.235)

# collision proxies: (name, bone, centre, radius) — all on the midline, fitted to the sculpt's main masses
PROXIES = [
    ("head", "head", V(0, -1.72, 1.58), 0.33), ("muzzle", "head", V(0, -2.02, 1.47), 0.20),
    ("neck", "neck_02", V(0, -1.10, 1.33), 0.30),
    ("chest", "chest", V(0, -0.62, 1.00), 0.44), ("belly", "spine_02", V(0, 0.00, 1.04), 0.32),
    ("hips", "pelvis", V(0, 0.60, 1.02), 0.36), ("tail_a", "tail_03", V(0, 1.72, 0.95), 0.20),
    ("tail_b", "tail_06", V(0, 2.85, 0.80), 0.13), ("tail_c", "tail_09", V(0, 3.88, 0.66), 0.08),
    ("tail_d", "tail_12", V(0, 4.80, 0.50), 0.045),
]

ANCHORS = {
    "eye_L": ("head", EYE_CENTER_L), "eye_R": ("head", mirror(EYE_CENTER_L)), "mouth": ("head", MOUTH_ANCHOR),
    "saddle": ("saddle", SADDLE_SEAT + V(0, 0, 0.06)), "pedal_L": ("pedal_L", PEDAL_L),
}

# limbs (bone base names; add _L/_R). pole = the direction the middle joint bends toward (Blender space);
# limits = allowed hinge rotation relative to the bind pose, degrees (consumed by the motion system's IK)
LIMBS = {
    "front": {"bones": ["front_scapula", "front_humerus", "front_radius", "front_metacarpal", "front_toes"],
              "pole": V(0, 1, 0),
              "limits": {"front_scapula": [-25, 25], "front_humerus": [-70, 60], "front_radius": [-35, 120],
                         "front_metacarpal": [-90, 90], "front_toes": [-80, 80]}},
    "hind": {"bones": ["hind_femur", "hind_tibia", "hind_metatarsal", "hind_toes"],
             "pole": V(0, -1, 0),
             "limits": {"hind_femur": [-70, 75], "hind_tibia": [-55, 70], "hind_metatarsal": [-45, 110],
                        "hind_toes": [-80, 80]}},
}


# per-bone rotation limits for the procedural chains, degrees from bind (pitch = local X, yaw = local Z, roll = local Y)
CHAIN_LIMITS = {
    "spine": {"pitch": 15, "yaw": 12, "roll": 8},
    "neck": {"pitch": 35, "yaw": 40, "roll": 15},
    "tail": {"pitch": 25, "yaw": 30, "roll": 10},
}


def blender_to_gltf(p):
    return (float(p[0]), float(p[2]), float(-p[1]))


def proportions():
    tips = fan_tips(MAIN_WING_L, 1)
    return {
        "length": float(TAIL_PTS[-1][1] - (HEAD[1][1] - 0.02)),
        "wingspan": float(2 * max(t[0] for t in tips)),
        "shoulderHeight": float(FRONT_LEG_L["scapula"][2]),   # withers height
        "hipHeight": float(HIND_LEG_L["hip"][2]),
        "headTop": float(CRANIUM_TOP),
    }
```
(The prototype file already carries the proven `JAW = (V(0, -1.70, 1.345), V(0, -2.16, 1.30))`; keep it.)

`rig.py`: copy `docs/superpowers/prototypes/toothless/rig_build.py` (imports `anatomy as A`), then append:
```python
def pose_jaw(rig, amount):
    """0 = closed (bind), 1 = wide open (~35 degrees)."""
    import math
    pb = rig.pose.bones["jaw"]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (A.JAW_OPEN_SIGN * 0.62 * amount, 0.0, 0.0)
    bpy.context.view_layer.update()
```

- [ ] **Step 4: Run the tests** — `npm run blender:test` → `Ran 22 tests … OK` (9 library + 10 anatomy + 3 rig).

- [ ] **Step 5: Commit** (`feat(toothless): locked anatomy with motion metadata and rig module`).

---

### Task 3: Sculpt, head parts and the `model` stage

**Files:**
- Create: `pipeline/blender/toothless/sculpt.py`, `pipeline/blender/toothless/parts.py`, `pipeline/blender/toothless/qa.py`, `pipeline/blender/toothless/build.py`, `pipeline/blender/tests/test_sculpt.py`
- Output: `docs/progress/img/toothless/model_*.png` (committed), `pipeline/blender/build/toothless_model.blend` (git-ignored)

**Interfaces:**
- Consumes: Tasks 1–2 (`berk_sdf`, `meshtools`, `scene`, `qa_render`, `anatomy`, `rig`).
- Produces:
  - `sculpt.{build(voxel=0.007, lo=(-0.9, -2.36, -0.04), hi=(0.9, 5.08, 2.2)) -> Sculpt, MOUTH_LINE_L, MOUTH_Z, MOUTH_HALF_H, mouth_polygon(outset=0.06), dorsal_spikes() -> [(base, tip, base_radius)]}`
  - `parts.{eye_frame(side), bind_rigid(ob, rig, bone), make_eyes(rig, mat) -> [Eye_L, Eye_R], make_lids(rig, mat) -> [LidU_L, LidD_L, LidU_R, LidD_R], make_teeth(rig, mat) -> Teeth, make_tongue(rig, mat) -> Tongue, make_ears(rig, mat) -> [6 objects], make_claws(rig, mat) -> [16 objects], assign_mouth_material(body, mat, inset=0.012, band=0.006) -> int}`
  - `build.{materials() -> dict[str, Material], open_stage(name) -> (rig, body), STAGES, main()}` — `build.py --stage model|…|all`
  - `qa.model_renders(sc, out_dir) -> [png paths]`

- [ ] **Step 1: Write the failing sculpt tests**

`pipeline/blender/tests/test_sculpt.py`:
```python
import unittest
import numpy as np
import anatomy as A
import sculpt as SB


class SculptTests(unittest.TestCase):
    def test_jaw_hinge_is_inside_the_lower_jaw(self):
        self.assertLess(A.JAW[0][2], SB.MOUTH_Z - SB.MOUTH_HALF_H)

    def test_mouth_polygon_is_symmetric_and_closed_behind_the_corners(self):
        poly = np.array(SB.mouth_polygon())
        self.assertAlmostEqual(float(poly[:, 0].sum()), 0.0, places=9)
        self.assertGreater(poly[:, 1].max(), SB.MOUTH_LINE_L[-1][1])

    def test_no_dorsal_spikes_under_the_saddle(self):
        y0, y1 = A.SADDLE_Y
        spikes = SB.dorsal_spikes()
        self.assertEqual(len(spikes), 28)
        for base, tip, radius in spikes:
            self.assertFalse(y0 - 0.02 <= base[1] <= y1 + 0.02, base)
            self.assertGreater(tip[2], base[2])
            self.assertGreater(radius, 0.0)


if __name__ == "__main__":
    unittest.main()
```
Run: `npm run blender:test` → FAIL: `No module named 'sculpt'`.

- [ ] **Step 2: Port the sculpt**

`sculpt.py` = prototype `sculpt_body.py` with these changes only:
1. Delete the unused `lid_ring` helper (the lid shells replaced it).
2. Move the dorsal-spike block out of `build()` into this module-level function (same maths; skips the saddle footprint):
```python
def dorsal_spikes():
    """Triangular sawtooth along the back, neck -> tail tip: [(base, tip, base_radius)].
    None under the saddle (they would tent it). build() squashes each to a third of its width in X."""
    top_path = [(-1.30, 1.76), (-1.02, 1.60), (-0.7, 1.47), (-0.2, 1.39), (0.4, 1.36), (0.8, 1.33)] + \
        [(float(t[1]), float(t[2] + r * 0.97)) for t, r in zip(A.TAIL_PTS[1:], A.TAIL_RADII[1:])]
    ty = np.array([p[0] for p in top_path])
    tz = np.array([p[1] for p in top_path])
    y0, y1 = A.SADDLE_Y
    out = []
    n = 30
    for i in range(n):
        y = -1.25 + i * (4.7 - -1.25) / (n - 1)
        if y0 - 0.02 <= y <= y1 + 0.02:
            continue
        z = float(np.interp(y, ty, tz)) - 0.012
        prof = float(np.interp(y, [-1.25, -0.6, 0.6, 2.0, 4.7], [0.07, 0.1, 0.16, 0.15, 0.07]))
        base = V(0, y, z)
        out.append((base, base + V(0, prof * 0.62, prof), prof * 0.42))
    return out
```
and inside `build()` the spike block becomes:
```python
    # ---- dorsal spikes: triangular sawtooth, neck -> tail tip
    for base, tip, radius in dorsal_spikes():
        S.add(squashed(round_cone(base, tip, radius, 0.004), base, (0.33, 1, 1)), 0.01)
```
(30 candidates; y ≈ −0.429 and −0.224 fall in the footprint → 28 spikes.)

- [ ] **Step 3: Port the head parts**

`parts.py` = the eye/ear/claw code of prototype `build_parts.build_all` plus everything in `head_parts.py`, split into the functions listed under Interfaces. Each function creates its objects, names them, assigns the given material, smooth-shades, binds them to the rig and returns them. Import `sculpt as SB` (the prototype imported `sculpt_body`). Changes from the prototype:
- `make_eyes`: UV sphere **32 × 16** (was 48 × 24); **no pupil meshes**; add the planar eye UVs exactly as `assemble_v6.py` lines 77–85 do (layer `UVMap`; front hemisphere `(0.5 + 0.5·p·r/R, 0.5 + 0.5·p·up/R)`, back hemisphere v = −1).
- `make_ears`: UV sphere **24 × 12** (was 32 × 16).
- `make_lids`: `head_parts.lid` for the upper and lower lid of each eye. Blink travel **100°** upper / **−46°** lower (was 96° / −40°; closes the outer-corner sliver). Add a second key **`squint`** on every lid: upper +18°, lower −16°, about the same axis.
- `make_teeth`: `head_parts.teeth`. The upper row is weighted to `head` and the lower row to `jaw` (`assemble_v6.py` lines 69–72); key `teeth_out`.
- `make_tongue` (new): a flattened UV-sphere ellipsoid (16 × 8 segments).
  - Centre `(0, -1.93, SB.MOUTH_Z - 0.009)`, radii `(0.10, 0.17, 0.014)`, the material passed in (`mouth`).
  - Weighted 100 % to `jaw`, so it lies on the floor of the mouth slit and shows when the jaw opens.
- `make_claws`: 12-vertex cones, as in the prototype (4 per paw, weighted to that paw's `*_toes_*` bone).
- `bind_rigid(ob, rig, bone)`: the prototype's `rigid` — one vertex group at weight 1.0, an Armature modifier, parented to the rig.

- [ ] **Step 4: `qa.py` and `build.py` (`model` stage)**

`pipeline/blender/toothless/qa.py`:
```python
"""Toothless QA render sets (clay, Workbench) and reference composites."""
import os
import qa_render as QR

REF_SIDE = r"C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155402.png"
REF_TOP = r"C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155348.png"
REF_FRONT = r"C:\Users\zacle\dragon-walk\tools\ref_dtv.png"


def _composite(out_dir, name, render, ref):
    return [QR.composite(out_dir, name, os.path.join(out_dir, render + ".png"), ref)] if os.path.exists(ref) else []


def model_renders(sc, out_dir):
    shots = {
        "model_hero": dict(loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
        "model_side": dict(loc=(9.0, 1.3, 1.1), target=(0, 1.3, 1.1), ortho=7.9),
        "model_top": dict(loc=(0, 1.3, 9.0), target=(0, 1.3, 0.0), ortho=7.9),
        "model_front": dict(loc=(0, -6.5, 1.35), target=(0, 0, 1.0), lens=50),
        "model_face": dict(loc=(-1.45, -2.75, 1.55), target=(0, -1.9, 1.45), lens=50),
    }
    paths = [QR.shoot(sc, out_dir, name, **kw) for name, kw in shots.items()]
    paths += _composite(out_dir, "model_vs_ref_side", "model_side", REF_SIDE)
    paths += _composite(out_dir, "model_vs_ref_front", "model_front", REF_FRONT)
    return paths
```

`pipeline/blender/toothless/build.py`:
```python
"""Toothless build stages. Usage (via run.ps1): build.py --stage model|wings|tack|assemble|export|all"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "lib"), HERE]

import bpy  # noqa: E402
import scene as SC  # noqa: E402
import meshtools as MT  # noqa: E402
import qa_render as QR  # noqa: E402
import rig as R  # noqa: E402
import sculpt as SB  # noqa: E402
import parts as P  # noqa: E402
import qa  # noqa: E402

REPO = os.path.dirname(os.path.dirname(ROOT))
BUILD = os.path.join(ROOT, "build")
QA_DIR = os.path.join(REPO, "docs", "progress", "img", "toothless")
ASSETS = os.path.join(REPO, "public", "assets", "characters", "toothless")
VOX = 0.008
FACES = 24000
COLORS = {
    "skin": (0.46, 0.47, 0.5), "membrane": (0.34, 0.35, 0.39), "eye": (0.62, 0.78, 0.16), "mouth": (0.75, 0.3, 0.33),
    "teeth": (0.95, 0.93, 0.88), "claw": (0.85, 0.8, 0.72), "prosthetic": (0.62, 0.12, 0.08),
    "leather": (0.36, 0.22, 0.12), "metal": (0.55, 0.56, 0.58),
}


def materials():
    """Clay placeholder materials; the engine swaps in the real ones by name (Task 8)."""
    out = {}
    for name, rgb in COLORS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
        out[name] = m
    return out


def open_stage(name):
    """Open the .blend an earlier stage saved; returns (rig, body)."""
    bpy.ops.wm.open_mainfile(filepath=os.path.join(BUILD, f"toothless_{name}.blend"))
    return bpy.data.objects["ToothlessRig"], bpy.data.objects["Toothless"]


def stage_model():
    sc = SC.reset()
    coll = SC.collection("01_Toothless")
    M = materials()
    rig = R.build_armature()
    SC.move_to(rig, coll)
    body = SB.build(VOX).to_mesh("Toothless", os.path.join(BUILD, "body.vdb"))
    SC.move_to(body, coll)
    MT.manifold_voxel_remesh(body, VOX)
    MT.clean_degenerate(body)
    MT.quadriflow(body, FACES)
    body.data.materials.append(M["skin"])
    P.assign_mouth_material(body, M["mouth"], inset=0.03)
    parts = (P.make_eyes(rig, M["eye"]) + P.make_lids(rig, M["skin"]) + [P.make_teeth(rig, M["teeth"]), P.make_tongue(rig, M["mouth"])]
             + P.make_ears(rig, M["skin"]) + P.make_claws(rig, M["claw"]))
    for ob in parts:
        SC.move_to(ob, coll)
    print("MODEL", MT.mesh_report(body), "symmetry", round(MT.symmetry_error(body), 5))
    QR.setup_clay(sc)
    qa.model_renders(sc, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_model.blend"))


STAGES = {"model": stage_model}   # later tasks add "wings", "tack", "assemble", "export" — in that order


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all", choices=["all", *STAGES])
    stage = ap.parse_args(argv).stage
    os.makedirs(BUILD, exist_ok=True)
    for name in (list(STAGES) if stage == "all" else [stage]):
        print(f"=== stage {name} ===")
        STAGES[name]()


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the stage and the tests**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File pipeline/blender/run.ps1 pipeline/blender/toothless/build.py --stage model`
Expected: prints `MODEL {...}` with `boundary_edges 0`, `nonmanifold_edges 0`, `islands 1`, faces 22 000–27 000, symmetry < 0.001 (spec §5.12: < 1 mm); writes the QA PNGs; exit 0.
Run: `npm run blender:test` → `Ran 25 tests … OK`.

- [ ] **Step 6: Visual acceptance** — Read every PNG. Fix and re-run until all of these hold:
  - `model_hero` / `model_face`:
    - a big domed head and forward-facing eyes under heavy, smooth lids (no frown ridge, no rubber rings)
    - paddle ears, their broad face visible from the front
    - a clean lip line
    - nostrils as small openings high on the muzzle
  - `model_vs_ref_side`:
    - head roughly level with the back, on a short thick neck
    - a deep chest and pillar legs
    - a long tapering tail with a clear triangular dorsal sawtooth, and a smooth gap where the saddle will sit
  - No floating parts: ears, eyes, lids and claws sit in or on the body.

- [ ] **Step 7: Commit** — sculpt, parts, qa, build, `test_sculpt.py` and the QA PNGs. Message: `feat(toothless): sculpt, head parts and model stage with QA renders`.

---

### Task 4: Wings, hip wings, tail fins and the fold

**Files:**
- Create: `pipeline/blender/toothless/wings.py`, `pipeline/blender/tests/test_wings.py`
- Modify: `pipeline/blender/toothless/build.py` (add `stage_wings`, register `"wings"`), `pipeline/blender/toothless/qa.py` (add `wing_renders`)
- Output: `docs/progress/img/toothless/wings_*.png`, `pipeline/blender/build/toothless_wings.blend`

**Interfaces:**
- Consumes: `anatomy` (MAIN_WING_L, HIP_WING_L, TAIL_FIN_L, fan_tips), `rig.fold_wings/reset_pose`, `build.materials/open_stage`.
- Produces: `wings.build_all(rig, M) -> [Wing_L, Wing_R, hipwing_L, hipwing_R, tailfin_L, tailfin_R]` (main wings carry shape key `membrane_pleat_L` / `membrane_pleat_R`); `wings.fold_metrics(rig, objs, amount=1.0) -> {"max_abs_x", "min_z", "max_y"}`; `qa.wing_renders(sc, rig, out_dir) -> [paths]`.

- [ ] **Step 1: Write the failing tests**

`pipeline/blender/tests/test_wings.py`:
```python
import unittest
import bpy
import scene as SC
import rig as R
import wings as W


class WingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        M = {n: bpy.data.materials.new(n) for n in ("skin", "membrane", "claw", "prosthetic", "metal")}
        cls.objs = {o.name: o for o in W.build_all(cls.rig, M)}

    def test_builds_six_named_parts(self):
        self.assertEqual(sorted(self.objs), sorted(["Wing_L", "Wing_R", "hipwing_L", "hipwing_R", "tailfin_L", "tailfin_R"]))

    def test_every_vertex_is_weighted_to_existing_bones(self):
        bones = set(self.rig.data.bones.keys())
        for ob in self.objs.values():
            for g in ob.vertex_groups:
                self.assertIn(g.name, bones, (ob.name, g.name))
            self.assertTrue(all(v.groups for v in ob.data.vertices), ob.name)

    def test_main_wings_carry_the_pleat_key(self):
        for sfx in ("L", "R"):
            keys = self.objs[f"Wing_{sfx}"].data.shape_keys.key_blocks
            basis, pleat = keys["Basis"], keys[f"membrane_pleat_{sfx}"]
            moved = max((pleat.data[i].co - basis.data[i].co).length for i in range(len(basis.data)))
            self.assertTrue(0.02 < moved < 0.06, moved)

    def test_prosthetic_fin_is_left_only(self):
        self.assertIn("prosthetic", [m.name for m in self.objs["tailfin_L"].data.materials])
        self.assertNotIn("prosthetic", [m.name for m in self.objs["tailfin_R"].data.materials])

    def test_spread_wingspan(self):
        xs = [abs(v.co.x) for o in (self.objs["Wing_L"], self.objs["Wing_R"]) for v in o.data.vertices]
        self.assertTrue(6.5 <= max(xs) <= 7.1, max(xs))

    def test_folded_wings_tuck_against_the_body(self):
        m = W.fold_metrics(self.rig, [self.objs["Wing_L"], self.objs["Wing_R"]], 1.0)
        self.assertLessEqual(m["max_abs_x"], 0.85, m)
        self.assertGreaterEqual(m["min_z"], 0.8, m)   # no membrane skirt hanging below the flank
        self.assertLessEqual(m["max_y"], 2.4, m)

    def test_folded_hip_wings_stay_close(self):
        m = W.fold_metrics(self.rig, [self.objs["hipwing_L"], self.objs["hipwing_R"]], 1.0)
        self.assertLessEqual(m["max_abs_x"], 0.6, m)


if __name__ == "__main__":
    unittest.main()
```
Run: `npm run blender:test` → FAIL: `No module named 'wings'`.

- [ ] **Step 2: Implement `wings.py`**

Port prototype `fan.py` (`_vec`, `_blend`, `rib_weights`, `MeshBuilder`, `fan_panels`, `coons_panel`, `spar`) and the wing code of `build_parts.py` (`spine_weights_at`, `build_main_wing`, `build_small_fan`, and the loop that builds both sides) into one module. Make these changes:
- `build_all(rig, M)` takes the materials dict (`M["membrane"]`, `M["skin"]`, `M["claw"]`, `M["prosthetic"]`, `M["metal"]`) instead of creating materials.
- The left tail fin (the prosthetic) uses `[M["prosthetic"], M["metal"]]`, so its spars are metal. The right fin uses `[M["membrane"], M["skin"]]`.
- It returns the six objects.
- Pleat key: accordion offsets that the motion system blends in while folding.
  - `MeshBuilder` grows a per-vertex `pleat` list next to `weights`, and `vert(self, p, w, pleat=None)` appends `pleat or Vector()`.
  - `fan_panels(..., pleat=0.0)`: vertex offset `down * (pleat * (1 if i % 2 == 0 else -1) * sin(pi * v) * u)`, where `i` is the panel index. Neighbouring panels bulge in opposite directions, and ribs and hub stay put.
  - `coons_panel(..., pleat=0.0)`: vertex offset `down * (pleat * sin(pi * s) * sin(2 * pi * t))`.
  - Spars get no offset.
  - `to_object(name, materials, pleat_key=None)`: when `pleat_key` is given, add a `Basis` key and a key named `pleat_key` with `co = rest + pleat[i]`. Vertex order is preserved from bmesh.
  - `build_main_wing` passes `pleat=0.035` to `fan_panels`, `pleat=0.03` to `coons_panel`, and `pleat_key=f"membrane_pleat_{sfx}"`. Hip wings and tail fins get no pleat.
- `fold_metrics`:
```python
def fold_metrics(rig, objs, amount=1.0):
    """Fold, evaluate the skinned meshes, return the folded extents (armature space = world); resets the pose."""
    R.fold_wings(rig, amount)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    xs, ys, zs = [], [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ob.matrix_world @ v.co
            xs.append(abs(p.x)); ys.append(p.y); zs.append(p.z)
        ev.to_mesh_clear()
    R.reset_pose(rig)
    return {"max_abs_x": max(xs), "min_z": min(zs), "max_y": max(ys)}
```
If `test_folded_wings_tuck_against_the_body` fails on `min_z` (the known "membrane skirt" of the prototype), tune the inner Coons panel's weights.
  - Shift `w_bottom` toward `wing_humerus` for u in 0.3–0.6 so the trailing edge rides up with the folded arm.
  - Lower the panel `sag`.
  - Re-run until all three bounds hold. **Do not loosen the bounds.**

- [ ] **Step 3: Stage + renders**

`qa.py` — add:
```python
def wing_renders(sc, rig, out_dir):
    import rig as R
    paths = [QR.shoot(sc, out_dir, "wings_spread_top", loc=(0, 0.5, 14.0), target=(0, 0.5, 0.0), ortho=15.5),
             QR.shoot(sc, out_dir, "wings_spread_hero", loc=(-7.5, -8.0, 5.0), target=(0, 0.3, 1.2))]
    R.fold_wings(rig, 0.5)
    paths.append(QR.shoot(sc, out_dir, "wings_half_hero", loc=(-5.0, -5.5, 3.2), target=(0, 0.3, 1.1)))
    R.reset_pose(rig)
    R.fold_wings(rig, 1.0)
    paths += [QR.shoot(sc, out_dir, "wings_folded_hero", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
              QR.shoot(sc, out_dir, "wings_folded_side", loc=(9.0, 1.3, 1.1), target=(0, 1.3, 1.1), ortho=7.9),
              QR.shoot(sc, out_dir, "wings_folded_top", loc=(0, 1.3, 9.0), target=(0, 1.3, 0.0), ortho=7.9)]
    R.reset_pose(rig)
    paths += _composite(out_dir, "wings_vs_ref_top", "wings_spread_top", REF_TOP)
    return paths
```
`build.py` — add `import wings as W` next to the other imports, then add `stage_wings` above `STAGES`:
```python
def stage_wings():
    rig, body = open_stage("model")
    sc = bpy.context.scene
    coll = SC.collection("01_Toothless")
    for ob in W.build_all(rig, materials()):
        SC.move_to(ob, coll)
    print("WINGS folded", W.fold_metrics(rig, [bpy.data.objects["Wing_L"], bpy.data.objects["Wing_R"]]))
    QR.setup_clay(sc)
    qa.wing_renders(sc, rig, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_wings.blend"))
```
and `STAGES = {"model": stage_model, "wings": stage_wings}`.

- [ ] **Step 4: Run and accept**

Run: `npm run blender:test` → `Ran 32 tests … OK`. Then run: `… run.ps1 pipeline/blender/toothless/build.py --stage wings` → exit 0.
Visual acceptance (Read the PNGs):
- **Spread:** the planform resembles the reference top view.
  - fan hub about a third of the half-span out, long leading rib
  - scalloped trailing edge
  - hip wings on the tail base, long tail fins, the red prosthetic on the left
- **Half and folded:**
  - the membrane closes like a hand fan, with no inner "tent"
  - the folded bundle lies along the flank between shoulder and tail base
  - no membrane pokes through the body

- [ ] **Step 5: Commit** — wings, tests, qa/build changes, PNGs. Message: `feat(toothless): fan-fold wings, hip wings, tail fins with pleat keys`.

---

### Task 5: Tack — saddle, harness, pedal, linkage cable, prosthetic hardware

**Files:**
- Create: `pipeline/blender/toothless/tack.py`, `pipeline/blender/tests/test_tack.py`
- Modify: `pipeline/blender/toothless/build.py` (add `stage_tack`, register `"tack"`), `pipeline/blender/toothless/qa.py` (add `tack_renders`)
- Output: `docs/progress/img/toothless/tack_*.png`, `pipeline/blender/build/toothless_tack.blend`

**Interfaces:**
- Consumes: `anatomy` (SADDLE_Y, SADDLE_HALF_WIDTH, PEDAL_L, TAIL_PTS, TAIL_RADII, TAIL_FIN_L), `build.materials/open_stage`.
- Produces: `tack.build_all(rig, body, M) -> [Saddle, SaddlePommel, SaddleCantle, GirthFront, GirthRear, StirrupStrap, Pedal, FinCable, FinClamp]` (materials `leather` / `metal`, every part skinned by explicit vertex groups); `tack.spine_weight(y) -> dict`, `tack.tail_weight(y) -> dict`; `qa.tack_renders(sc, out_dir) -> [paths]`.

- [ ] **Step 1: Write the failing tests** (a stand-in ellipsoid body keeps them fast; the real body is checked visually in Step 4)

`pipeline/blender/tests/test_tack.py`:
```python
import unittest
import bpy
from mathutils.bvhtree import BVHTree
import scene as SC
import rig as R
import tack as T

PARTS = ["Saddle", "SaddlePommel", "SaddleCantle", "GirthFront", "GirthRear", "StirrupStrap", "Pedal", "FinCable", "FinClamp"]


class TackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=(0, -0.2, 1.0))
        cls.body = bpy.context.active_object
        cls.body.name = "Toothless"
        cls.body.scale = (0.5, 1.6, 0.45)
        bpy.ops.object.transform_apply(scale=True)
        M = {n: bpy.data.materials.new(n) for n in ("leather", "metal")}
        cls.objs = {o.name: o for o in T.build_all(cls.rig, cls.body, M)}

    def test_builds_every_part(self):
        self.assertEqual(sorted(self.objs), sorted(PARTS))

    def test_every_vertex_is_weighted_to_existing_bones(self):
        bones = set(self.rig.data.bones.keys())
        for ob in self.objs.values():
            self.assertTrue(ob.vertex_groups, ob.name)
            for g in ob.vertex_groups:
                self.assertIn(g.name, bones, (ob.name, g.name))
            self.assertTrue(all(v.groups for v in ob.data.vertices), ob.name)

    def test_saddle_seat_hugs_the_body(self):
        dg = bpy.context.evaluated_depsgraph_get()
        bvh = BVHTree.FromObject(self.body.evaluated_get(dg), dg)
        worst = max(bvh.find_nearest(v.co)[3] for v in self.objs["Saddle"].data.vertices)
        self.assertLess(worst, 0.05)

    def test_tail_weight_is_continuous_and_normalised(self):
        ys = [0.9 + i * 0.002 for i in range(2000)]
        for a, b in zip(ys, ys[1:]):
            wa, wb = T.tail_weight(a), T.tail_weight(b)
            self.assertAlmostEqual(sum(wa.values()), 1.0, places=9)
            for k in set(wa) | set(wb):
                self.assertLess(abs(wa.get(k, 0.0) - wb.get(k, 0.0)), 0.02, (a, k))

    def test_spine_weight_is_normalised(self):
        for i in range(200):
            y = -1.0 + i * 0.01
            self.assertAlmostEqual(sum(T.spine_weight(y).values()), 1.0, places=9)


if __name__ == "__main__":
    unittest.main()
```
Run: `npm run blender:test` → FAIL: `No module named 'tack'`.

- [ ] **Step 2: Implement `tack.py`**

```python
"""Hiccup's tack: saddle (seat + pommel and cantle rolls), two girth straps, left stirrup strap + pedal plate,
the fin-linkage cable along the left flank and tail, and the clamp ring at the prosthetic fin's root."""
import math
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import anatomy as A


def _bvh(body):
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(body.evaluated_get(dg), dg)


def _drop(bvh, x, y, z_from=3.0):
    """Body surface point + normal straight below (x, y); (None, None) when the ray misses."""
    hit, normal, _, _ = bvh.ray_cast(Vector((x, y, z_from)), Vector((0, 0, -1)))
    return hit, normal


def _obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def _solidify(ob, thickness, offset):
    mod = ob.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="solid")


def _bind(ob, rig, weight_fn):
    """weight_fn(co) -> {bone: w}: vertex groups + armature modifier + parent to the rig."""
    groups = {}
    for v in ob.data.vertices:
        w = weight_fn(v.co)
        tot = sum(w.values()) or 1.0
        for g, val in w.items():
            if g not in groups:
                groups[g] = ob.vertex_groups.new(name=g)
            groups[g].add([v.index], val / tot, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig


def spine_weight(y):
    """Blend between spine bones by position along the back (bone midpoints)."""
    pts = [("chest", -0.72), ("spine_03", -0.44), ("spine_02", -0.15), ("spine_01", 0.15), ("pelvis", 0.46)]
    if y <= pts[0][1]:
        return {pts[0][0]: 1.0}
    if y >= pts[-1][1]:
        return {pts[-1][0]: 1.0}
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            return {a: 1 - t, b: t}


def tail_weight(y):
    """Tail bone i spans TAIL_PTS[i-1] -> TAIL_PTS[i]; weights hand over across each joint (outer 30 % of each side)."""
    ys = [float(p[1]) for p in A.TAIL_PTS]
    if y <= ys[0]:
        return {"pelvis": 1.0}
    for i in range(len(ys) - 1):
        if y <= ys[i + 1]:
            t = (y - ys[i]) / (ys[i + 1] - ys[i])
            bone = f"tail_{i + 1:02d}"
            if t > 0.7 and i + 2 <= 12:
                k = (t - 0.7) / 0.6
                return {bone: 1 - k, f"tail_{i + 2:02d}": k}
            if t < 0.3:
                k = (0.3 - t) / 0.6
                return {bone: 1 - k, ("pelvis" if i == 0 else f"tail_{i:02d}"): k}
            return {bone: 1.0}
    return {"tail_12": 1.0}


def tube(name, pts, radius, mat, segs=8, closed=False):
    """Round tube through `pts` (Vectors)."""
    bm = bmesh.new()
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        a = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        b = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        t = (b - a).normalized()
        x = t.cross(Vector((0, 0, 1)))
        if x.length < 1e-6:
            x = t.cross(Vector((1, 0, 0)))
        x.normalize()
        y = t.cross(x)
        rings.append([bm.verts.new(p + (x * math.cos(2 * math.pi * j / segs) + y * math.sin(2 * math.pi * j / segs)) * radius)
                      for j in range(segs)])
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new([r0[j], r0[j2], r1[j2], r1[j]])
    return _obj(name, bm, mat)


def saddle(rig, M, bvh):
    """Seat: a leather sheet draped 1.5 cm above the back and solidified 3 cm inward (no gap; the underside hides in
    the body), plus a pommel roll across the front edge and a taller cantle roll across the back edge."""
    nx, ny = 10, 10
    y0, y1 = A.SADDLE_Y
    hw = A.SADDLE_HALF_WIDTH
    rows = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x, y = -hw + 2 * hw * i / nx, y0 + (y1 - y0) * j / ny
            hit, n = _drop(bvh, x, y)
            if hit is None:
                raise RuntimeError(f"saddle ray missed the body at ({x:.2f}, {y:.2f})")
            row.append(hit + n * 0.015)
        rows.append(row)
    bm = bmesh.new()
    verts = [[bm.verts.new(p) for p in row] for row in rows]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new([verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]])
    seat = _obj("Saddle", bm, M["leather"])
    _solidify(seat, 0.03, -1.0)

    def weight(co):
        return {"saddle": 0.7, **{k: v * 0.3 for k, v in spine_weight(co.y).items()}}

    _bind(seat, rig, weight)
    pommel = tube("SaddlePommel", [p + Vector((0, 0, 0.03)) for p in rows[0][1:-1]], 0.03, M["leather"])
    cantle = tube("SaddleCantle", [p + Vector((0, 0, 0.045)) for p in rows[-1][1:-1]], 0.045, M["leather"])
    for ob in (pommel, cantle):
        _bind(ob, rig, weight)
    return [seat, pommel, cantle]


def girth(rig, bvh, name, y, M):
    """A 5 cm band hugging the body cross-section at `y` (rays cast inward around the body axis)."""
    centre = Vector((0.0, y, 1.0))
    ring = []
    for k in range(48):
        a = 2 * math.pi * k / 48
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        hit, n, _, _ = bvh.ray_cast(centre + d * 1.4, -d)
        if hit is None:
            raise RuntimeError(f"{name}: ray {k} missed the body")
        ring.append(hit + n * 0.006)
    bm = bmesh.new()
    front = [bm.verts.new(p + Vector((0, -0.025, 0))) for p in ring]
    back = [bm.verts.new(p + Vector((0, 0.025, 0))) for p in ring]
    for k in range(48):
        k2 = (k + 1) % 48
        bm.faces.new([front[k], front[k2], back[k2], back[k]])
    ob = _obj(name, bm, M["leather"])
    _solidify(ob, 0.008, 1.0)
    _bind(ob, rig, lambda co: spine_weight(y))
    return ob


def build_all(rig, body, M):
    bvh = _bvh(body)
    objs = saddle(rig, M, bvh)
    objs += [girth(rig, bvh, "GirthFront", -0.30, M), girth(rig, bvh, "GirthRear", -0.12, M)]

    # pedal plate 4 cm outside the left flank at the pedal pivot; stirrup strap from the saddle's left edge down to it
    py, pz = float(A.PEDAL_L[1]), float(A.PEDAL_L[2])
    side, _, _, _ = bvh.ray_cast(Vector((1.5, py, pz)), Vector((-1, 0, 0)))
    if side is None:
        raise RuntimeError("pedal ray missed the flank")
    plate = Vector((side.x + 0.04, py, pz))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.09, v.co.y * 0.16, v.co.z * 0.02)) + plate
    pedal = _obj("Pedal", bm, M["metal"])
    _bind(pedal, rig, lambda co: {"pedal_L": 1.0})
    edge, _ = _drop(bvh, A.SADDLE_HALF_WIDTH - 0.02, py)
    if edge is None:
        raise RuntimeError("stirrup ray missed the back")
    top = plate + Vector((0, 0, 0.03))
    strap = tube("StirrupStrap", [edge + Vector((0.01, 0, 0.01)), edge.lerp(top, 0.5) + Vector((0.03, 0, 0)), top], 0.012, M["leather"])
    _bind(strap, rig, lambda co: {"pedal_L": 1.0} if co.z < edge.z - 0.1 else {"saddle": 1.0})
    objs += [pedal, strap]

    # fin-linkage cable: pedal -> along the left flank -> along the tail's upper left -> the prosthetic fin hub
    path = [plate + Vector((0.0, 0.08, 0.0))]
    for y in (0.1, 0.5, 0.85):
        hit, n = _drop(bvh, 0.30, y)
        if hit is None:
            raise RuntimeError(f"cable ray missed the flank at y={y}")
        path.append(hit + n * 0.02)
    diag = Vector((1.0, 0.0, 1.0)).normalized()
    for p, r in zip(A.TAIL_PTS[2:10], A.TAIL_RADII[2:10]):
        path.append(Vector(p) + diag * (float(r) + 0.012))
    hub = Vector(A.TAIL_FIN_L["hub"])
    path.append(hub + Vector((0.0, -0.05, 0.02)))
    cable = tube("FinCable", path, 0.007, M["metal"], segs=6)
    _bind(cable, rig, lambda co: {"pedal_L": 1.0} if (co - plate).length < 0.12
          else (spine_weight(co.y) if co.y < 0.8 else tail_weight(co.y)))
    objs.append(cable)

    # clamp ring around the tail at the prosthetic fin's root
    (y8, z8), (y9, z9) = (float(A.TAIL_PTS[8][1]), float(A.TAIL_PTS[8][2])), (float(A.TAIL_PTS[9][1]), float(A.TAIL_PTS[9][2]))
    hub_y = float(hub.y)
    zc = z8 + (hub_y - y8) * (z9 - z8) / (y9 - y8)
    rad = float(A.TAIL_RADII[8]) + 0.012
    ring = [Vector((math.cos(a) * rad, hub_y, zc + math.sin(a) * rad)) for a in (2 * math.pi * k / 24 for k in range(24))]
    clamp = tube("FinClamp", ring, 0.01, M["metal"], closed=True)
    _bind(clamp, rig, lambda co: tail_weight(hub_y))
    objs.append(clamp)
    return objs
```

- [ ] **Step 3: Stage + renders**

`qa.py` — add:
```python
def tack_renders(sc, out_dir):
    return [QR.shoot(sc, out_dir, "tack_hero", loc=(-3.2, -2.6, 2.4), target=(0, -0.3, 1.2)),
            QR.shoot(sc, out_dir, "tack_side", loc=(3.5, -0.3, 1.5), target=(0, -0.3, 1.2)),
            QR.shoot(sc, out_dir, "tack_tail", loc=(2.5, 4.0, 1.4), target=(0, 3.8, 0.7))]
```
`build.py` — add `import tack as T`, then `stage_tack` above `STAGES`:
```python
def stage_tack():
    rig, body = open_stage("wings")
    sc = bpy.context.scene
    coll = SC.collection("01_Toothless")
    for ob in T.build_all(rig, body, materials()):
        SC.move_to(ob, coll)
    QR.setup_clay(sc)
    qa.tack_renders(sc, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_tack.blend"))
```
and `STAGES = {"model": stage_model, "wings": stage_wings, "tack": stage_tack}`.

- [ ] **Step 4: Run and accept**

Run: `npm run blender:test` → `Ran 37 tests … OK`. Then run `… build.py --stage tack` → exit 0.
Visual acceptance (Read the PNGs; tune positions and radii — not the anatomy — until all hold):
- The saddle sits on the back behind the wing roots, clear of the membrane roots, with no body poking through.
- The pommel and cantle read as a riding saddle.
- The girth straps hug the chest behind the front legs.
- The pedal hangs just outside the left flank.
- The cable runs from the pedal along the left flank and tail to the red fin, and never sinks into the body. Route it around the hip-wing root if it intersects.
- The clamp ring sits around the tail at the fin root.

- [ ] **Step 5: Commit** — tack, test, qa/build changes, PNGs. Message: `feat(toothless): saddle, harness, pedal and prosthetic-fin linkage`.

---

### Task 6: Assembly — body weights, face shape keys, `_MASK`, join, deformation QA

**Files:**
- Create: `pipeline/blender/toothless/assemble.py`, `pipeline/blender/tests/test_assemble.py`
- Modify: `pipeline/blender/toothless/build.py` (add `stage_assemble`, register `"assemble"`), `pipeline/blender/toothless/qa.py` (add `DEFORM_POSES`, `deform_renders`)
- Output: `docs/progress/img/toothless/deform_*.png`, `pipeline/blender/build/toothless_assembled.blend`

**Interfaces:**
- Consumes: Tasks 2–5 outputs (rig, body, parts, wings, tack), `sculpt.MOUTH_LINE_L/MOUTH_Z/dorsal_spikes`, `anatomy.HEAD_OFFSET`, `meshtools.select_only`.
- Produces:
  - `assemble.run(rig, body) -> body`: `Toothless` becomes the single joined skinned mesh.
    - ≤ 4 weights per vertex, normalised.
    - Shape keys `blink_L, blink_R, squint, teeth_out, membrane_pleat_L, membrane_pleat_R, smile, snarl, nostril_flare`.
    - A FLOAT_VECTOR POINT attribute `_MASK` (x = AO, y = underside, z = dorsal).
  - Helpers: `assemble.{smoothstep, hemisphere_dirs, occluder_bvh, vertex_ao, dorsal_weight, skin_body, add_face_keys, add_masks, join_all}`.
  - `qa.deform_renders(sc, rig, body, out_dir)`.

- [ ] **Step 1: Write the failing helper tests**

`pipeline/blender/tests/test_assemble.py`:
```python
import unittest
import bpy
from mathutils import Vector
import scene as SC
import sculpt as SB
import assemble as AS


class AssembleHelperTests(unittest.TestCase):
    def test_hemisphere_dirs_are_unit_upper_and_cosine_weighted(self):
        dirs = AS.hemisphere_dirs(256)
        self.assertTrue(all(abs(d.length - 1) < 1e-9 and d.z > 0 for d in dirs))
        mean_z = sum(d.z for d in dirs) / len(dirs)
        self.assertAlmostEqual(mean_z, 2 / 3, delta=0.01)   # E[cos θ] for cosine-weighted directions

    def test_smoothstep_handles_reversed_edges(self):
        self.assertEqual(AS.smoothstep(-0.15, -0.65, 0.0), 0.0)
        self.assertEqual(AS.smoothstep(-0.15, -0.65, -1.0), 1.0)
        self.assertAlmostEqual(AS.smoothstep(0.0, 1.0, 0.5), 0.5)

    def test_vertex_ao_darkens_under_an_overhang(self):
        SC.reset()
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=20, y_subdivisions=20, size=4.0)
        ground = bpy.context.active_object
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.3))
        roof = bpy.context.active_object
        roof.scale = (2.0, 2.0, 0.05)
        bpy.ops.object.transform_apply(scale=True)
        ao = AS.vertex_ao(ground, AS.occluder_bvh([ground, roof]), AS.hemisphere_dirs(), dist=0.5)
        verts = ground.data.vertices
        under = [a for v, a in zip(verts, ao) if abs(v.co.x) < 0.2 and abs(v.co.y) < 0.2]
        open_sky = [a for v, a in zip(verts, ao) if abs(v.co.x) > 1.6]
        self.assertLess(max(under), 0.4)
        self.assertGreater(min(open_sky), 0.95)

    def test_dorsal_weight_marks_spike_bases_only(self):
        spikes = SB.dorsal_spikes()
        base = Vector(spikes[10][0])
        self.assertEqual(AS.dorsal_weight(base + Vector((0, 0, 0.01)), spikes), 1.0)
        self.assertEqual(AS.dorsal_weight(base + Vector((0.3, 0, 0)), spikes), 0.0)


if __name__ == "__main__":
    unittest.main()
```
Run: `npm run blender:test` → FAIL: `No module named 'assemble'`.

- [ ] **Step 2: Implement `assemble.py`**

```python
"""Assembly: body skin weights, face shape keys, the _MASK attribute (ray-traced vertex AO + region masks),
then one joined skinned mesh with <= 4 influences per vertex."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import anatomy as A
import meshtools as MT
import sculpt as SB

NON_BODY = ("wing_", "hipwing_", "tailfin_", "ear_", "saddle", "pedal_")
WING_PARTS = ("Wing_", "hipwing_", "tailfin_")


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def skin_body(body, rig):
    """Heat weights on the body with the non-body bones excluded (they would steal weights)."""
    saved = {b.name: b.use_deform for b in rig.data.bones}
    for b in rig.data.bones:
        b.use_deform = not b.name.startswith(NON_BODY)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for b in rig.data.bones:
        b.use_deform = saved[b.name]
    # scripted correction (spec §5.6): a light smooth of every group evens out limb seams
    MT.select_only(body)
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=2)
    # Blender reports heat-weighting failure only as a warning: failed bones end up with empty groups
    counts = {}
    for v in body.data.vertices:
        for g in v.groups:
            if g.weight > 0.2:
                name = body.vertex_groups[g.group].name
                counts[name] = counts.get(name, 0) + 1
    empty = [b.name for b in rig.data.bones if not b.name.startswith(NON_BODY) and counts.get(b.name, 0) < 5]
    if empty or counts.get("jaw", 0) < 500:
        raise RuntimeError(f"heat weighting failed: empty={empty} jaw={counts.get('jaw', 0)}")
    return counts


def _falloff(d, radius):
    return 1.0 - smoothstep(0.0, radius, d)


def add_face_keys(body):
    """smile / snarl / nostril_flare on the body (the join later merges keys by name)."""
    if body.data.shape_keys is None:
        body.shape_key_add(name="Basis")
    rest = [v.co.copy() for v in body.data.vertices]
    corner = Vector(SB.MOUTH_LINE_L[-1])
    corners = [corner, Vector((-corner.x, corner.y, corner.z))]
    lip = [Vector(p) for p in SB.MOUTH_LINE_L[:4]] + [Vector((-p[0], p[1], p[2])) for p in SB.MOUTH_LINE_L[1:4]]
    nostrils = [Vector((s * 0.062, -2.2, 1.708)) + Vector(A.HEAD_OFFSET) for s in (1, -1)]
    smile = body.shape_key_add(name="smile", from_mix=False)
    snarl = body.shape_key_add(name="snarl", from_mix=False)
    flare = body.shape_key_add(name="nostril_flare", from_mix=False)
    for i, p in enumerate(rest):
        d_corner = min((p - c).length for c in corners)
        smile.data[i].co = p + Vector((0, 0.014, 0.016)) * _falloff(d_corner, 0.08)
        off = Vector()
        if p.z > SB.MOUTH_Z:
            off += Vector((0, 0, 0.016)) * _falloff(min((p - c).length for c in lip), 0.05)
        near = min(nostrils, key=lambda c: (p - c).length)
        d_nostril = (p - near).length
        off += Vector((0, 0.005, 0.006)) * _falloff(d_nostril, 0.04)
        snarl.data[i].co = p + off
        radial = Vector((p.x - near.x, p.y - near.y, 0.0))
        flare.data[i].co = p + (radial.normalized() * 0.006 * _falloff(d_nostril, 0.035) if radial.length > 1e-6 else Vector())


def hemisphere_dirs(n=48):
    """Deterministic cosine-weighted directions around +Z (Fibonacci spiral)."""
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        phi = i * golden
        out.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - r * r)))))
    return out


def occluder_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(verts)
        verts += [ob.matrix_world @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def vertex_ao(ob, bvh, dirs, dist=0.5):
    """Per-vertex ambient occlusion: 1 = open, 0 = fully occluded within `dist` metres."""
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    out = []
    for v in ob.data.vertices:
        n = (nm @ v.normal).normalized()
        q = n.to_track_quat("Z", "Y")
        origin = mw @ v.co + n * 0.003
        hits = sum(1 for d in dirs if bvh.ray_cast(origin, q @ d, dist)[0] is not None)
        out.append(1.0 - hits / len(dirs))
    return out


def dorsal_weight(p, spikes):
    """1 on and around a dorsal spike (distance measured in the spikes' un-squashed space), else 0."""
    for base, tip, radius in spikes:
        q = Vector(p) - Vector(base)
        q.x /= 0.33
        axis = Vector(tip) - Vector(base)
        length = axis.length
        a = axis / length
        u = max(0.0, min(1.0, q.dot(a) / length))
        if (q - a * (u * length)).length <= radius + (0.004 - radius) * u + 0.012:
            return 1.0
    return 0.0


def _write_mask(ob, rows):
    attr = ob.data.attributes.get("_MASK") or ob.data.attributes.new("_MASK", "FLOAT_VECTOR", "POINT")
    attr.data.foreach_set("vector", [c for row in rows for c in row])


def add_masks(objs):
    """_MASK on every mesh before joining (the join merges same-named attributes).
    Wing membranes are not occluders — spread in the bind pose they would roof over the flanks."""
    wings = [o for o in objs if o.name.startswith(WING_PARTS)]
    solid = [o for o in objs if o not in wings]
    bvh = occluder_bvh(solid)
    dirs = hemisphere_dirs()
    spikes = SB.dorsal_spikes()
    for ob in objs:
        if ob in wings:
            _write_mask(ob, [(1.0, 0.0, 0.0)] * len(ob.data.vertices))
            continue
        ao = vertex_ao(ob, bvh, dirs)
        nm = ob.matrix_world.to_3x3().inverted().transposed()
        is_body = ob.name == "Toothless"
        rows = []
        for v, occ in zip(ob.data.vertices, ao):
            p = ob.matrix_world @ v.co
            n = (nm @ v.normal).normalized()
            under = smoothstep(-0.15, -0.65, n.z) if is_body else 0.0
            dorsal = dorsal_weight(p, spikes) if is_body and abs(p.x) < 0.12 and p.z > 0.4 else 0.0
            rows.append((occ, under, dorsal))
        _write_mask(ob, rows)


def join_all(body, rig):
    parts = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not body]
    for o in parts:
        MT.select_only(o)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    arm = [m for m in body.modifiers if m.type == "ARMATURE"]
    for m in arm[1:]:
        body.modifiers.remove(m)
    arm[0].object = rig
    MT.select_only(body)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    unweighted = sum(1 for v in body.data.vertices if not v.groups)
    if unweighted:
        raise RuntimeError(f"{unweighted} unweighted vertices after the join")
    return body


def run(rig, body):
    counts = skin_body(body, rig)
    print("SKIN jaw", counts.get("jaw"), "groups", len(counts))
    add_face_keys(body)
    add_masks([o for o in bpy.context.scene.objects if o.type == "MESH"])
    join_all(body, rig)
    me = body.data
    print("JOINED verts", len(me.vertices), "tris", sum(len(p.vertices) - 2 for p in me.polygons),
          "keys", [k.name for k in me.shape_keys.key_blocks], "mats", [m.name for m in me.materials])
    return body
```

- [ ] **Step 3: Deformation QA renders + stage**

`qa.py` — add:
```python
# bone-local Euler (radians); local X is the lateral hinge for limbs and spine (+X swings a leg's far end forward)
DEFORM_POSES = {
    # walk, sit, look: prototype assemble_v5.POSES, verbatim
    "walk": {"front_humerus_L": (0.55, 0, 0), "front_radius_L": (-0.7, 0, 0), "front_humerus_R": (-0.45, 0, 0),
             "hind_femur_R": (0.5, 0, 0), "hind_tibia_R": (-0.8, 0, 0), "hind_femur_L": (-0.45, 0, 0),
             "spine_02": (0, 0, 0.12), "spine_03": (0, 0, 0.12), "neck_02": (0, 0, 0.2), "neck_03": (0, 0, 0.2), "head": (0.1, 0, 0.15),
             **{f"tail_{i:02d}": (0, 0, -0.1) for i in range(2, 10)}},
    "sit": {"pelvis": (0.55, 0, 0), "hind_femur_L": (-1.25, 0, 0), "hind_femur_R": (-1.25, 0, 0), "hind_tibia_L": (1.9, 0, 0),
            "hind_tibia_R": (1.9, 0, 0), "hind_metatarsal_L": (-0.9, 0, 0), "hind_metatarsal_R": (-0.9, 0, 0),
            "spine_01": (-0.15, 0, 0), "chest": (-0.2, 0, 0), "neck_01": (-0.2, 0, 0),
            **{f"tail_{i:02d}": (0.08, 0, 0.18) for i in range(1, 12)}},
    "look": {"neck_01": (0, 0, 0.25), "neck_02": (0, 0, 0.25), "neck_03": (0.1, 0, 0.3), "neck_04": (0.1, 0, 0.3), "head": (0.15, 0, 0.3), "jaw": (-0.45, 0, 0)},
    # gallop extremes (legs gathered under the body / fully extended; the spine flexes and extends with them)
    "gallop_gather": {"front_humerus_L": (-0.6, 0, 0), "front_humerus_R": (-0.6, 0, 0), "hind_femur_L": (0.6, 0, 0), "hind_femur_R": (0.6, 0, 0),
                      "spine_01": (0.08, 0, 0), "spine_02": (0.08, 0, 0), "spine_03": (-0.08, 0, 0), "chest": (-0.08, 0, 0)},
    "gallop_extend": {"front_humerus_L": (0.7, 0, 0), "front_humerus_R": (0.7, 0, 0), "front_radius_L": (-0.3, 0, 0), "front_radius_R": (-0.3, 0, 0),
                      "hind_femur_L": (-0.55, 0, 0), "hind_femur_R": (-0.55, 0, 0), "spine_01": (-0.05, 0, 0), "chest": (0.05, 0, 0)},
    # the rest of the spec §5.12 set (+ pitch lifts a bone's forward end; + yaw turns it to the dragon's left) —
    # confirm each sign on the renders and flip any that bend the wrong way
    "lie": {"front_humerus_L": (-0.9, 0, 0), "front_humerus_R": (-0.9, 0, 0), "front_radius_L": (1.7, 0, 0), "front_radius_R": (1.7, 0, 0),
            "front_metacarpal_L": (-0.8, 0, 0), "front_metacarpal_R": (-0.8, 0, 0),
            "hind_femur_L": (-1.25, 0, 0), "hind_femur_R": (-1.25, 0, 0), "hind_tibia_L": (1.9, 0, 0), "hind_tibia_R": (1.9, 0, 0),
            "hind_metatarsal_L": (-0.9, 0, 0), "hind_metatarsal_R": (-0.9, 0, 0)},
    "scratch": {"hind_femur_L": (1.2, 0, 0.2), "hind_tibia_L": (-1.5, 0, 0), "hind_metatarsal_L": (0.8, 0, 0),
                "neck_01": (0, 0, 0.3), "neck_02": (0, 0, 0.3), "neck_03": (0, 0, 0.25), "neck_04": (0, 0, 0.2), "head": (0.2, 0, 0.3)},
    "climb_reach": {"front_scapula_L": (0.3, 0, 0), "front_humerus_L": (1.1, 0, 0), "front_radius_L": (0.3, 0, 0),
                    "chest": (0.2, 0, 0), "neck_01": (0.15, 0, 0), "neck_02": (0.15, 0, 0)},
    "neck_90": {"neck_01": (0, 0, 0.3), "neck_02": (0, 0, 0.3), "neck_03": (0, 0, 0.3), "neck_04": (0, 0, 0.3), "head": (0, 0, 0.3)},
    "tail_curl": {f"tail_{i:02d}": (0, 0, 0.22) for i in range(1, 13)},
}
FACE_POSES = {"blink": {"blink_L": 1, "blink_R": 1}, "squint": {"squint": 1}, "smile": {"smile": 1},
              "snarl": {"snarl": 1, "teeth_out": 1}, "roar": {"teeth_out": 1}}


def deform_renders(sc, rig, body, out_dir):
    import rig as R
    keys = body.data.shape_keys.key_blocks
    paths = []

    def pose(bones, fold=1.0, jaw=0.0):
        R.reset_pose(rig)
        R.fold_wings(rig, fold)
        if jaw:
            R.pose_jaw(rig, jaw)
        for name, rot in bones.items():
            pb = rig.pose.bones[name]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = rot
        import bpy
        bpy.context.view_layer.update()

    for name, bones in DEFORM_POSES.items():
        pose(bones)
        paths += [QR.shoot(sc, out_dir, f"deform_{name}_hero", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)),
                  QR.shoot(sc, out_dir, f"deform_{name}_side", loc=(7.5, 0.4, 1.3), target=(0, 0.4, 0.9))]
    for name, weights in FACE_POSES.items():
        pose({}, jaw=1.0 if name == "roar" else 0.0)
        for k, w in weights.items():
            keys[k].value = w
        paths.append(QR.shoot(sc, out_dir, f"deform_face_{name}", loc=(-1.45, -2.75, 1.55), target=(0, -1.9, 1.45), lens=50))
        for k in weights:
            keys[k].value = 0.0
    for fold in (0.5, 1.0):
        pose({}, fold=fold)
        paths.append(QR.shoot(sc, out_dir, f"deform_wings_{int(fold * 100)}", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)))
    keys["membrane_pleat_L"].value = keys["membrane_pleat_R"].value = 1.0
    paths.append(QR.shoot(sc, out_dir, "deform_wings_100_pleat", loc=(-4.4, -5.0, 2.6), target=(0, 0.2, 1.0)))
    keys["membrane_pleat_L"].value = keys["membrane_pleat_R"].value = 0.0
    R.reset_pose(rig)
    return paths
```
`build.py` — add `import assemble as AS`, then:
```python
def stage_assemble():
    rig, body = open_stage("tack")
    sc = bpy.context.scene
    AS.run(rig, body)
    QR.setup_clay(sc)
    qa.deform_renders(sc, rig, body, QA_DIR)
    SC.save(os.path.join(BUILD, "toothless_assembled.blend"))
```
and register `"assemble": stage_assemble` after `"tack"`.

- [ ] **Step 4: Run and accept**

Run: `npm run blender:test` → `Ran 41 tests … OK`. Then run `… build.py --stage assemble` → exit 0. It prints `SKIN jaw …` and `JOINED …`, with ≤ 90 000 triangles and all nine shape keys.
Visual acceptance (Read every `deform_*` PNG; fix weights, keys or poses and re-run until all hold):
- **Body:** no candy-wrapper twists or collapsed volume at the shoulders, hips or neck. If a pose tips the whole body over (the pelvis is the root), counter-rotate up the spine instead of changing the rig.
- **Jaw and teeth:** the jaw opens cleanly (no pouch); the tongue shows; teeth slide out.
- **Face:** the lids close fully (no sliver); the squint narrows the eyes; the smile reads as a gummy Toothless grin; the snarl lifts the lip over the teeth.
- **Wings and tack:**
  - folded wings sit along the flank; pleated folds read as folded membrane
  - saddle, straps, pedal and cable follow the body
- Maps (vertex colours): render one extra image `deform_mask_ao` with `sh.color_type = "ATTRIBUTE"` and `_MASK` set as the active colour for display. Skip this render if Workbench cannot show a FLOAT_VECTOR attribute, and note that in the report. AO should darken the armpits, under the jaw, between the legs and around the eyes.

- [ ] **Step 5: Commit** — assemble, test, qa/build changes, PNGs. Message: `feat(toothless): assembly — weights, face shape keys, AO/region masks, deformation QA`.

---

### Task 7: Pose clips, export, rig.json and asset tests

**Files:**
- Create: `pipeline/blender/toothless/poses.py`, `pipeline/blender/toothless/export.py`, `tests/assets/glb.ts`, `tests/assets/toothless.test.ts`
- Modify: `pipeline/blender/toothless/build.py` (add `stage_export`, register `"export"`)
- Output: `public/assets/characters/toothless/toothless.glb`, `toothless.poses.glb`, `toothless.rig.json`, `toothless.poses.json`

**Interfaces:**
- Produces: GLB (mesh `Toothless`, skin 101 joints, morphs `blink_L, blink_R, squint, teeth_out, membrane_pleat_L, membrane_pleat_R, smile, snarl, nostril_flare`, bind pose only), `toothless.poses.glb` (armature + clips `bind, wings_folded, wings_half, jaw_open` as glTF animations — spec §5.11; the full pose library lands with the motion plan, M6), `rig.json` (schema below), `poses.json` (`{"clips": {"bind": {"mask": "all"}, "wings_folded": {"mask": ["wing_", "hipwing_"]}, "wings_half": {"mask": ["wing_", "hipwing_"]}, "jaw_open": {"mask": ["jaw"]}}}`); `tests/assets/glb.ts: readGlbJson(path): any`.

- [ ] **Step 1: Pose clips** — `pipeline/blender/toothless/poses.py`:
```python
"""Pose clips: every bone keyed on frames 1-2 (so the glTF exporter keeps full tracks), one NLA track per clip."""
import bpy
import rig as R

CLIPS = {
    "bind": lambda rig: None,
    "wings_folded": lambda rig: R.fold_wings(rig, 1.0),
    "wings_half": lambda rig: R.fold_wings(rig, 0.5),
    "jaw_open": lambda rig: R.pose_jaw(rig, 1.0),
}


def keyframe_pose(rig, name, setter):
    R.reset_pose(rig)
    setter(rig)
    bpy.context.view_layer.update()
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        q = pb.matrix_basis.to_quaternion()      # whatever rotation mode the setter used (pose_jaw uses XYZ)
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = q
    for f in (1, 2):
        for pb in rig.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    rig.animation_data.action = None
    R.reset_pose(rig)
    return act


def make_clips(rig):
    return [keyframe_pose(rig, name, setter) for name, setter in CLIPS.items()]
```

- [ ] **Step 2: Export** — `export.py`:
```python
"""GLB + rig.json + poses.json export."""
import json
import os
import bpy
import anatomy as A

REQUIRED_OPTS = {
    "export_format": "GLB", "use_selection": True, "export_yup": True, "export_apply": False,
    "export_skins": True, "export_morph": True, "export_morph_normal": True, "export_animations": True,
    "export_animation_mode": "NLA_TRACKS", "export_force_sampling": True, "export_optimize_animation_size": False,
    "export_optimize_animation_keep_anim_armature": True, "export_def_bones": False, "export_materials": "EXPORT",
    "export_attributes": True,        # custom attributes whose names start with "_" (the _MASK vec3)
    "export_try_sparse_sk": True,     # sparse morph accessors: face keys touch a few hundred vertices, not 40 k
}


def _export(path, objects, active, **overrides):
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    missing = [k for k in REQUIRED_OPTS if k not in props]
    if missing:
        raise RuntimeError(f"glTF exporter lacks options {missing}")
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.export_scene.gltf(filepath=path, **{**REQUIRED_OPTS, **overrides})


def export_glb(rig, mesh, path):
    """Mesh + skin + morphs in the bind pose; the pose library ships separately."""
    if mesh.data.shape_keys:
        for kb in mesh.data.shape_keys.key_blocks:
            kb.value = 0.0            # shape-key values become default morph weights
    _export(path, [mesh, rig], rig, export_animations=False)


def export_poses(rig, path):
    """Armature only, every NLA track as a glTF animation (spec §5.11: toothless.poses.glb)."""
    _export(path, [rig], rig)


def rig_json(rig, mesh):
    G = A.blender_to_gltf
    bones = []
    for b in rig.data.bones:
        bones.append({"name": b.name, "parent": b.parent.name if b.parent else None,
                      "head": G(b.head_local), "tail": G(b.tail_local), "length": round(b.length, 5),
                      "xAxis": G(b.matrix_local.to_3x3().col[0])})   # the hinge axis for limbs/spine (bind pose)
    spine = ["pelvis", "spine_01", "spine_02", "spine_03", "chest"]
    neck = ["neck_01", "neck_02", "neck_03", "neck_04", "head"]
    tail = [f"tail_{i:02d}" for i in range(1, 13)]
    limbs, contacts = {}, {}
    for side, s in (("L", 1), ("R", -1)):
        mirror = (lambda p: p) if s > 0 else A.mirror
        for kind, limb in A.LIMBS.items():
            key = f"{kind}_{side}"
            limbs[key] = {"bones": [f"{n}_{side}" for n in limb["bones"]], "pole": G(limb["pole"]),
                          "limitsDeg": {f"{n}_{side}": v for n, v in limb["limits"].items()}}
            c = A.CONTACTS_L[kind]
            contacts[key] = {"bone": f"{c['bone']}_{side}", "sole": G(mirror(c["sole"])),
                             "toe": G(mirror(c["toe"])), "heel": G(mirror(c["heel"]))}
    keys = [k.name for k in mesh.data.shape_keys.key_blocks[1:]] if mesh.data.shape_keys else []
    return {
        "version": 1, "units": "m", "up": "+Y", "forward": "+Z",
        "bones": bones,
        "chains": {"spine": spine, "neck": neck, "tail": tail},
        "limbs": limbs, "contacts": contacts,
        "proxies": [{"name": n, "bone": b, "center": G(c), "radius": r} for n, b, c, r in A.PROXIES],
        "anchors": {k: {"bone": b, "position": G(p)} for k, (b, p) in A.ANCHORS.items()},
        "jaw": {"bone": "jaw", "openSign": A.JAW_OPEN_SIGN, "maxOpenRad": 0.62},
        "chainLimitsDeg": A.CHAIN_LIMITS,
        "wings": {side: {"humerus": f"wing_humerus_{side}", "forearm": f"wing_forearm_{side}", "thumb": f"wing_thumb_{side}",
                         "ribs": [[f"wing_rib{i}_a_{side}", f"wing_rib{i}_b_{side}"] for i in range(1, 8)],
                         "hipRibs": [f"hipwing_rib{i}_{side}" for i in range(1, 5)],
                         "finRibs": [f"tailfin_rib{i}_{side}" for i in range(1, 4)]} for side in ("L", "R")},
        "ears": {side: [f"ear_{i}_{side}" for i in range(1, 4)] for side in ("L", "R")},
        "morphs": keys,
        "clips": ["bind", "wings_folded", "wings_half", "jaw_open"],
        "proportions": {k: round(v, 4) for k, v in A.proportions().items()},
    }


POSES = {"clips": {"bind": {"mask": "all"}, "wings_folded": {"mask": ["wing_", "hipwing_"]},
                   "wings_half": {"mask": ["wing_", "hipwing_"]}, "jaw_open": {"mask": ["jaw"]}}}


def write_all(rig, mesh, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    export_glb(rig, mesh, os.path.join(out_dir, "toothless.glb"))
    export_poses(rig, os.path.join(out_dir, "toothless.poses.glb"))
    with open(os.path.join(out_dir, "toothless.rig.json"), "w", encoding="utf-8") as f:
        json.dump(rig_json(rig, mesh), f, indent=1)
    with open(os.path.join(out_dir, "toothless.poses.json"), "w", encoding="utf-8") as f:
        json.dump(POSES, f, indent=1)
```
`build.py` — add `import poses as PO` and `import export as EX`, then:
```python
def stage_export():
    rig, body = open_stage("assembled")
    body.name = body.data.name = "Toothless"
    PO.make_clips(rig)
    EX.write_all(rig, body, ASSETS)
    size = os.path.getsize(os.path.join(ASSETS, "toothless.glb"))
    print("GLB bytes", size)
    if size > 6 * 1024 * 1024:
        raise RuntimeError(f"toothless.glb is {size} bytes (budget 6 MB)")
```
and register `"export": stage_export` last in `STAGES`.

- [ ] **Step 3: Structural tests (write, run — they fail before the export exists, pass after)**

`tests/assets/glb.ts`:
```ts
import { readFileSync } from 'node:fs';

/** Parse the JSON chunk of a .glb file (no binary buffers needed for structure checks). */
export function readGlbJson(path: string): any {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}
```

`tests/assets/toothless.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { readGlbJson } from './glb';

const DIR = 'public/assets/characters/toothless/';
const gltf = readGlbJson(`${DIR}toothless.glb`);
const poses = readGlbJson(`${DIR}toothless.poses.glb`);
const rig = JSON.parse(readFileSync(`${DIR}toothless.rig.json`, 'utf8'));
const MORPHS = ['blink_L', 'blink_R', 'squint', 'teeth_out', 'membrane_pleat_L', 'membrane_pleat_R', 'smile', 'snarl', 'nostril_flare'];
const MATERIALS = ['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal'];
const CLIPS = ['bind', 'wings_folded', 'wings_half', 'jaw_open'];

describe('toothless.glb', () => {
  it('stays within the size budget', () => {
    expect(statSync(`${DIR}toothless.glb`).size).toBeLessThanOrEqual(6 * 1024 * 1024);
  });
  it('has one 101-joint skin whose joints match rig.json', () => {
    expect(gltf.skins).toHaveLength(1);
    const names = gltf.skins[0].joints.map((j: number) => gltf.nodes[j].name).sort();
    expect(names).toEqual(rig.bones.map((b: any) => b.name).sort());
    expect(names).toHaveLength(101);
  });
  it('exports every morph target with zero default weights', () => {
    const mesh = gltf.meshes[0];
    for (const m of MORPHS) expect(mesh.extras.targetNames).toContain(m);
    expect(mesh.weights.every((w: number) => w === 0)).toBe(true);
  });
  it('carries skinning, eye UVs and the _MASK attribute on every primitive, within the triangle budget', () => {
    let tris = 0;
    for (const p of gltf.meshes[0].primitives) {
      for (const a of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0', '_MASK']) expect(p.attributes).toHaveProperty(a);
      tris += gltf.accessors[p.indices].count / 3;
    }
    expect(tris).toBeLessThanOrEqual(90000);
  });
  it('names every material the engine expects', () => {
    const names = gltf.materials.map((m: any) => m.name);
    for (const m of MATERIALS) expect(names).toContain(m);
  });
  it('ships the bind pose only (clips live in toothless.poses.glb)', () => {
    expect(gltf.animations ?? []).toHaveLength(0);
  });
  it('matches the locked proportions within 3 % and has finite bounds (no NaN)', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes[0].primitives) {
      const acc = gltf.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        expect(Number.isFinite(acc.min[i]) && Number.isFinite(acc.max[i])).toBe(true);
        lo[i] = Math.min(lo[i], acc.min[i]);
        hi[i] = Math.max(hi[i], acc.max[i]);
      }
    }
    const err = (v: number, target: number) => Math.abs(v - target) / target;
    expect(err(hi[0] - lo[0], rig.proportions.wingspan)).toBeLessThan(0.03);   // x: wingspan
    expect(err(hi[2] - lo[2], rig.proportions.length)).toBeLessThan(0.03);     // z: nose -> tail tip
    expect(lo[1]).toBeGreaterThan(-0.05);                                       // y: paws on the ground
  });
});

describe('toothless.poses.glb', () => {
  it('keeps full tracks for every bone in every clip', () => {
    for (const c of CLIPS) {
      const anim = poses.animations.find((a: any) => a.name === c);
      expect(anim, c).toBeTruthy();
      const nodes = new Set(anim.channels.filter((ch: any) => ch.target.path === 'rotation').map((ch: any) => ch.target.node));
      expect(nodes.size, c).toBe(101);
    }
  });
});

describe('toothless.rig.json', () => {
  const bones = new Set(rig.bones.map((b: any) => b.name));
  it('references only existing bones', () => {
    for (const chain of Object.values(rig.chains) as string[][]) for (const b of chain) expect(bones.has(b), b).toBe(true);
    for (const limb of Object.values(rig.limbs) as any[]) for (const b of limb.bones) expect(bones.has(b), b).toBe(true);
    for (const c of Object.values(rig.contacts) as any[]) expect(bones.has(c.bone)).toBe(true);
    for (const p of rig.proxies) expect(bones.has(p.bone)).toBe(true);
    for (const a of Object.values(rig.anchors) as any[]) expect(bones.has(a.bone)).toBe(true);
  });
  it('puts the paws on the ground (glTF +Y up) and opens the jaw with a negative rotation', () => {
    for (const c of Object.values(rig.contacts) as any[]) expect(c.sole[1]).toBeLessThan(0.05);
    expect(rig.jaw.openSign).toBe(-1);
  });
  it('records the locked proportions', () => {
    expect(rig.proportions.length).toBeGreaterThan(7.1);
    expect(rig.proportions.wingspan).toBeGreaterThan(13.0);
  });
});
```

Run the export stage, then `npm test -- tests/assets` → all pass.

- [ ] **Step 4: Full build** — `npm run toothless:build` runs every stage end-to-end without errors (the re-runnable pipeline the spec requires), then `npm test` (all suites) and `npm run blender:test` (`Ran 41 tests … OK`) pass. If the GLB lacks `_MASK` or `TEXCOORD_0` on some primitive, fix the Blender side (attribute type/domain, UV layer present on the joined mesh) — never relax the test.

- [ ] **Step 5: Commit** (pose/export modules, tests, the three asset files; `feat(toothless): pose clips, GLB/rig.json/poses.json export and asset tests`).

---

### Task 8: Engine binding — rig metadata, materials, asset loader, viewer

**Files:**
- Create: `src/characters/dragon/rigMeta.ts`, `src/characters/dragon/materials.ts`, `src/characters/dragon/asset.ts`, `tests/characters/rigMeta.test.ts`, `tests/characters/materials.test.ts`
- Modify: `src/dev/viewer/main.ts`
- Output: `docs/progress/img/toothless/viewer_*.png`

**Interfaces:**
- Consumes: `addCompileHook`, `ShaderParams` (render/materials), `createGltfLoader` (render/loaders), `App` (app/createApp), `debug`.
- Produces: `validateRig(raw: unknown): RigMeta`; `createDragonMaterials(opts: { sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void }): DragonMaterials` where `DragonMaterials = { skin, membrane, eye, mouth, teeth, claw, prosthetic, leather, metal: THREE.Material; byName(name: string): THREE.Material | undefined; uniforms: { rimColor, rimStrength, scaleBump, plasmaGlow, pupil, eyeGlow, irisDepth, sunDir } }`; `loadDragonAsset(opts: { glbUrl: string; posesUrl: string; rigUrl: string; sunDir: THREE.Vector3; prepare: (m) => void }): Promise<DragonAsset>` with `DragonAsset = { root: THREE.Group; meshes: THREE.SkinnedMesh[]; skeleton: THREE.Skeleton; bones: Map<string, THREE.Bone>; rig: RigMeta; clips: Map<string, THREE.AnimationClip>; morphNames: string[]; setMorph(name: string, w: number): void; materials: DragonMaterials }`; debug `berk.dragon.{clip(name), morph(name, w), pupil(v), stats()}`.

- [ ] **Step 1: Write the failing tests**

`tests/characters/rigMeta.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateRig } from '../../src/characters/dragon/rigMeta';

const raw = JSON.parse(readFileSync('public/assets/characters/toothless/toothless.rig.json', 'utf8'));

describe('validateRig', () => {
  it('accepts the exported Toothless rig', () => {
    const rig = validateRig(raw);
    expect(rig.bones).toHaveLength(101);
    expect(rig.limbs.front_L.bones[0]).toBe('front_scapula_L');
    expect(rig.jaw.openSign).toBe(-1);
  });
  it('rejects a rig whose limb references a missing bone', () => {
    const bad = structuredClone(raw);
    bad.limbs.hind_R.bones[1] = 'nope';
    expect(() => validateRig(bad)).toThrow(/hind_R.*nope/);
  });
  it('rejects a wrong version', () => {
    expect(() => validateRig({ ...raw, version: 2 })).toThrow(/version/);
  });
});
```

`tests/characters/materials.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createDragonMaterials } from '../../src/characters/dragon/materials';

describe('createDragonMaterials', () => {
  const mats = createDragonMaterials({ sunDir: new THREE.Vector3(0, 1, 0), prepare: () => {} });
  it('provides every material the GLB names', () => {
    for (const n of ['skin', 'membrane', 'eye', 'mouth', 'teeth', 'claw', 'prosthetic', 'leather', 'metal']) {
      expect(mats.byName(n), n).toBeDefined();
    }
  });
  it('patches the skin and eye shaders through compile hooks', () => {
    for (const [m, key] of [[mats.skin, 'dragonskin'], [mats.eye, 'dragoneye']] as const) {
      expect(m.customProgramCacheKey()).toContain(key);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as any;
      m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain(key === 'dragonskin' ? 'berkScaleHeight' : 'berkEyeIris');
    }
  });
  it('adds its hooks after the app pipeline, so a CSM-style onBeforeCompile overwrite cannot drop them', () => {
    const csm = (shader: { fragmentShader: string }) => { shader.fragmentShader += '\n// csm'; };
    const m2 = createDragonMaterials({ sunDir: new THREE.Vector3(), prepare: (m) => { m.onBeforeCompile = csm as never; } });
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as any;
    m2.skin.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('// csm');
    expect(shader.fragmentShader).toContain('berkScaleHeight');
    expect(shader.vertexShader).toContain('attribute vec3 _mask');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/characters` → modules not found.

- [ ] **Step 3: Implement rigMeta.ts**
```ts
export type Vec3 = [number, number, number];
export type LimbKey = 'front_L' | 'front_R' | 'hind_L' | 'hind_R';
export interface RigBone { name: string; parent: string | null; head: Vec3; tail: Vec3; length: number; xAxis: Vec3 }
export interface RigLimb { bones: string[]; pole: Vec3; limitsDeg: Record<string, [number, number]> }
export interface RigContact { bone: string; sole: Vec3; toe: Vec3; heel: Vec3 }
export interface RigProxy { name: string; bone: string; center: Vec3; radius: number }
export interface RigAnchor { bone: string; position: Vec3 }
export interface RigWing { humerus: string; forearm: string; thumb: string; ribs: [string, string][]; hipRibs: string[]; finRibs: string[] }
export interface RigMeta {
  version: 1;
  units: 'm';
  bones: RigBone[];
  chains: { spine: string[]; neck: string[]; tail: string[] };
  limbs: Record<LimbKey, RigLimb>;
  contacts: Record<LimbKey, RigContact>;
  proxies: RigProxy[];
  anchors: Record<string, RigAnchor>;
  jaw: { bone: string; openSign: 1 | -1; maxOpenRad: number };
  chainLimitsDeg: Record<'spine' | 'neck' | 'tail', { pitch: number; yaw: number; roll: number }>;
  wings: Record<'L' | 'R', RigWing>;
  ears: Record<'L' | 'R', string[]>;
  morphs: string[];
  clips: string[];
  proportions: { length: number; wingspan: number; shoulderHeight: number; hipHeight: number; headTop: number };
}

const LIMBS: LimbKey[] = ['front_L', 'front_R', 'hind_L', 'hind_R'];

export function validateRig(raw: unknown): RigMeta {
  const r = raw as RigMeta;
  if (!r || r.version !== 1) throw new Error(`rig.json: unsupported version ${(r as { version?: unknown })?.version}`);
  const names = new Set(r.bones.map((b) => b.name));
  const need = (where: string, bone: string) => {
    if (!names.has(bone)) throw new Error(`rig.json: ${where} references missing bone '${bone}'`);
  };
  for (const [k, chain] of Object.entries(r.chains)) chain.forEach((b) => need(`chain ${k}`, b));
  for (const k of LIMBS) {
    if (!r.limbs[k]) throw new Error(`rig.json: missing limb ${k}`);
    r.limbs[k].bones.forEach((b) => need(`limb ${k}`, b));
    need(`contact ${k}`, r.contacts[k].bone);
  }
  r.proxies.forEach((p) => need(`proxy ${p.name}`, p.bone));
  for (const [k, a] of Object.entries(r.anchors)) need(`anchor ${k}`, a.bone);
  need('jaw', r.jaw.bone);
  for (const side of ['L', 'R'] as const) {
    const w = r.wings[side];
    [w.humerus, w.forearm, w.thumb, ...w.ribs.flat(), ...w.hipRibs, ...w.finRibs].forEach((b) => need(`wing ${side}`, b));
    r.ears[side].forEach((b) => need(`ear ${side}`, b));
  }
  return r;
}
```

- [ ] **Step 4: Implement materials.ts** (film-look shaders; all hooks via `addCompileHook`, added **after** `opts.prepare(m)`):
```ts
import * as THREE from 'three';
import { addCompileHook } from '../../render/materials';

export interface DragonMaterials {
  skin: THREE.MeshPhysicalMaterial;
  membrane: THREE.MeshPhysicalMaterial;
  eye: THREE.MeshPhysicalMaterial;
  mouth: THREE.MeshStandardMaterial;
  teeth: THREE.MeshStandardMaterial;
  claw: THREE.MeshStandardMaterial;
  prosthetic: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  byName(name: string): THREE.Material | undefined;
  uniforms: {
    rimColor: { value: THREE.Color }; rimStrength: { value: number }; scaleBump: { value: number };
    plasmaGlow: { value: number }; pupil: { value: number }; eyeGlow: { value: number }; irisDepth: { value: number };
    sunDir: { value: THREE.Vector3 };
  };
}

/** Scale height (0..1) from bind-pose position, triplanar; cellular "overlapping scales" at ~2.6 cm. */
const SCALE_GLSL = /* glsl */ `
  vec2 berkHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float berkCell(vec2 p) {
    vec2 i = floor(p), f = fract(p); float d = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y)); vec2 o = berkHash2(i + g) * 0.8 + 0.1;
      vec2 r = g + o - f; r.y *= 1.35; d = min(d, dot(r, r));
    }
    return 1.0 - smoothstep(0.0, 0.42, sqrt(d));
  }
  float berkScaleHeight(vec3 p, vec3 n, float freq) {
    vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
    float h = w.x * berkCell(p.yz * freq) + w.y * berkCell(p.zx * freq) + w.z * berkCell(p.xy * freq);
    float h2 = w.x * berkCell(p.yz * freq * 2.3 + 7.0) + w.y * berkCell(p.zx * freq * 2.3 + 7.0) + w.z * berkCell(p.xy * freq * 2.3 + 7.0);
    return h * 0.75 + h2 * 0.25;
  }`;

function skinHook(m: THREE.Material, u: DragonMaterials['uniforms'], freq: number, isMembrane: boolean): void {
  addCompileHook(m, isMembrane ? 'dragonskin-membrane' : 'dragonskin', (shader) => {
    shader.uniforms.berkRimColor = u.rimColor;
    shader.uniforms.berkRimStrength = u.rimStrength;
    shader.uniforms.berkScaleBump = u.scaleBump;
    shader.uniforms.berkPlasmaGlow = u.plasmaGlow;
    shader.uniforms.berkSunDirW = u.sunDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 _mask;\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBerkMask = _mask; vBerkBindPos = position; vBerkBindNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBerkMask;\nvarying vec3 vBerkBindPos;\nvarying vec3 vBerkBindNrm;\nuniform vec3 berkRimColor;\nuniform float berkRimStrength;\nuniform float berkScaleBump;\nuniform float berkPlasmaGlow;\nuniform vec3 berkSunDirW;\n${SCALE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // _mask: x = baked AO, y = underside, z = dorsal spikes (smoother, glossier plates)
        float berkH = berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), ${freq.toFixed(1)}) * (1.0 - 0.7 * vBerkMask.z);
        diffuseColor.rgb *= mix(0.86, 1.1, berkH);
        diffuseColor.rgb *= mix(vec3(0.95, 0.96, 1.0), vec3(1.04, 1.0, 1.1), berkScaleHeight(vBerkBindPos, normalize(vBerkBindNrm), 2.5));   // broad blue-purple variation
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3(0.006, 0.008, 0.014), vBerkMask.y * ${isMembrane ? '0.0' : '0.6'});`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.08, 0.82, berkH) * mix(1.0, 0.85, vBerkMask.z);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhdx = dFdx(berkH), dhdy = dFdy(berkH);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1) * faceDirection;
          vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
          normal = normalize(abs(det) * normal - grad * berkScaleBump);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.25, 0.55, 1.6) * vBerkMask.z * berkPlasmaGlow;')   // dorsal plates glow during plasma charge
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float berkAO = mix(1.0, vBerkMask.x, 0.85);
          reflectedLight.indirectDiffuse *= berkAO;
          reflectedLight.indirectSpecular *= berkAO;
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(dot(normal, V)), 3.0);
          vec3 sunV = normalize((viewMatrix * vec4(berkSunDirW, 0.0)).xyz);
          float facing = saturate(dot(normal, sunV) * 0.5 + 0.6);
          reflectedLight.directSpecular += berkRimColor * fres * facing * berkRimStrength * berkAO;
          ${isMembrane ? 'reflectedLight.indirectDiffuse += vec3(0.05, 0.028, 0.02) * saturate(dot(-normal, sunV));' : ''}
        }`);
  });
}

function eyeHook(m: THREE.Material, u: DragonMaterials['uniforms']): void {
  addCompileHook(m, 'dragoneye', (shader) => {
    shader.uniforms.berkPupil = u.pupil;
    shader.uniforms.berkEyeGlow = u.eyeGlow;
    shader.uniforms.berkIrisDepth = u.irisDepth;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float berkPupil;\nuniform float berkEyeGlow;\nuniform float berkIrisDepth;\nvec3 berkEyeIris; float berkEyeIrisMask;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // parallax: the iris sits behind the cornea, so shift its lookup against the view direction (cotangent frame)
          vec3 eN = normalize(vNormal);
          vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
          vec2 duv1 = dFdx(vUv), duv2 = dFdy(vUv);
          vec3 dp2perp = cross(dp2, eN), dp1perp = cross(eN, dp1);
          vec3 eT = dp2perp * duv1.x + dp1perp * duv2.x;
          vec3 eB = dp2perp * duv1.y + dp1perp * duv2.y;
          float invmax = inversesqrt(max(max(dot(eT, eT), dot(eB, eB)), 1e-12));
          vec3 vTs = normalize(transpose(mat3(eT * invmax, eB * invmax, eN)) * normalize(vViewPosition));
          vec2 uvP = vUv - vTs.xy / max(vTs.z, 0.3) * berkIrisDepth;
          vec2 e = uvP * 2.0 - 1.0;
          // Blender wrote v = -1 on the back hemisphere; the glTF export flips V (v' = 1 - v), so it arrives as 2
          if (vUv.y < -0.01 || vUv.y > 1.01) { diffuseColor.rgb = vec3(0.02); berkEyeIrisMask = 0.0; berkEyeIris = vec3(0.0); }
          else {
            float r = length(e);
            float pw = mix(0.08, 0.5, berkPupil);
            float pupil = 1.0 - smoothstep(0.92, 1.0, length(vec2(e.x / pw, e.y / 0.68)));
            float iris = 1.0 - smoothstep(0.93, 0.99, r);
            vec3 irisCol = mix(vec3(0.46, 0.78, 0.12), vec3(0.93, 0.9, 0.36), 1.0 - smoothstep(0.1, 0.72, r));
            irisCol *= 0.82 + 0.18 * sin(atan(e.y, e.x) * 38.0) * smoothstep(0.25, 0.8, r);
            irisCol = mix(irisCol, vec3(0.07, 0.14, 0.04), smoothstep(0.8, 0.97, r));
            berkEyeIris = irisCol;
            berkEyeIrisMask = iris * (1.0 - pupil);
            vec3 col = mix(vec3(0.06, 0.08, 0.05), irisCol, iris);
            diffuseColor.rgb = mix(col, vec3(0.004), pupil);
          }
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += berkEyeIris * berkEyeIrisMask * berkEyeGlow;');
  });
}

export function createDragonMaterials(opts: { sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void }): DragonMaterials {
  const uniforms = {
    rimColor: { value: new THREE.Color(0.55, 0.68, 0.95) }, rimStrength: { value: 0.35 }, scaleBump: { value: 0.003 }, // bump height, metres (tune in the viewer)
    plasmaGlow: { value: 0 }, pupil: { value: 0.15 }, eyeGlow: { value: 0.35 }, irisDepth: { value: 0.08 }, sunDir: { value: opts.sunDir },
  };
  const skin = new THREE.MeshPhysicalMaterial({
    name: 'skin', color: 0x15171d, roughness: 0.55, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5,
    sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x35507a),
  });
  const membrane = new THREE.MeshPhysicalMaterial({
    name: 'membrane', color: 0x1b1e26, roughness: 0.62, metalness: 0, sheen: 0.3, sheenColor: new THREE.Color(0x2a3550), side: THREE.DoubleSide,
  });
  const eye = new THREE.MeshPhysicalMaterial({ name: 'eye', color: 0xffffff, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x000000 });
  eye.defines = { ...(eye.defines ?? {}), USE_UV: '' };
  const std = (name: string, color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ name, color, roughness, ...extra });
  const mats = {
    skin, membrane, eye,
    mouth: std('mouth', 0x9c4450, 0.38),
    teeth: std('teeth', 0xf1ede2, 0.3),
    claw: std('claw', 0xd9d0c0, 0.42),
    prosthetic: std('prosthetic', 0x8e1d13, 0.68, { side: THREE.DoubleSide }),
    leather: std('leather', 0x5a3a22, 0.78),
    metal: std('metal', 0x8d9096, 0.35, { metalness: 0.9 }),
  };
  for (const m of Object.values(mats)) opts.prepare(m);    // CSM + fog first (CSM overwrites onBeforeCompile)
  skinHook(skin, uniforms, 38, false);
  skinHook(membrane, uniforms, 52, true);
  eyeHook(eye, uniforms);
  const byNameMap = new Map<string, THREE.Material>(Object.entries(mats));
  return { ...mats, byName: (n) => byNameMap.get(n), uniforms };
}
```

- [ ] **Step 5: Implement asset.ts**
```ts
import * as THREE from 'three';
import { createGltfLoader } from '../../render/loaders';
import { validateRig, type RigMeta } from './rigMeta';
import { createDragonMaterials, type DragonMaterials } from './materials';

export interface DragonAsset {
  root: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  rig: RigMeta;
  clips: Map<string, THREE.AnimationClip>;
  morphNames: string[];
  setMorph(name: string, weight: number): void;
  materials: DragonMaterials;
}

export async function loadDragonAsset(opts: {
  glbUrl: string; posesUrl: string; rigUrl: string; sunDir: THREE.Vector3; prepare: (m: THREE.Material) => void;
}): Promise<DragonAsset> {
  const loader = createGltfLoader();
  const [gltf, poses, rigRaw] = await Promise.all([
    loader.loadAsync(opts.glbUrl),
    loader.loadAsync(opts.posesUrl),
    fetch(opts.rigUrl).then((r) => r.json()),
  ]);
  const rig = validateRig(rigRaw);
  const materials = createDragonMaterials({ sunDir: opts.sunDir, prepare: opts.prepare });
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    meshes.push(m);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds don't follow the pose
    const replacement = materials.byName((m.material as THREE.Material).name);
    if (!replacement) throw new Error(`dragon asset: no engine material for '${(m.material as THREE.Material).name}'`);
    m.material = replacement;
    if (m.morphTargetInfluences) m.morphTargetInfluences.fill(0); // never trust file default weights
  });
  if (!meshes.length) throw new Error('dragon asset: no skinned meshes');
  const skeleton = meshes[0].skeleton;
  const bones = new Map(skeleton.bones.map((b) => [b.name, b]));
  for (const b of rig.bones) if (!bones.has(b.name)) throw new Error(`dragon asset: GLB lacks bone '${b.name}'`);
  const morphNames = Object.keys(meshes[0].morphTargetDictionary ?? {});
  return {
    root: gltf.scene,
    meshes,
    skeleton,
    bones,
    rig,
    clips: new Map(poses.animations.map((c) => [c.name, c])),   // tracks bind to bones by name
    morphNames,
    setMorph(name, weight) {
      for (const m of meshes) {
        const i = m.morphTargetDictionary?.[name];
        if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = weight;
      }
    },
    materials,
  };
}
```

- [ ] **Step 6: Viewer integration** (`src/dev/viewer/main.ts`, from Plan 1 Task 9)

1. Split the existing `load(url)` into `load(url)` = `loader.loadAsync(url)` + `show(gltf.scene, gltf.animations)`. `show(root, animations, opts = { morphUi: true })` holds everything `load` did after the fetch. Behaviour for `?asset=<url>` is unchanged.
2. Add a character path for `?char=toothless`, before the existing `assetUrl` branch:
```ts
import { loadDragonAsset, type DragonAsset } from '../../characters/dragon/asset';

async function loadToothless(): Promise<DragonAsset> {
  const asset = await loadDragonAsset({
    glbUrl: 'assets/characters/toothless/toothless.glb',
    posesUrl: 'assets/characters/toothless/toothless.poses.glb',
    rigUrl: 'assets/characters/toothless/toothless.rig.json',
    sunDir: app.lighting.sunDir,
    prepare: (m) => app.materials.prepare(m),
  });
  show(asset.root, [...asset.clips.values()], { morphUi: false });   // one slider per morph, not per primitive
  playClip('bind');
  const face = gui.addFolder('Face');
  const weights: Record<string, number> = Object.fromEntries(asset.morphNames.map((n) => [n, 0]));
  for (const n of asset.morphNames) face.add(weights, n, 0, 1, 0.01).onChange((w: number) => asset.setMorph(n, w));
  const u = asset.materials.uniforms;
  const eyes = gui.addFolder('Eyes');
  eyes.add(u.pupil, 'value', 0, 1, 0.01).name('pupil');
  eyes.add(u.eyeGlow, 'value', 0, 1, 0.01).name('glow');
  eyes.add(u.irisDepth, 'value', 0, 0.2, 0.005).name('iris depth');
  const skin = gui.addFolder('Skin');
  skin.add(u.rimStrength, 'value', 0, 1.5, 0.01).name('rim');
  skin.add(u.scaleBump, 'value', 0, 0.02, 0.0005).name('scale bump (m)');
  skin.add(u.plasmaGlow, 'value', 0, 1, 0.01).name('plasma glow');
  debug.register('dragon', {
    clip: (name: string) => playClip(name),
    morph: (name: string, w: number) => asset.setMorph(name, w),
    pupil: (v: number) => { u.pupil.value = v; },
    stats: () => ({ ...stats(), morphs: asset.morphNames, bones: asset.skeleton.bones.length }),
  });
  return asset;
}

const charName = new URLSearchParams(location.search).get('char');
if (charName === 'toothless') {
  loadToothless().catch((e) => console.error('[viewer] failed to load Toothless', e));
}
```
   The existing `assetUrl` / test-scene branch becomes the `else`. The HUD text shows `char:toothless` when that param is set.

- [ ] **Step 7: Tests, typecheck, visual verification**
- `npm test` all pass; `npm run typecheck` clean.
- Dev server → `http://localhost:5190/viewer.html?char=toothless&q=high`: console clean; screenshots saved to `docs/progress/img/toothless/viewer_hero.png`, `viewer_face.png` (face close-up: slit pupils, glossy eyes, visible fine scales, rim light on the silhouette), `viewer_folded.png` (`berk.dragon.clip('wings_folded')`), `viewer_snarl.png` (`clip('jaw_open')`, morphs `teeth_out` 1, `snarl` 1).
- Acceptance: reads as Toothless in the film look — near-black skin with a cool rim and subtle scale texture, acid-green slit-pupil eyes, pink mouth, pale claws, red prosthetic fin, brown saddle.

- [ ] **Step 8: Progress log + commit** — add an "M2–M4 Toothless asset" entry to `docs/progress/phase1.md` (renders, triangle count, GLB size, notable decisions: procedural skin instead of UV bakes, 90 k budget). Commit (`feat(dragon): rig metadata, film-look materials, asset loader and viewer`).

---

### Task 9: Look pass — film silhouette, open eyes, blink in-betweens

Added by controller Ruling 9 after the Task 3 self-review. The model met the Task 3 criteria, but against the film:
- the torso is bulbous rather than panther-like
- the big ear plates stand upright instead of sweeping back
- the smaller plates read as side horns
- the heavy neutral lids read sleepy
- the lip line reads frog-wide
- a linear 100° blink morph cuts the lid through the eyeball mid-blink

Toothless is near-black in the film look, so the silhouette and the eyes carry the character. Judge the result in the engine viewer with the real materials, not only in clay.

**Files:**
- Modify: `pipeline/blender/toothless/sculpt.py` (volumes), `pipeline/blender/toothless/parts.py` (lid opening, blink in-betweens, ear plate shapes), `pipeline/blender/toothless/anatomy.py` (`EARS_L` angles only, plus `JAW_REST_CLOSE_RAD`), `pipeline/blender/toothless/export.py` (rig.json `jaw.restCloseRad`, `blink` map), `pipeline/blender/tests/test_parts.py` (new), `src/characters/dragon/asset.ts` (`setBlink`, rest jaw), `src/characters/dragon/rigMeta.ts` (types), `src/dev/viewer/main.ts` (blink sliders), `tests/characters/rigMeta.test.ts`, `tests/assets/toothless.test.ts`
- Output: re-exported `public/assets/characters/toothless/*`, new `docs/progress/img/toothless/look_*.png`

**Interfaces:**
- Produces:
  - Morphs `blink_L_a`, `blink_L_b`, `blink_R_a`, `blink_R_b` (1/3 and 2/3 of the full blink), alongside `blink_L`, `blink_R`.
  - rig.json `blink: { L: ["blink_L_a", "blink_L_b", "blink_L"], R: [...] }` and `jaw.restCloseRad`.
  - `DragonAsset.setBlink(side: 'L' | 'R', w: number)`: a piecewise-linear mapping over the three keys.
  - `anatomy.JAW_REST_CLOSE_RAD`.
- Cross-plan: Plan 3's `tests/fixtures/toothlessRig.ts` mirrors every bone head/tail/xAxis and `LIMB_LIMITS`; if `EARS_L` changes here, update that fixture's ear angles in the same commit, or Plan 3's exported-rig test fails.
- Contract change (ruling): the look pass may change `EARS_L` pitch/yaw/roll, which moves the six ear bones' rest orientation. Bone names, hierarchy and every body joint stay locked, and `rig.json` is re-exported.

- [ ] **Step 1: Blink in-betweens with a no-penetration test**

`pipeline/blender/tests/test_parts.py`:
```python
import unittest
import bpy
from mathutils import Vector
import anatomy as A
import scene as SC
import rig as R
import parts as P


def piecewise(w):
    """Blink weight w in [0, 1] -> weights of (key_a at 1/3, key_b at 2/3, key_full)."""
    if w <= 1 / 3:
        return (3 * w, 0.0, 0.0)
    if w <= 2 / 3:
        return (2 - 3 * w, 3 * w - 1, 0.0)
    return (0.0, 3 - 3 * w, 3 * w - 2)


class LidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SC.reset()
        cls.rig = R.build_armature()
        mat = bpy.data.materials.new("skin")
        cls.lids = P.make_lids(cls.rig, mat)

    def test_blink_path_never_cuts_deeper_than_rest(self):
        for lid in self.lids:
            side = 1 if lid.name.endswith("_L") else -1
            c = Vector((A.EYE_CENTER_L[0] * side, A.EYE_CENTER_L[1], A.EYE_CENTER_L[2]))
            kb = lid.data.shape_keys.key_blocks
            sfx = "L" if side > 0 else "R"
            basis, ka, kb_, kf = kb["Basis"], kb[f"blink_{sfx}_a"], kb[f"blink_{sfx}_b"], kb[f"blink_{sfx}"]
            rest_min = min((v.co - c).length for v in basis.data)
            for step in range(21):
                wa, wb, wf = piecewise(step / 20)
                worst = min(((basis.data[i].co + wa * (ka.data[i].co - basis.data[i].co) + wb * (kb_.data[i].co - basis.data[i].co)
                              + wf * (kf.data[i].co - basis.data[i].co)) - c).length for i in range(len(basis.data)))
                self.assertGreaterEqual(worst, rest_min - 0.001, (lid.name, step))

    def test_piecewise_weights_are_continuous_and_normalised(self):
        prev = piecewise(0.0)
        for step in range(1, 301):
            cur = piecewise(step / 300)
            self.assertLessEqual(max(abs(a - b) for a, b in zip(cur, prev)), 0.011)
            self.assertLessEqual(sum(cur), 1.0 + 1e-9)
            prev = cur
        self.assertEqual(piecewise(1.0), (0.0, 0.0, 1.0))


if __name__ == "__main__":
    unittest.main()
```
In `parts.make_lids`, create `blink_<side>_a` and `blink_<side>_b` by applying 1/3 and 2/3 of the full lid rotation, and the same fractions of the corner correction. Rotate about the same axis. Do not linearly interpolate the full key. Zero every key at creation. Run the suite: the new tests fail until the keys exist, then pass.

- [ ] **Step 2: Open the neutral eyes**

Toothless's calm, curious neutral shows most of the iris: the upper lid is a thin dark rim over its top edge, and the lower lid barely shows. Sleepy is a partial blink the engine plays, not the rest shape.
- Raise the upper lid's rest edge (`open_edge_deg`) and lower the lower lid's rest edge until, in the face render, the upper lid covers at most ~15 % of the iris height and the lower lid at most ~8 %.
- Recompute the blink travel so the lids still meet fully closed, corners included.
- Keep squint at a small narrowing from the new rest.

- [ ] **Step 3: Silhouette and head (sculpt volumes; the body joints stay where they are)**

Check each change against the references below.
- `C:\Users\zacle\dragon-walk\tools\ref_official.png`, `ref_face.png`, `ref_dtv.png`, `ref_9999.png`
- `C:\Users\zacle\Pictures\Screenshots\Screenshot 2026-06-12 155329.png` (side spread), `155348` (top), `155402` (side), `155430` (three-quarter), `155447` (head close-up)

Targets:
- **Torso:** panther-like. A deep but narrower chest, a visible waist tuck behind the ribcage, and a rump that isn't ball-shaped. Keep the chest depth; reduce the side-to-side bulge of the belly and hip ellipsoids.
- **Legs:** short and powerful, with thicker forearms and shins toward big paws (not thin lower legs under bulging thighs).
- **Head:** broad and a little flatter on top than tall, with a rounded snout. The lip line closes shorter at the corners (less frog gape). Brows are soft with no frown.
- **Ears:** the two big plates sweep back along the skull at roughly 25–35° above the neck line (`EARS_L` ear_1 pitch ~62° → ~30°). The two smaller pairs follow the same sweep, tucked behind and below the big pair — no sideways horns.
- **Dorsal spikes:** crisp small plates. If the 24k-face mesh cannot hold them, they may become separate plate meshes weighted to the spine/tail bones. They then join the `_MASK` dorsal channel by vertex position.
- **Jaw rest:** measure the lip gap at rest. Set `anatomy.JAW_REST_CLOSE_RAD`, the closing rotation that makes the lips meet (about the gap divided by the jaw length; close = the opposite sign of `JAW_OPEN_SIGN`). Export it as `rig.json` `jaw.restCloseRad`. `loadDragonAsset` applies it to the jaw bone at rest, so the neutral mouth shows no pink line.

- [ ] **Step 4: Re-run the whole pipeline and every QA gate**

Run: `npm run toothless:build`, `npm run blender:test`, `npm test`. All pass; do not loosen any bound. The wing attach, saddle drape and deformation renders are re-checked, because the torso changed. Then check the new renders:
- clay renders `look_hero`, `look_face`, `look_side_vs_ref`, `look_three_quarter_vs_ref` (composited with `155430`)
- the engine viewer screenshots `look_viewer_hero`, `look_viewer_face` (blink 0 / 0.5 / 1 via `setBlink`), `look_viewer_folded`

- [ ] **Step 5: Engine blink API + viewer**

- `asset.ts`: `setBlink(side, w)` uses the three keys from `rig.blink[side]` with the piecewise mapping above, clamping w to [0, 1]. Apply `rig.jaw.restCloseRad` to the jaw bone's rest rotation after load.
- The viewer's Eyes folder gains "blink L" and "blink R" sliders.
- vitest:
  - rig.json has the blink map and `restCloseRad`, and every listed morph exists in the GLB.
  - `setBlink` maps 0 / 0.5 / 1 to key weights (0,0,0) / (0.5,0.5,0) / (0,0,1).

- [ ] **Step 6: Self-check against the references, then commit**

Write a short verdict per target (torso, legs, head, ears, eyes, spikes, mouth) with the render that shows it. Commit: `feat(toothless): look pass — panther silhouette, open eyes, swept ears, blink in-betweens`.

---

## Self-Review

- **Spec coverage (§5):**
  - 5.1 proportions → Task 2 tests (locked skeleton).
  - 5.2 pipeline steps → Tasks 1 and 3–7. The UV/bake steps are replaced by procedural shading plus ray-traced vertex AO, per the prototype README's texturing decision and the Global Constraints.
  - 5.3 parts → Tasks 3–5, adding a tongue.
  - 5.4 fan-fold wings and pleat → Task 4.
  - 5.5 skeleton (~100 bones) and metadata → Task 2 + `rig.json`: poles, limits, contacts, proxies, anchors, per-bone hinge axis `xAxis`.
  - 5.6 skinning → Task 6.
  - 5.7 face keys, eyes, teeth → Tasks 3, 6 and 8.
  - 5.8 materials → Task 8.
  - 5.9 budgets → Global Constraints + asset tests. LOD1/LOD2 are deferred to Phase 5, where NPC dragons need them.
  - 5.10 export + `rig.json` → Task 7.
  - 5.11 pose-library scaffold → Task 7; the full library belongs to the motion plan (M6).
  - 5.12 QA → Tasks 3–6: renders plus numeric checks (fold extents, saddle fit, weight continuity, heat-weight canary).
- **Placeholder scan:** no TBDs. Visual-iteration steps name concrete acceptance criteria and forbid loosening the numeric bounds.
- **Type consistency:**
  - `DragonMaterials`, `RigMeta` (including `xAxis`) and the `loadDragonAsset` options agree across Task 8.
  - The `rig.json` keys written in Task 7 match `RigMeta`.
  - `_MASK` is a vec3 everywhere: Blender FLOAT_VECTOR → glTF `_MASK` → three `_mask` → `attribute vec3 _mask`.
  - Stage order is fixed: model → wings → tack → assemble → export, each opening the previous stage's `.blend`.
