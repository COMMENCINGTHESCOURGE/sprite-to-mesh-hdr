import { Command } from 'commander';
import { SpriteSheetProcessor } from './stages/sprite-sheet-processor';
import { MeshGenerator } from './stages/mesh-generator';
import { HDRRefinery } from './stages/hdr-refinery';
import path from 'path';
import fs from 'fs-extra';

const program = new Command();

program
  .name('sprite-to-mesh-hdr')
  .description('Automation pipeline: Sprite sheet → Mesh → HDR refinery')
  .version('0.1.0');

program
  .command('run')
  .description('Run full pipeline')
  .requiredOption('-i, --input <path>', 'Input sprite sheet image')
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--cols <n>', 'Sprite sheet columns', '1')
  .option('--rows <n>', 'Sprite sheet rows', '1')
  .option('--frame-width <n>', 'Frame width (auto if not set)')
  .option('--frame-height <n>', 'Frame height (auto if not set)')
  .option('--mesh-type <type>', 'Mesh type: billboard|card|extruded|volumetric', 'card')
  .option('--hdr-resolution <n>', 'HDR cubemap resolution', '512')
  .option('--samples <n>', 'HDR samples per pixel', '256')
  .option('--skip-mesh', 'Skip mesh generation', false)
  .option('--skip-hdr', 'Skip HDR refinery', false)
  .action(async (opts) => {
    const inputPath = path.resolve(opts.input);
    const outputDir = path.resolve(opts.output);
    
    if (!await fs.pathExists(inputPath)) {
      console.error(`Input not found: ${inputPath}`);
      process.exit(1);
    }
    
    await fs.ensureDir(outputDir);
    
    console.log(`[1/3] Sprite Sheet Processor`);
    const processor = new SpriteSheetProcessor({
      cols: parseInt(opts.cols),
      rows: parseInt(opts.rows),
      frameWidth: opts.frameWidth ? parseInt(opts.frameWidth) : undefined,
      frameHeight: opts.frameHeight ? parseInt(opts.frameHeight) : undefined
    });
    
    const frames = await processor.process(inputPath, path.join(outputDir, 'frames'));
    console.log(`  Extracted ${frames.length} frames`);
    
    let meshes: string[] = [];
    
    if (!opts.skipMesh) {
      console.log(`[2/3] Mesh Generator (${opts.meshType})`);
      const meshGen = new MeshGenerator({
        type: opts.meshType as any,
        outputDir: path.join(outputDir, 'meshes')
      });
      
      meshes = await meshGen.generate(frames);
      console.log(`  Generated ${meshes.length} mesh files`);
    }
    
    if (!opts.skipHdr) {
      console.log(`[3/3] HDR Refinery`);
      const hdr = new HDRRefinery({
        resolution: parseInt(opts.hdrResolution),
        samples: parseInt(opts.samples),
        outputDir: path.join(outputDir, 'hdr')
      });
      
      const hdrFiles = await hdr.process(meshes.length > 0 ? meshes : frames);
      console.log(`  Generated ${hdrFiles.length} HDR files`);
    }
    
    // Write manifest
    const manifest = {
      input: inputPath,
      outputDir,
      frames: frames.map(f => path.relative(outputDir, f)),
      meshes: meshes.map(m => path.relative(outputDir, m)),
      settings: opts
    };
    
    await fs.writeJson(path.join(outputDir, 'manifest.json'), manifest, { spaces: 2 });
    console.log(`\nPipeline complete. Manifest: ${path.join(outputDir, 'manifest.json')}`);
  });

program
  .command('sprite-extract')
  .description('Extract frames from sprite sheet only')
  .requiredOption('-i, --input <path>', 'Input sprite sheet')
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--cols <n>', 'Columns', '1')
  .option('--rows <n>', 'Rows', '1')
  .action(async (opts) => {
    const processor = new SpriteSheetProcessor({
      cols: parseInt(opts.cols),
      rows: parseInt(opts.rows)
    });
    const frames = await processor.process(opts.input, opts.output);
    console.log(`Extracted ${frames.length} frames to ${opts.output}`);
  });

program
  .command('mesh-gen')
  .description('Generate meshes from frame images')
  .requiredOption('-i, --input <dir>', 'Input frames directory')
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--type <type>', 'Mesh type: billboard|card|extruded|volumetric', 'card')
  .action(async (opts) => {
    const frames = (await fs.readdir(opts.input))
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => path.join(opts.input, f));
    
    const meshGen = new MeshGenerator({
      type: opts.type as any,
      outputDir: opts.output
    });
    
    const meshes = await meshGen.generate(frames);
    console.log(`Generated ${meshes.length} meshes in ${opts.output}`);
  });

program
  .command('hdr-refine')
  .description('Generate HDR environment from meshes or frames')
  .requiredOption('-i, --input <dir>', 'Input meshes or frames directory')
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--resolution <n>', 'Cubemap resolution', '512')
  .option('--samples <n>', 'Samples per pixel', '256')
  .action(async (opts) => {
    const hdr = new HDRRefinery({
      resolution: parseInt(opts.resolution),
      samples: parseInt(opts.samples),
      outputDir: opts.output
    });
    
    const files = await hdr.process(opts.input);
    console.log(`Generated ${files.length} HDR files in ${opts.output}`);
  });

program.parse();