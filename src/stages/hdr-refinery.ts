import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';

export interface HDRConfig {
  resolution: number;
  samples: number;
  outputDir: string;
}

export interface HDRResult {
  cubemap: string;
  irradiance: string;
  prefiltered: string;
  brdfLut: string;
}

export class HDRRefinery {
  constructor(private config: HDRConfig) {}

  async process(inputPaths: string | string[]): Promise<string[]> {
    await fs.ensureDir(this.config.outputDir);
    
    const inputs = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
    const generatedFiles: string[] = [];
    
    // If input is a directory, read all images
    let imageFiles: string[] = [];
    if (inputs.length === 1 && (await fs.stat(inputs[0])).isDirectory()) {
      const dir = inputs[0];
      imageFiles = (await fs.readdir(dir))
        .filter(f => /\.(png|jpg|jpeg|webp|exr|hdr)$/i.test(f))
        .map(f => path.join(dir, f));
    } else {
      imageFiles = inputs;
    }
    
    console.log(`  Processing ${imageFiles.length} source images`);
    
    // Stage 1: Generate HDR cubemap from source images
    const cubemapPath = await this.generateCubemap(imageFiles);
    generatedFiles.push(cubemapPath);
    
    // Stage 2: Generate irradiance map (diffuse lighting)
    const irradiancePath = await this.generateIrradiance(cubemapPath);
    generatedFiles.push(irradiancePath);
    
    // Stage 3: Generate prefiltered environment map (specular lighting)
    const prefilteredPath = await this.generatePrefiltered(cubemapPath);
    generatedFiles.push(prefilteredPath);
    
    // Stage 4: Generate BRDF LUT
    const brdfLutPath = await this.generateBRDFLUT();
    generatedFiles.push(brdfLutPath);
    
    return generatedFiles;
  }
  
  private async generateCubemap(sourceImages: string[]): Promise<string> {
    const { resolution } = this.config;
    const faceSize = resolution;
    const cubemapPath = path.join(this.config.outputDir, `cubemap_${resolution}.hdr`);
    
    // Create 6 cubemap faces from source images
    // For simplicity, we'll project source images onto cubemap faces
    // In production, this would use proper equirectangular to cubemap conversion
    
    const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const faceImages: Map<string, Buffer> = new Map();
    
    for (const face of faces) {
      // Create a face by blending relevant source images
      // For demo, use first image or generate procedural
      const faceBuffer = await this.renderCubemapFace(face, faceSize, sourceImages);
      faceImages.set(face, faceBuffer);
    }
    
    // Write as HDR (Radiance .hdr format)
    // For now, write individual face PNGs and a manifest
    // Production would use a proper HDR writer
    await fs.writeFile(cubemapPath, JSON.stringify({
      format: 'cubemap-hdr',
      resolution,
      faces: faces.map(f => `${f}.png`),
      sourceImages: sourceImages.map(p => path.basename(p))
    }, null, 2));
    
    // Write individual face PNGs
    for (const [face, buffer] of faceImages) {
      await fs.writeFile(path.join(this.config.outputDir, `${face}.png`), buffer);
    }
    
    return cubemapPath;
  }
  
  private async renderCubemapFace(face: string, size: number, sources: string[]): Promise<Buffer> {
    // Procedural face generation based on face direction
    // In production, this would project equirectangular or multiple views
    
    const canvas = { width: size, height: size, channels: 4 } as any;
    const data = Buffer.alloc(size * size * 4);
    
    // Generate gradient based on face normal
    const normals: Record<string, [number, number, number]> = {
      px: [1, 0, 0], nx: [-1, 0, 0],
      py: [0, 1, 0], ny: [0, -1, 0],
      pz: [0, 0, 1], nz: [0, 0, -1]
    };
    
    const [nx, ny, nz] = normals[face];
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        
        // Simple procedural color based on face normal and UV
        const r = Math.floor(128 + 127 * nx * (u - 0.5) * 2);
        const g = Math.floor(128 + 127 * ny * (v - 0.5) * 2);
        const b = Math.floor(128 + 127 * nz);
        const a = 255;
        
        const idx = (y * size + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
    
    // If we have source images, blend the first one in
    if (sources.length > 0) {
      try {
        const srcImg = sharp(sources[0]);
        const resized = await srcImg.resize(size, size, { fit: 'fill' }).raw().toBuffer();
        // Blend 50/50
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.floor((data[i] + resized[i]) / 2);
          data[i + 1] = Math.floor((data[i + 1] + resized[i + 1]) / 2);
          data[i + 2] = Math.floor((data[i + 2] + resized[i + 2]) / 2);
        }
      } catch {
        // Ignore blend errors
      }
    }
    
    // Encode as PNG
    return await sharp(data, { raw: { width: size, height: size, channels: 4 } })
      .png()
      .toBuffer();
  }
  
