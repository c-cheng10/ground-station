window.TREND_CONFIG = {
  "startYear": 1981,
  "endYear": 2025,
  "baselineStart": 1991,
  "baselineEnd": 2020,
  "sourceUrl": "https://power.larc.nasa.gov/docs/services/api/temporal/monthly/",
  "methodUrl": "https://www.nber.org/papers/t0055",
  "variables": [
    {
      "id": "T2M",
      "name": "Air temperature",
      "unit": "°C",
      "trendUnit": "°C",
      "description": "Temperature of the air two metres above the surface.",
      "decimals": 2
    },
    {
      "id": "TS",
      "name": "Surface temperature",
      "unit": "°C",
      "trendUnit": "°C",
      "description": "Temperature at the ground or water surface.",
      "decimals": 2
    },
    {
      "id": "PRECTOTCORR",
      "name": "Precipitation",
      "unit": "mm/day",
      "trendUnit": "mm/day",
      "description": "Average daily water from rain and snow, adjusted using observations.",
      "decimals": 2
    },
    {
      "id": "QV2M",
      "name": "Specific humidity",
      "unit": "g/kg",
      "trendUnit": "g/kg",
      "description": "Grams of water vapour per kilogram of near-surface air.",
      "decimals": 2
    },
    {
      "id": "RH2M",
      "name": "Relative humidity",
      "unit": "%",
      "trendUnit": "pp",
      "description": "Near-surface water vapour as a percentage of saturation at that temperature.",
      "decimals": 2
    },
    {
      "id": "GWETROOT",
      "name": "Root-zone soil wetness",
      "unit": "%",
      "trendUnit": "pp",
      "description": "How close the top metre of soil is to saturation.",
      "decimals": 2
    },
    {
      "id": "EVLAND",
      "name": "Land evapotranspiration",
      "unit": "mm/day",
      "trendUnit": "mm/day",
      "description": "Average daily water returned to the air from land, including evaporation and water released by plants.",
      "decimals": 2
    },
    {
      "id": "WS10M",
      "name": "Wind speed",
      "unit": "m/s",
      "trendUnit": "m/s",
      "description": "Wind speed ten metres above the surface.",
      "decimals": 2
    }
  ],
  "sites": [
    {
      "id": "southern-ontario",
      "name": "Southern Ontario",
      "region": "Canada",
      "continent": "North America",
      "latitude": 44,
      "longitude": -80.625,
      "bounds": {
        "south": 43.25,
        "north": 44.75,
        "west": -81.5625,
        "east": -79.6875
      },
      "cellCount": 9
    },
    {
      "id": "great-plains",
      "name": "Central Great Plains",
      "region": "United States",
      "continent": "North America",
      "latitude": 38.5,
      "longitude": -100,
      "bounds": {
        "south": 37.75,
        "north": 39.25,
        "west": -100.9375,
        "east": -99.0625
      },
      "cellCount": 9
    },
    {
      "id": "mexican-plateau",
      "name": "Mexican Plateau",
      "region": "Mexico",
      "continent": "North America",
      "latitude": 23,
      "longitude": -102.5,
      "bounds": {
        "south": 22.25,
        "north": 23.75,
        "west": -103.4375,
        "east": -101.5625
      },
      "cellCount": 9
    },
    {
      "id": "central-amazon",
      "name": "Central Amazon",
      "region": "Brazil",
      "continent": "South America",
      "latitude": -3,
      "longitude": -60,
      "bounds": {
        "south": -3.75,
        "north": -2.25,
        "west": -60.9375,
        "east": -59.0625
      },
      "cellCount": 9
    },
    {
      "id": "cerrado",
      "name": "Cerrado",
      "region": "Brazil",
      "continent": "South America",
      "latitude": -15.5,
      "longitude": -47.5,
      "bounds": {
        "south": -16.25,
        "north": -14.75,
        "west": -48.4375,
        "east": -46.5625
      },
      "cellCount": 9
    },
    {
      "id": "patagonian-steppe",
      "name": "Patagonian Steppe",
      "region": "Argentina",
      "continent": "South America",
      "latitude": -49.5,
      "longitude": -70.625,
      "bounds": {
        "south": -50.25,
        "north": -48.75,
        "west": -71.5625,
        "east": -69.6875
      },
      "cellCount": 9
    }
  ]
};
