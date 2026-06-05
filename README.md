# Sprite-to-Mesh-HDR Pipeline

Automation pipeline: **Sprite sheet → Mesh geometry → HDR environment/light probe refinery**

Part of the Guilded Pig Trench prompt-asset toolchain.

## Pipeline Stages

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Sprite Sheet   │───▶│   Mesh Gen       │───▶│  HDR Refinery    │
│  Processor      │    │  (GLTF/GLB)      │    │  (Cubemap/IBL)   │
└─────────────────┘    └──────────────────┘    └──────────────────┘
       │                      │                       │
       ▼                      ▼                       ▼
  Frame extraction      Geometry types:          Outputs:
  - Grid detection       - billboard               - HDR cubemap
  - Auto frame size      - card (double-sided)     - Irradiance map
  - Metadata JSON        - extruded (3D depth)     - Prefiltered env
                         - volumetric (layers)     - BRDF LUT
```

## Installation

```bash
npm install
npm run build
```

## Usage

### Full Pipeline (One Command)

```bash
sprite-to-mesh-hdr run \
  -i spritesheet.png \
  -o output/ \
  --cols 8 --rows 4 \
  --mesh-type card \
  --hdr-resolution 512 \
  --samples 256
```

Outputs:
```
output/
├── frames/           # Extracted sprite frames
├── frames.json       # Frame metadata
├── meshes/           # GLB files (one per frame)
├── hdr/
│   ├── cubemap_512.hdr
│   ├── irradiance_32.hdr
│   ├── prefiltered_512.hdr
│   └── brdf_lut.png
└── manifest.json     # Full pipeline manifest
```

### Individual Stages

**1. Extract frames only:**
```bash
sprite-to-mesh-hdr sprite-extract -i spritesheet.png -o frames/ --cols 8 --rows 4
```

**2. Generate meshes from frames:**
```bash
sprite-to-mesh-hdr mesh-gen -i frames/ -o meshes/ --type card
```

Types: `billboard` | `card` | `extruded` | `volumetric`

**3. Generate HDR from meshes or frames:**
```bash
sprite-to-mesh-hdr hdr-refine -i meshes/ -o hdr/ --resolution 512 --samples 256
```

## Mesh Types

| Type | Description | Use Case |
|------|-------------|----------|
| `billboard` | Single quad, camera-facing | Distant particles, UI |
| `card` | Double-sided quad | Foliage, signs, effects |
| `extruded` | 3D box with depth | Props, collectibles |
| `volumetric` | Multi-layer billboards | Clouds, fire, magic |

## HDR Outputs

| File | Purpose | Resolution |
|------|---------|------------|
| `cubemap.hdr` | Raw environment map | Configurable (default 512) |
| `irradiance.hdr` | Diffuse lighting (convolved) | 1/16 resolution |
| `prefiltered.hdr` | Specular lighting (mip chain) | 5 mip levels |
| `brdf_lut.png` | BRDF integration LUT | 512×512 |

## Integration with Prompt-Asset Toolchain

```bash
# Writer: generates prompt for sprite style
prompt-asset-writer generate -t asset-prompt.hbs -o prompt.json -d '{"title":"Fire Sprite"}'

# Drawer: renders sprite sheet from prompt
prompt-asset-draw render --asset fire_sprite --out spritesheet.png

# Pipeline: converts to game-ready assets
sprite-to-mesh-hdr run -i spritesheet.png -o game_assets/ --cols 4 --rows 4 --mesh-type volumetric
```

## CI/CD

GitHub Actions workflow runs:
1. Creates test sprite sheet
2. Runs sprite extraction
3. Runs mesh generation
4. Runs HDR refinery
5. Verifies outputs

## Dependencies

- `sharp` — Image processing (sprite extraction, HDR face generation)
- `@gltf-transform/core` — GLTF/GLB mesh authoring
- `canvas` — Procedural texture generation
- `commander` — CLI framework

## License

MIT — Guinea Pig Trench LLC