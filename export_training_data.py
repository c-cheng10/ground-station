"""Export one native NASA POWER grid-cell/month CSV per configured region.

Climate columns retain NASA's units, including GWETROOT as a saturation
fraction from 0 to 1.
"""

import csv
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory
from pathlib import Path

from build_trends import ROOT, download_cell, read_config, site_cells


def main():
    config = read_config()
    variables = config["variables"]
    years = range(config["startYear"], config["endYear"] + 1)
    months = [f"{year}{month:02d}" for year in years for month in range(1, 13)]
    columns = ["region_id", "cell_id", "lat", "lon", "yyyymm"]
    columns.extend(variable["id"].lower() for variable in variables)

    with TemporaryDirectory(dir=ROOT) as staging, ThreadPoolExecutor(max_workers=3) as pool:
        paths = []
        seen_cells = set()
        for site in config["sites"]:
            cells = site_cells(site)
            records = pool.map(lambda cell: download_cell(cell, variables, years, months), cells)
            path = Path(staging) / f"{site['id']}.csv"
            paths.append(path)
            with path.open("w", newline="", encoding="utf-8") as output:
                writer = csv.writer(output, lineterminator="\n")
                writer.writerow(columns)
                for (lat, lon), readings in zip(cells, records):
                    cell_id = f"{lat:.3f},{lon:.3f}"
                    if cell_id in seen_cells:
                        raise ValueError(f"Grid cell {cell_id} belongs to multiple regions")
                    seen_cells.add(cell_id)
                    for month, values in zip(months, zip(*readings)):
                        writer.writerow([site["id"], cell_id, lat, lon, month, *values])

        destination = ROOT / "training-data"
        destination.mkdir(exist_ok=True)
        for path in paths:
            path.replace(destination / path.name)
            print(f"{path.name}: {len(months)} months per grid cell")


if __name__ == "__main__":
    main()
