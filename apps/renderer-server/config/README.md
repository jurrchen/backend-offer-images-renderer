# Generator Configuration

This directory contains the generator configuration file(s) used by the renderer-server.

## generators.json

This file defines the product generators that the renderer can use. Each generator represents a product variant with specific printing methods, views, colors, and rendering parameters.

### Structure

```json
[
  {
    "active": true,              // Whether this generator is currently active
    "id": "unique-id",            // Unique identifier for this generator
    "size": "1024",               // Canvas size for rendering
    "printMethod": "DTG",         // Print method (DTG, SUBLIMATION, EMBROIDERY, etc.)
    "options": {},                // Additional options (stitchColor, variantDimensions, etc.)
    "multicolorDefinitions": [],  // Multi-color print definitions

    "views": [                    // Array of available views (front, back, etc.)
      {
        "id": "view-front",
        "supportsTransparency": true,
        "regions": ["chest"],     // Printable regions in this view
        "flatPreview": false,
        "images": [               // Base images (MAIN, MASK, OPTIONAL_MASK)
          {
            "type": "MAIN",
            "url": "path/to/image.png"
          }
        ],
        "mesh": {                 // 3D mesh configuration
          "scale": 1.0,
          "url": "path/to/mesh.glb"
        },
        "camera": {               // Camera settings
          "z": 800,
          "focal": 35,
          "projection": "ORTHOGRAPHIC"
        }
      }
    ],

    "colors": [                   // Available colors for this generator
      {
        "name": "Black",
        "mode": "SINGLE_COLOR",
        "hex": "#000000",
        "cv": 255,                // Color value
        "bv": 100,                // Brightness value
        "hl": 0.95,               // Highlight
        "sh": 0.025,              // Shadow
        "hr": 0.45,               // Highlight range
        "sa": 100,                // Saturation
        "gv": 1.0,                // Gamma value
        "textured": false,
        "texture": {},
        "values": []
      }
    ]
  }
]
```

## Print Methods

Available print methods:
- `DTG` - Direct-to-Garment
- `SUBLIMATION` - Dye Sublimation
- `EMBROIDERY` - Embroidered
- `SCREEN_PRINTING` - Screen Printing
- `PRINTED` - Generic Printed
- `STICKER` - Sticker/Decal
- `DTFX` - Direct-to-Film Transfer
- `UV` - UV Printing
- `ALL_OVER_PRINT` - All-Over Print
- `KNITTING` - Knitted
- `DRINKWARE` - Drinkware Printing
- `GARMENT_PRINTED` - Garment Printed
- `ACRYLIC_CUTOUT` - Acrylic Cutout
- `DIE_CUT_MAGNET` - Die Cut Magnet
- `HOLO_STICKER` - Holographic Sticker
- `OTHER` - Other/Custom

## Camera Projections

- `ORTHOGRAPHIC` - Parallel projection (flat view)
- `PERSPECTIVE` - Perspective projection (3D view)

## Color Modes

- `SINGLE_COLOR` - Single solid color
- `MULTI_COLOR` - Multiple colors (uses multicolorDefinitions)

## Usage

To use a different generator configuration:

1. **Environment variable**:
   ```bash
   GENERATOR_CONFIG_PATH=/path/to/custom/generators.json
   ```

2. **Default path**:
   Place your configuration in `./config/generators.json`

3. **Programmatic**:
   Pass generators array directly to `HeadlessRenderer.initialize(generators)`

## Example: Creating a Real Generator

For production use, replace the placeholder URLs with actual assets:

```json
{
  "id": "unisex-tshirt-dtg",
  "printMethod": "DTG",
  "views": [
    {
      "id": "front",
      "images": [
        {
          "type": "MAIN",
          "url": "https://cdn.example.com/products/tshirt-front-base.png"
        },
        {
          "type": "MASK",
          "url": "https://cdn.example.com/products/tshirt-front-mask.png"
        }
      ],
      "mesh": {
        "url": "https://cdn.example.com/models/tshirt-front.glb",
        "scale": 1.0
      }
    }
  ]
}
```

## Notes

- The current `generators.json` contains a minimal test configuration
- For actual rendering, you'll need valid image URLs and 3D mesh files
- At least one generator must have `"active": true`
- Each view must have at least a MAIN and MASK image
- Mesh URLs should point to valid GLB/GLTF 3D models
