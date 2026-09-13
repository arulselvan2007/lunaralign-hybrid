/**
 * Global Lunar Nomenclature & Landmark Geodatabase
 * Coordinates, elevations, and telemetry for prominent lunar features and landing sites.
 * Datum: Lunar IAU2000 Ellipsoid (Mean Radius = 1,737.4 km)
 */

export interface LunarLandmark {
  id: string;
  name: string;
  category: "Crater" | "Landing Site" | "Mare" | "Rille" | "Mountain";
  lat: number;
  lon: number;
  diameter_km?: number;
  depth_km?: number;
  elevation_m: number;
  mission?: string;
  year?: number;
  spectral_profile?: string;
  description: string;
  geological_interest: string;
}

export const LUNAR_LANDMARKS: LunarLandmark[] = [
  {
    id: "statio-shiv-shakti",
    name: "Statio Shiv Shakti (Chandrayaan-3)",
    category: "Landing Site",
    lat: -69.373,
    lon: 32.319,
    elevation_m: -1820,
    mission: "ISRO Chandrayaan-3 (Vikram Lander & Pragyan Rover)",
    year: 2023,
    spectral_profile: "High Anorthosite Highlands with Ferroan composition",
    description: "Historic touchdown site of India's Chandrayaan-3 lunar lander on August 23, 2023, near Manzinus C and Simpelius 71S.",
    geological_interest: "High-latitude southern highland terrain. ChaSTE payload recorded direct lunar sub-surface thermal gradients.",
  },
  {
    id: "shackleton",
    name: "Shackleton Crater (South Pole)",
    category: "Crater",
    lat: -89.9,
    lon: 0.0,
    diameter_km: 21,
    depth_km: 4.2,
    elevation_m: -3900,
    mission: "Chandrayaan-1 / LRO / Artemis Target",
    spectral_profile: "Permanently Shadowed Region (PSR) with H2O Ice Volatiles",
    description: "Impact crater whose interior rim is in perpetual darkness, hosting significant concentrations of cryogenic water-ice in cold traps.",
    geological_interest: "The peaks along Shackleton's rim receive almost 90% solar illumination, making it a prime site for future solar-powered lunar outposts.",
  },
  {
    id: "boguslawsky",
    name: "Boguslawsky Crater (TMC-2 Calibration)",
    category: "Crater",
    lat: -72.9,
    lon: 43.2,
    diameter_km: 97,
    depth_km: 3.8,
    elevation_m: -1850,
    mission: "ISRO Chandrayaan-2 TMC-2 Primary Target",
    year: 2019,
    spectral_profile: "Feldspathic highland regolith with micro-cratering",
    description: "Ancient pre-Nectarian impact crater with a degraded, rounded rim and a flat, cratered basaltic floor.",
    geological_interest: "Primary focus of Chandrayaan-2 TMC-2 multi-angle stereoscopic DEM generation and surface roughness alignment.",
  },
  {
    id: "tycho",
    name: "Tycho Crater",
    category: "Crater",
    lat: -43.31,
    lon: -11.36,
    diameter_km: 86,
    depth_km: 4.8,
    elevation_m: -1400,
    mission: "Surveyor 7 / LRO NAC",
    year: 1968,
    spectral_profile: "Immature pyroxene-rich basalt with high optical maturity index",
    description: "Prominent Copernican-age crater famous for its brilliant ray system stretching over 1,500 kilometers across the lunar near side.",
    geological_interest: "Central peak towers 1.6 km above the crater floor. Ejecta samples were analyzed by Apollo 17 astronauts.",
  },
  {
    id: "copernicus",
    name: "Copernicus Crater",
    category: "Crater",
    lat: 9.62,
    lon: -20.08,
    diameter_km: 93,
    depth_km: 3.8,
    elevation_m: -2200,
    mission: "Apollo / LROC Benchmark",
    spectral_profile: "Olivine-bearing central peaks excavated from the deep lunar crust",
    description: "Majestic complex impact crater with pronounced terraced inner walls and three prominent central peaks in eastern Oceanus Procellarum.",
    geological_interest: "Provides a geological datum defining the Copernican Period of the Moon's geological timeline.",
  },
  {
    id: "mare-tranquillitatis",
    name: "Mare Tranquillitatis (Statio Tranquillitatis)",
    category: "Mare",
    lat: 0.674,
    lon: 23.473,
    diameter_km: 873,
    elevation_m: -1300,
    mission: "Apollo 11 (First Crewed Lunar Landing)",
    year: 1969,
    spectral_profile: "High-Titanium (TiO2 > 7.5 wt%) Basaltic Lava Flows",
    description: "Extensive lunar mare composed of ancient basaltic lavas rich in ilmenite, site of humanity's first footsteps on the Moon.",
    geological_interest: "Extremely high titanium concentration gives the mare a distinctly darker and bluer spectral hue in IIRS composites.",
  },
  {
    id: "south-pole-aitken",
    name: "South Pole-Aitken Basin (SPA)",
    category: "Mare",
    lat: -53.0,
    lon: -169.0,
    diameter_km: 2500,
    depth_km: 12.5,
    elevation_m: -8800,
    mission: "Chang'e-4 / Chang'e-6 / Chandrayaan-2",
    year: 2019,
    spectral_profile: "Low-Calcium Pyroxene & Mantle Peridotite Exposures",
    description: "The largest, deepest, and oldest known impact basin in the Solar System, covering nearly a quarter of the lunar far side.",
    geological_interest: "Excavated down through the entire lunar crust into the upper mantle, offering a window into early planetary differentiation.",
  },
  {
    id: "hadley-rille",
    name: "Hadley Rille (Palus Putredinis)",
    category: "Rille",
    lat: 26.13,
    lon: 3.63,
    diameter_km: 120,
    depth_km: 0.35,
    elevation_m: -1900,
    mission: "Apollo 15 (Lunar Roving Vehicle)",
    year: 1971,
    spectral_profile: "Layered mare basalt sequences exposed along canyon walls",
    description: "Sinuous sinuous volcanic rille channel formed by collapsed subterranean lava tubes along the foot of the Montes Apenninus.",
    geological_interest: "Reveals direct vertical stratigraphy of successive multi-billion-year-old basalt lava sheets.",
  },
  {
    id: "aristarchus",
    name: "Aristarchus Plateau",
    category: "Mountain",
    lat: 23.7,
    lon: -47.4,
    diameter_km: 40,
    depth_km: 3.0,
    elevation_m: -800,
    mission: "Chandrayaan-1 Moon Mineralogy Mapper / IIRS",
    spectral_profile: "Extreme Pyroclastic Volcanic Glass & Thorium Enriched (KREEP)",
    description: "Vivid volcanic plateau with the highest radar backscatter and radon outgassing signatures detected on the lunar surface.",
    geological_interest: "Massive dark mantle deposits of volcanic orange and black glass beads rich in trapped volatile species.",
  },
];
