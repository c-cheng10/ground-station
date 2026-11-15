# Handoff: 3° pole-to-pole ocean and air grid

**For:** Max (or Codex on Max's machine, which has the Giovanni cache and `.env`)
**Repo:** `c-cheng10/space-apps`, start from `main` (at least commit `26a97ec`)

## Why

The Water and Air layers leave a big empty disc around Antarctica, and most of the Arctic Ocean is blank too. Both grids stop short of the poles:

- `grid()` (land) starts at 56°S. That's correct for GLDAS, which has no Antarctica.
- `ocean_grid()` uses 60°S to 70°N at 5°.

MERRA-2 and AIRS cover the whole globe. The gap hides the Antarctic ozone hole, the best story the Air layer has. The ocean is also on a coarser 5° grid than land's 3°, so the colours there look blobby.

## Goal

1. Ocean points every **3°**, using the **same lattice as land** (rows at …−57.375, −54.375…; columns at −178.375 + 3k), from about 87°S to 87°N.
2. New **polar land points** on that same lattice wherever `grid(3)` doesn't reach: Antarctica, plus land north of about 81°N. These get the atmosphere requests only, since GLDAS has nothing there.
3. Rebuild `ocean-atmosphere.js` and point the site at 3° ocean spacing.

## Size (counted from the current code, no network)

| Set | Points | Requests | Already cached |
|---|---|---|---|
| Ocean, 3°, pole to pole | 4,725 | 37,800 (8 per point) | ~145 points reuse old 5° cache entries |
| Polar land | 648 | 5,184 (8 per point) | 0 |
| **Total** | **5,373** | **~43,000** | |

That's a lot. **Check the quota first** (step 1 below). If it won't fit, use 4° spacing (roughly half the requests), or keep 5° and only extend the latitude range (about 1,000 extra requests).

## Steps

### 1. Quota check

```sh
python download_gldas.py --pilot
```

It prints quota used per point and how many more points a month's quota covers. You need about 5,400. If that's not enough, pick 4° or 5° and tell Chris.

### 2. `download_gldas.py`

- Align `ocean_grid(spacing)` with the land lattice and run it pole to pole:

  ```python
  def lattice_latitudes(spacing):
      # Same rows as grid(): offset from -56 + spacing / 2, extended to both poles.
      below, above = int(34 / spacing), int(146 / spacing)
      return [cell_centre(-56 + spacing / 2 + i * spacing) for i in range(-below, above)
              if -90 < -56 + spacing / 2 + i * spacing < 90]
  ```

  In `ocean_grid()`, use `lattice_latitudes(spacing)` for latitudes. Keep the existing longitudes, which already match land when the spacing is the same.
- Add `polar_land(spacing)`: lattice points where `on_land(...)` is true, minus `grid(spacing)`.
- Give polar land `POLAR_REQUESTS = merra_T2M, merra_QV2M, gpm_precipitation + ATMOSPHERE_REQUESTS`. GPM may answer NO DATA near the poles; the script already records that.
- Add it to `jobs` as a third group, then change the docstring and the `--ocean-spacing` default to 3.

Run it:

```sh
python download_gldas.py --spacing 3 --ocean-spacing 3 --workers 8
```

It resumes from the cache, so it's safe to stop and rerun.

### 3. `import_ocean_atmosphere.py`

- Use `ocean_grid(3)`, and add the polar land points to `extra_land`.
- **`read_point` currently raises on any missing series.** Polar points will be missing GPM and sometimes AIRS skin temperature. Treat a missing or all-NaN series as "no data": store `None` and leave that variable's trend as `null`. Don't drop the point.
- Rebuild:

  ```sh
  python import_ocean_atmosphere.py
  ```

  Then, only if the Supabase SQL from `supabase/giovanni_ocean_atmosphere.sql` has been applied:

  ```sh
  python import_ocean_atmosphere.py --upload
  ```

- `ocean-atmosphere.js` will grow from 245 KB to roughly 0.9–1 MB. That's acceptable.
- **Database size:** about 5,400 more rows of monthly arrays could add 150–200 MB. The Supabase free tier is 500 MB. Check the size in the dashboard after uploading, and skip `--upload` if it gets close. The site works from `ocean-atmosphere.js` alone.

### 4. Site code (only once the new data file exists)

- `trend-explorer.js`: change `const oceanSpacing = 5;` to `3`.
- `globe-fields.js` (`makeMeasurement`): the ocean footprint is tuned for 5° (`range 6`, sigma `2.75`). Use the land values (`3.6` / `1.65`) so ocean colours aren't over-smoothed.
- Bump `?v=` on `globe-fields.js` and `trend-explorer.js` in `index.html`.
- Update the "Land samples are spaced about 3° apart and ocean samples about 5° apart" sentence in How it works.

### 5. Check

Open the site and pick **Air → Total column ozone**:

- Antarctica should be coloured.
- The ozone hole region should show a clear trend since 1980, with recovery after about 2000. A straight-line fit over 1980–2025 may show a small or unclear slope, which is expected.
- **Water → Sea surface skin temperature** should reach the Arctic.
- The console should have no errors.
- Land-layer results should be unchanged.

## Don'ts

- Only Giovanni (a listed challenge source). Add no new data sources.
- Never commit `.env` or print keys.
- Leave the existing 1,656 land points and their IDs alone. The site and the Supabase rows depend on them.
