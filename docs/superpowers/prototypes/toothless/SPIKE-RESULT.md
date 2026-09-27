# Spike: body sculpt technique (M2 start) — RESULT (throwaway code)

Question: metaballs vs SDF for the Toothless body volume.

Answer: **SDF in numpy → OpenVDB (bundled `openvdb` module) → Blender Volume-to-Mesh (threshold 0 on −SDF density)**.
- 20.2 M voxels (1.2 cm) evaluated in 3.4 s with per-primitive AABB culling; mesh (136 k faces) in 1.4 s; 5 renders in 3.4 s.
- Smooth unions (polynomial smin with per-primitive k), subtractions (eye sockets, nostrils) all clean. Manifold output (good for heat weights).
- Metaballs not needed.

Lessons for the real build:
- Chained round cones joined with smin bulge at every joint ("beads") → join chain segments with plain min (or k≈0.01); use smin only between distinct masses.
- Thin plates (ears, fins) are under-resolved at 1.2 cm → build them as separate blade meshes on their own bones.
- Proportions from film facts (not the fan render's perspective): shoulder ~1.35 m, head big/broad (~0.6 w × 0.75 l), short thick neck, deep chest, heavy short legs, tail ≈ half total length (~7.3 m).
- `openvdb.FloatGrid(bg)`, `copyFromArray`, `createLinearTransform(voxelSize=)`, `openvdb.write(path, grids=[g])` all work in Blender 5.1.2 (a harmless "leaked Transform" message prints at exit).
