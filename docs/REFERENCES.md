# References

Every external resource used by the project: data, 3D assets, code and reading.

## NASA data

| Resource | Used for | Source |
|---|---|---|
| LRO LOLA Gridded Data Records, south polar elevation models `LDEM_80S_80M`, `LDEM_75S_240M` and `LDEM_60S_240M` | Terrain horizon of each site and of any point of the visitor's own (`public/data/polar`); terrain of the 3D view | NASA PDS Geosciences Node, `LRO-L-LOLA-4-GDR-V1.0` — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ |
| LRO LOLA Gridded Data Records, global elevation model `LDEM_64` (64 pixels per degree) | Terrain of the sites away from the south pole and of any point of the visitor's own outside the polar model (`public/data/global`) | NASA PDS Geosciences Node, `LRO-L-LOLA-4-GDR-V1.0` — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ |
| LOLA 5 m/pixel site elevation models (Site01, Site04, Site06, Site20, Site23, SL2, Haworth) | Terrain near seven of the sites: horizon and 3D view | NASA GSFC Planetary Geodesy Data Archive, product 78 — https://pgda.gsfc.nasa.gov/products/78 (Barker et al. 2021) |
| LOLA average illumination maps `AVGVISIB_85S_060M_201608` (Sun) and `AVGVISIB_85S_060M_201608_EARTH` (Earth) | Validation of the terrain horizon; choice of the site point at two published high-illumination locations | LOLA team, NASA GSFC — https://imbrium.mit.edu/EXTRAS/ILLUMINATION/ |
| JPL Horizons System | Reference positions of the Sun and the Earth seen from the lunar surface (validation tables in `tests/golden`) | NASA JPL Solar System Dynamics — https://ssd.jpl.nasa.gov/horizons/ |
| LROC "Anthropogenic Features on the Moon" | Coordinates of real landing sites | LROC, Arizona State University — https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_ANTHROPOGENIC_OBJECTS |
| Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), stars to magnitude 5.6 | Stars of the 3D view, at their true positions | Yale University Observatory / NASA ADC catalogue V/50; JSON edition by Bretton Wade (MIT) — https://github.com/brettonw/YaleBrightStarCatalog |
| Deep Star Maps 2020, Milky Way layer (built from the Hipparcos-2, Tycho-2 and Gaia DR2 catalogues) | The Milky Way of the 3D night sky, in J2000 coordinates | NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC — https://svs.gsfc.nasa.gov/4851 |
| CGI Moon Kit, colour map of the Moon from the Lunar Reconnaissance Orbiter Camera (`lroc_color_poles_2k`) | The globe of the journey between two sites | NASA's Scientific Visualization Studio — https://svs.gsfc.nasa.gov/4720 |
| VIIRS Corrected Reflectance (True Color), Suomi NPP and NOAA-20, 7 February 2026 | The face of the Earth in the 3D view: one real day, with its clouds (`tools/build_earth.py` joins the two pictures, keeps the one with the darker sea where the Sun glints, and fills the polar night) | NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS) — https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api (layers `VIIRS_SNPP_CorrectedReflectance_TrueColor` and `VIIRS_NOAA20_CorrectedReflectance_TrueColor`). We acknowledge the use of imagery provided by services from NASA's GIBS. |

## 3D models and textures

| Asset | License | Source |
|---|---|---|
| Space Exploration Vehicle (concept rover) | Public domain (NASA) | NASA 3D Resources — https://github.com/nasa/NASA-3D-Resources |
| Apollo Lunar Module | Public domain (NASA) | NASA 3D Resources — https://github.com/nasa/NASA-3D-Resources |
| Moon Rock 01, 03 and 05 (scanned rocks) | CC0 | Poly Haven — https://polyhaven.com/models/rocks |
| Moon Dusted 01 and Moon Footprints 01 (surface textures) | CC0 | Poly Haven — https://polyhaven.com/textures |
| Solar array mast | MIT (this project) | Original, built in code (`src/viz/mast.ts`), loosely after NASA's vertical solar array concept |

The NASA models were only re-encoded for the web (mesh compression and smaller textures); the geometry is unchanged.
Other candidate sites come from Wueller et al. 2026 (see Reading).

## Software

| Library | License | Used for |
|---|---|---|
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | MIT | Positions of the Sun, Earth and Moon and the lunar rotation, in the browser |
| [three.js](https://threejs.org) | MIT | 3D view |
| [Jost](https://indestructibletype.com/Jost.html) by Owen Earl (indestructible type*), via Fontsource | OFL 1.1 | Typeface of the headings and of the explanations. An open family in the tradition of Futura, the typeface of the plaque Apollo 11 left on the Moon; it is not NASA's lettering |
| [B612](https://github.com/polarsys/b612) by Airbus, ENAC, Université de Toulouse III and Intactile Design, via Fontsource | OFL 1.1 | Typeface of the labels, the figures and the controls. Designed and tested for the cockpit displays of aircraft; its figures all have the same width |
| [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) | MIT / Apache-2.0 | Build, tests and development screenshots |
| [NumPy](https://numpy.org), [tifffile](https://github.com/cgohlke/tifffile), [Pillow](https://python-pillow.org) | BSD / BSD / MIT-CMU | Offline tools: horizons, terrain tiles, textures |
| [glTF-Transform](https://gltf-transform.dev) | MIT | Re-encoding the NASA models for the web |

## Reading

- Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081.
- Barker, M. K., et al. (2021). Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions. *Planetary and Space Science* 203, 105119.
- Gläser, P., et al. (2018). Illumination conditions at the lunar poles: Implications for future exploration. *Planetary and Space Science* 162, 170–178. https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf
- Wueller, F., et al. (2026). Candidate landing sites in the Artemis exploration regions. *JGR Planets* 131(3), e2025JE009434. Data: https://zenodo.org/records/17084058
