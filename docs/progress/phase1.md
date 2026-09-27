# Phase 1 progress log

## M1 — Foundation (2026-09-27)

![hero](img/m1-hero.png) ![wide](img/m1-wide.png)
![lab](img/m1-lab.png) ![viewer](img/m1-viewer.png)

Additional captures: ![low camera](img/m1-low.png) ![low quality](img/m1-q-low.png) ![lab filmstrip](img/m1-lab-filmstrip.png) ![ground texture](img/m1-ground.png)

- Pages: game `/`, Motion Lab `/lab.html`, Asset Viewer `/viewer.html` — all render the lit test scene, in dev (`npm run dev`, :5190) and in the production build (`npm run build` → served on :8750 via `tools/serve-dist.ps1`); console clean on every page (the only console item anywhere is a benign lil-gui third-party accessibility lint, "A form field element should have an id or name attribute", on `/lab.html` and `/viewer.html` — not a JS error or warning).
- Render stack: CSM (4 cascades on High / 2 on Low) · Preetham sky + clouds → PMREM IBL · Berk height fog · N8AO · bloom · AgX tone mapping · grade LUT.
- Tuned values (all committed in Task 8): exposure 1.8 (was 1.0), sky exposure 0.15 (was 0.5), fog density 0.0035 (unchanged; colours refit — `color` (0.15, 0.17, 0.2), `sunColor` (1.4, 0.78, 0.53), `inscatterExponent` 5, was 6), sun intensity 3.0 (unchanged).
- MSAA + N8AO decision: **kept MSAA 4× on High** — zoomed crops of edges (cube/ground, block/sky, swatch row, far blocks) showed clean anti-aliasing with no AO/MSAA halos. Low runs `msaaSamples: 0` and gets SMAA instead, per the post-order rule ("SMAA only when MSAA is off").
- Perf (`berk.perf(30)`, via the `gpuFence` 1-pixel readback — `gl.finish()` alone reports flush time, not render time, on Chrome's command-buffer WebGL): on `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)` — High/hero ≈ 30.6–32.0 ms/frame (31.96, 30.74, 30.63; 117 calls, 25,304 tris) · Low/hero ≈ 3.01–3.15 ms/frame (3.09, 3.15, 3.10; 79 calls, 14,854 tris).
- CC0 pipeline (Poly Haven, `pipeline/cc0/`): `forest_ground_04` — 2k source textures (diff/nor/arm), processed to 1024×1024 WebP (diff 429,064 B, nor 700,508 B, arm 275,628 B) and wired into the test-scene ground material. `rock_moss_set_01` — 1k glTF, fetched and credited in `CREDITS.md`/`manifest.json`, cached but not yet placed in a scene (no `install` entry).

### Rulings and notes

- **Ruling 4 (GPU preference):** no GPU-preference change and no KTX2 install were made without the user's OK. Chrome is still rendering on the integrated Intel Iris Xe, so every High-preset performance number above is provisional until Chrome is run on the RTX 3080 Ti — the user can switch this in Windows Settings > System > Display > Graphics.
- **Ruling 1 (branch):** all M1 work happened on branch `phase1-slice` (off `main`); `main` was never touched.
- Known cosmetic issue: the 400 m test ground plane's far edge reads as a soft-contrast line at the horizon, on the side away from the sun (see Task 8's sky checklist). It's a finite-plane artifact of the M1 look-dev test scene, not the render stack; the Cove's real terrain and sea horizon will need their own check later.
- The launcher (`tools/launch-game.bat` / `tools/serve-dist.ps1`, serving `dist/` on :8750) is built but **not wired to the desktop shortcut yet** — that happens at M8.
