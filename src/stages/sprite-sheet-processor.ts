import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';

export interface SpriteSheetConfig {
  cols: number;
  rows: number;
  frameWidth?: number;
  frameHeight?: number;
}

export interface FrameInfo {
  index: number;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SpriteSheetProcessor {
  constructor(private config: SpriteSheetConfig) {}

  async process(inputPath: string, outputDir: string): Promise<string[]> {
    await fs.ensureDir(outputDir);
    
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    const { width: imgWidth, height: imgHeight } = metadata;
    
    if (!imgWidth || !imgHeight) {
      throw new Error('Could not read image dimensions');
    }
    
    const frameWidth = this.config.frameWidth || Math.floor(imgWidth / this.config.cols);
    const frameHeight = this.config.frameHeight || Math.floor(imgHeight / this.config.rows);
    
    console.log(`  Image: ${imgWidth}x${imgHeight}, Grid: ${this.config.cols}x${this.config.rows}`);
    console.log(`  Frame: ${frameWidth}x${frameHeight}`);
    
    const frames: string[] = [];
    
    for (let row = 0; row < this.config.rows; row++) {
      for (let col = 0; col < this.config.cols; col++) {
        const index = row * this.config.cols + col;
        const left = col * frameWidth;
        const top = row * frameHeight;
        
        const outputPath = path.join(outputDir, `frame_${index.toString().padStart(4, '0')}.png`);
        
        await image
          .clone()
          .extract({ left, top, width: frameWidth, height: frameHeight })
          .png()
          .toFile(outputPath);
        
        frames.push(outputPath);
      }
    }
    
    // Write frame metadata
    const frameData: FrameInfo[] = frames.map((f, i) => {
      const row = Math.floor(i / this.config.cols);
      const col = i % this.config.cols;
      return {
        index: i,
        path: f,
        x: col * frameWidth,
        y: row * frameHeight,
        width: frameWidth,
        height: frameHeight
      };
    });
    
    await fs.writeJson(path.join(outputDir, 'frames.json'), frameData, { spaces: 2 });
    
    return frames;
  }
}