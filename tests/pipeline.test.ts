import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { SpriteSheetProcessor } from '../src/stages/sprite-sheet-processor';
import { MeshGenerator } from '../src/stages/mesh-generator';
import { HDRRefinery } from '../src/stages/hdr-refinery';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';

describe('SpriteSheetProcessor', () => {
  const testDir = path.join(__dirname, '..', 'test-output');
  const testSpriteSheet = path.join(testDir, 'test-spritesheet.png');

  beforeAll(async () => {
    await fs.ensureDir(testDir);
    // Create a 4x1 test sprite sheet (256x64)
    let composite = sharp({
      create: { width: 256, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    });
    const frames = [
      { color: [255, 0, 0, 255], left: 0 },
      { color: [0, 255, 0, 255], left: 64 },
      { color: [0, 0, 255, 255], left: 128 },
      { color: [255, 255, 0, 255], left: 192 }
    ];
    for (const f of frames) {
      const buf = Buffer.alloc(64 * 64 * 4);
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = f.color[0];
        buf[i+1] = f.color[1];
        buf[i+2] = f.color[2];
        buf[i+3] = f.color[3];
      }
      composite = composite.composite([{
        input: buf,
        raw: { width: 64, height: 64, channels: 4 },
        left: f.left,
        top: 0
      }]);
    }
    await composite.png().toFile(testSpriteSheet);
  });

  afterAll(async () => {
    await fs.remove(testDir);
  });

  test('extracts frames from sprite sheet', async () => {
    const processor = new SpriteSheetProcessor({ cols: 4, rows: 1 });
    const frames = await processor.process(testSpriteSheet, path.join(testDir, 'frames'));
    
    expect(frames.length).toBe(4);
    for (const f of frames) {
      expect(await fs.pathExists(f)).toBe(true);
    }
    
    const meta = await fs.readJson(path.join(testDir, 'frames', 'frames.json'));
    expect(meta.length).toBe(4);
    expect(meta[0].width).toBe(64);
    expect(meta[0].height).toBe(64);
  });
});

describe('MeshGenerator', () => {
  const testDir = path.join(__dirname, '..', 'test-output');
  const frameDir = path.join(testDir, 'frames');

  beforeAll(async () => {
    await fs.ensureDir(frameDir);
    // Create dummy frame PNGs
    for (let i = 0; i < 4; i++) {
      const buf = Buffer.alloc(64 * 64 * 4, 255);
      await sharp(buf, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toFile(path.join(frameDir, `frame_${i.toString().padStart(4, '0')}.png`));
    }
  });

  afterAll(async () => {
    await fs.remove(testDir);
  });

  test('generates billboard meshes', async () => {
    const gen = new MeshGenerator({ type: 'billboard', outputDir: path.join(testDir, 'meshes') });
    const frames = (await fs.readdir(frameDir))
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(frameDir, f));
    
    const meshes = await gen.generate(frames);
    
    expect(meshes.length).toBe(4);
    for (const m of meshes) {
      expect(await fs.pathExists(m)).toBe(true);
      expect(m).toMatch(/\.glb$/);
    }
  });

  test('generates card meshes (double-sided)', async () => {
    const gen = new MeshGenerator({ type: 'card', outputDir: path.join(testDir, 'meshes-card') });
    const frames = (await fs.readdir(frameDir))
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(frameDir, f));
    
    const meshes = await gen.generate(frames);
    expect(meshes.length).toBe(4);
  });

  test('generates extruded meshes', async () => {
    const gen = new MeshGenerator({ type: 'extruded', outputDir: path.join(testDir, 'meshes-extruded') });
    const frames = (await fs.readdir(frameDir))
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(frameDir, f));
    
    const meshes = await gen.generate(frames);
    expect(meshes.length).toBe(4);
  });

  test('generates volumetric meshes', async () => {
    const gen = new MeshGenerator({ type: 'volumetric', outputDir: path.join(testDir, 'meshes-volumetric') });
    const frames = (await fs.readdir(frameDir))
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(frameDir, f));
    
    const meshes = await gen.generate(frames);
    expect(meshes.length).toBe(4);
  });
});

describe('HDRRefinery', () => {
  const testDir = path.join(__dirname, '..', 'test-output');

  afterAll(async () => {
    await fs.remove(testDir);
  });

  test('generates HDR outputs from mesh directory', async () => {
    const hdr = new HDRRefinery({
      resolution: 64,
      samples: 16,
      outputDir: path.join(testDir, 'hdr')
    });
    
    const meshDir = path.join(testDir, 'meshes');
    if (!await fs.pathExists(meshDir)) {
      // Skip if no meshes
      return;
    }
    
    const files = await hdr.process(meshDir);
    
    expect(files.length).toBeGreaterThanOrEqual(4); // cubemap, irradiance, prefiltered, brdf
    for (const f of files) {
      expect(await fs.pathExists(f)).toBe(true);
    }
  });

  test('generates BRDF LUT', async () => {
    const hdr = new HDRRefinery({
      resolution: 64,
      samples: 16,
      outputDir: path.join(testDir, 'hdr-brdf')
    });
    
    // Process empty - should still generate BRDF LUT
    await fs.ensureDir(path.join(testDir, 'empty'));
    const files = await hdr.process(path.join(testDir, 'empty'));
    
    const brdfFile = files.find(f => f.includes('brdf'));
    expect(brdfFile).toBeDefined();
    expect(await fs.pathExists(brdfFile!)).toBe(true);
  });
});