  private async generateIrradiance(cubemapPath: string): Promise<string> {
    const irradiancePath = path.join(this.config.outputDir, `irradiance_${this.config.resolution}.hdr`);
    
    // Irradiance map = convolve cubemap with cosine lobe
    // For demo, generate lower-res blurred version
    const size = Math.max(32, this.config.resolution / 16);
    
    const faceData = JSON.parse(await fs.readFile(cubemapPath, 'utf-8'));
    
    // Generate blurred faces
    const faces = faceData.faces || ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    for (const face of faces) {
      const facePath = path.join(this.config.outputDir, face);
      try {
        const blurred = await sharp(facePath + '.png')
          .resize(size, size, { fit: 'fill', kernel: sharp.kernel.gaussian })
          .blur(4)
          .png()
          .toBuffer();
        
        await fs.writeFile(path.join(this.config.outputDir, `irradiance_${face}.png`), blurred);
      } catch {
        // Generate procedural if missing
        await this.renderCubemapFace(face, size, []).then(b => 
          fs.writeFile(path.join(this.config.outputDir, `irradiance_${face}.png`), b));
      }
    }
    
    await fs.writeFile(irradiancePath, JSON.stringify({
      format: 'irradiance-hdr',
      resolution: size,
      faces: faces.map(f => `irradiance_${f}.png`),
      sourceCubemap: path.basename(cubemapPath)
    }, null, 2));
    
    return irradiancePath;
  }
  
  private async generatePrefiltered(cubemapPath: string): Promise<string> {
    const prefilteredPath = path.join(this.config.outputDir, `prefiltered_${this.config.resolution}.hdr`);
    
    // Prefiltered = multiple mip levels with increasing roughness
    const faceData = JSON.parse(await fs.readFile(cubemapPath, 'utf-8'));
    const faces = faceData.faces || ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    
    const mipLevels = 5; // roughness 0.0, 0.25, 0.5, 0.75, 1.0
    const mipFiles: string[] = [];
    
    for (let mip = 0; mip < mipLevels; mip++) {
      const roughness = mip / (mipLevels - 1);
      const size = Math.max(16, this.config.resolution >> (mip + 1));
      
      for (const face of faces) {
        const facePath = path.join(this.config.outputDir, face);
        try {
          const blurSigma = 2 + roughness * 8;
          const processed = await sharp(facePath + '.png')
            .resize(size, size, { fit: 'fill' })
            .blur(blurSigma)
            .png()
            .toBuffer();
          
          const mipFacePath = path.join(this.config.outputDir, `prefiltered_mip${mip}_${face}.png`);
          await fs.writeFile(mipFacePath, processed);
          mipFiles.push(`prefiltered_mip${mip}_${face}.png`);
        } catch {
          // Generate procedural
          const b = await this.renderCubemapFace(face, size, []);
          const mipFacePath = path.join(this.config.outputDir, `prefiltered_mip${mip}_${face}.png`);
          await fs.writeFile(mipFacePath, b);
          mipFiles.push(`prefiltered_mip${mip}_${face}.png`);
        }
      }
    }
    
    await fs.writeFile(prefilteredPath, JSON.stringify({
      format: 'prefiltered-hdr',
      mipLevels,
      faces: mipFiles,
      sourceCubemap: path.basename(cubemapPath)
    }, null, 2));
    
    return prefilteredPath;
  }
  
  private async generateBRDFLUT(): Promise<string> {
    const brdfPath = path.join(this.config.outputDir, 'brdf_lut.png');
    const size = 512;
    
    // Generate BRDF integration LUT (2D texture: NdotV x Roughness)
    const data = Buffer.alloc(size * size * 4);
    
    for (let y = 0; y < size; y++) {
      const roughness = y / (size - 1);
      for (let x = 0; x < size; x++) {
        const ndotv = x / (size - 1);
        
        // Schlick approximation for BRDF integration
        // This is a simplified version - production uses proper integration
        const c0 = Math.max(0, 1 - ndotv);
        const c1 = 1 - c0;
        const scale = Math.max(0.02, roughness * roughness);
        
        // Scale and bias terms
        const scaleVal = scale * c1;
        const biasVal = scale * c0;
        
        const r = Math.floor(Math.min(255, scaleVal * 255));
        const g = Math.floor(Math.min(255, biasVal * 255));
        const b = 0;
        const a = 255;
        
        const idx = (y * size + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
    
    await sharp(data, { raw: { width: size, height: size, channels: 4 } })
      .png()
      .toFile(brdfPath);
    
    return brdfPath;
  }
}