# References

Every external resource used by the project: data, code and reading.

## NASA data

| Resource | Used for | Source |
|---|---|---|
| LRO LOLA Gridded Data Records, south polar elevation models `LDEM_80S_80M` and `LDEM_75S_240M` | Terrain horizon of each site | NASA PDS Geosciences Node, `LRO-L-LOLA-4-GDR-V1.0` — https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ |
| LOLA average illumination maps `AVGVISIB_85S_060M_201608` (Sun) and `AVGVISIB_85S_060M_201608_EARTH` (Earth) | Validation of the terrain horizon; choice of the site point inside each candidate region | LOLA team, NASA GSFC — https://imbrium.mit.edu/EXTRAS/ILLUMINATION/ |
| JPL Horizons System | Reference positions of the Sun and the Earth seen from the lunar surface (validation tables) | NASA JPL Solar System Dynamics — https://ssd.jpl.nasa.gov/horizons/ |

## Software

| Library | License | Used for |
|---|---|---|
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | MIT | Positions of the Sun, Earth and Moon and the lunar rotation axis, in the browser |
| [Vite](https://vitejs.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) | MIT / Apache-2.0 / MIT | Build and tests |
| [NumPy](https://numpy.org) | BSD-3-Clause | Offline horizon computation |

## Reading

- Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081.
