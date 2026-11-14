window.TREND_CONFIG = {
  "startYear": 1948,
  "endYear": 2025,
  "sourceUrl": "https://giovanni.gsfc.nasa.gov/giovanni/",
  "methodUrl": "https://www.nber.org/papers/t0055",
  "supabaseUrl": "https://vbumlhsonrozcrzcuirm.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidW1saHNvbnJvemNyemN1aXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzYzNjgsImV4cCI6MjExMDI1MjM2OH0.Q2TSoe9HcDGc2zs599LCj5_sdGs4-JzCYEmDL9vbuKY",
  "variables": [
    {
      "id": "T2M",
      "name": "Air temperature",
      "unit": "°C",
      "trendUnit": "°C",
      "decimals": 2,
      "description": "Temperature of the air two metres above the ground.",
      "source": "MERRA-2",
      "firstMonth": 384,
      "lastMonth": 935
    },
    {
      "id": "TS",
      "name": "Surface temperature",
      "unit": "°C",
      "trendUnit": "°C",
      "decimals": 2,
      "description": "Temperature of the ground surface itself.",
      "source": "GLDAS 2.0",
      "firstMonth": 0,
      "lastMonth": 803
    },
    {
      "id": "PRECTOTCORR",
      "name": "Precipitation",
      "unit": "mm/day",
      "trendUnit": "mm/day",
      "decimals": 2,
      "description": "Average daily rain and snow, measured from space by the GPM satellites and calibrated to rain gauges.",
      "source": "GPM IMERG",
      "firstMonth": 600,
      "lastMonth": 932
    },
    {
      "id": "QV2M",
      "name": "Specific humidity",
      "unit": "g/kg",
      "trendUnit": "g/kg",
      "decimals": 2,
      "description": "Grams of water vapour in each kilogram of air near the ground.",
      "source": "MERRA-2",
      "firstMonth": 384,
      "lastMonth": 935
    },
    {
      "id": "RH2M",
      "name": "Relative humidity",
      "unit": "%",
      "trendUnit": "pp",
      "decimals": 1,
      "description": "How close the air near the ground is to being saturated with water vapour.",
      "source": "MERRA-2",
      "firstMonth": 384,
      "lastMonth": 935
    },
    {
      "id": "GWETROOT",
      "name": "Root-zone soil moisture",
      "unit": "mm",
      "trendUnit": "mm",
      "decimals": 1,
      "description": "Water held in the soil where plant roots reach, as a depth of water.",
      "source": "GLDAS 2.0",
      "firstMonth": 0,
      "lastMonth": 803
    },
    {
      "id": "EVLAND",
      "name": "Evapotranspiration",
      "unit": "mm/day",
      "trendUnit": "mm/day",
      "decimals": 2,
      "description": "Water returned to the air each day from soil, water surfaces and plant leaves.",
      "source": "GLDAS 2.0",
      "firstMonth": 0,
      "lastMonth": 803
    },
    {
      "id": "WS10M",
      "name": "Wind speed",
      "unit": "m/s",
      "trendUnit": "m/s",
      "decimals": 2,
      "description": "Average wind speed near the ground.",
      "source": "GLDAS 2.0",
      "firstMonth": 0,
      "lastMonth": 803
    },
    {
      "id": "SNOW",
      "name": "Snow depth",
      "unit": "cm",
      "trendUnit": "cm",
      "decimals": 1,
      "description": "Average depth of snow on the ground through the month.",
      "source": "GLDAS 2.0",
      "firstMonth": 0,
      "lastMonth": 803
    }
  ],
  "sites": [
    {
      "id": "southern-ontario",
      "name": "Southern Ontario",
      "region": "Canada",
      "latitude": 44.125,
      "longitude": -80.625,
      "bounds": {
        "south": 44.0,
        "north": 44.25,
        "west": -80.75,
        "east": -80.5
      },
      "cellCount": 1
    },
    {
      "id": "great-plains",
      "name": "Central Great Plains",
      "region": "United States",
      "latitude": 44.125,
      "longitude": -80.625,
      "bounds": {
        "south": 44.0,
        "north": 44.25,
        "west": -80.75,
        "east": -80.5
      },
      "cellCount": 1
    },
    {
      "id": "mexican-plateau",
      "name": "Mexican Plateau",
      "region": "Mexico",
      "latitude": 44.125,
      "longitude": -80.625,
      "bounds": {
        "south": 44.0,
        "north": 44.25,
        "west": -80.75,
        "east": -80.5
      },
      "cellCount": 1
    },
    {
      "id": "central-amazon",
      "name": "Central Amazon",
      "region": "Brazil",
      "latitude": -3.375,
      "longitude": -61.375,
      "bounds": {
        "south": -3.5,
        "north": -3.25,
        "west": -61.5,
        "east": -61.25
      },
      "cellCount": 1
    },
    {
      "id": "cerrado",
      "name": "Cerrado",
      "region": "Brazil",
      "latitude": -15.625,
      "longitude": -47.625,
      "bounds": {
        "south": -15.75,
        "north": -15.5,
        "west": -47.75,
        "east": -47.5
      },
      "cellCount": 1
    },
    {
      "id": "patagonian-steppe",
      "name": "Patagonian Steppe",
      "region": "Argentina",
      "latitude": -49.625,
      "longitude": -70.625,
      "bounds": {
        "south": -49.75,
        "north": -49.5,
        "west": -70.75,
        "east": -70.5
      },
      "cellCount": 1
    }
  ],
  "compare": {
    "id": "T2M_GLDAS21",
    "source": "GLDAS 2.1",
    "firstMonth": 624,
    "lastMonth": 935
  }
};
