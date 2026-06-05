import { Document, Node, Mesh, Primitive, Accessor, Buffer, Attribute, Material, Texture, Image as GLTFImage } from '@gltf-transform/core';
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs-extra';
import path from 'path';

export type MeshType = 'billboard' | 'card' | 'extruded' | 'volumetric';

export interface MeshConfig {
  type: MeshType;
  outputDir: string;
  scale?: number;
}

export class MeshGenerator {
  constructor(private config: MeshConfig) {}

  async generate(framePaths: string[]): Promise<string[]> {
    await fs.ensureDir(this.config.outputDir);
    
    const io = new NodeIO();
    const meshes: string[] = [];
    
    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      const doc = new Document();
      
      // Create mesh based on type
      const mesh = this.createMesh(doc, i, framePath);
      
      // Add material with frame texture
      const material = this.createMaterial(doc, framePath);
      for (const prim of mesh.getPrimitives()) {
        prim.setMaterial(material);
      }
      
      const outputPath = path.join(this.config.outputDir, `mesh_${i.toString().padStart(4, '0')}.glb`);
      await io.writeBinary(outputPath, doc);
      meshes.push(outputPath);
    }
    
    return meshes;
  }
  
  private createMesh(doc: Document, index: number, texturePath: string) {
    const mesh = doc.createMesh(`mesh_${index}`);
    const prim = doc.createPrimitive();
    
    const scale = this.config.scale || 1;
    const halfW = 0.5 * scale;
    const halfH = 0.5 * scale;
    
    let positions: number[];
    let uvs: number[];
    let indices: number[];
    let normals: number[];
    
    switch (this.config.type) {
      case 'billboard':
        // Single quad facing +Z
        positions = [
          -halfW, -halfH, 0,
           halfW, -halfH, 0,
           halfW,  halfH, 0,
          -halfW,  halfH, 0
        ];
        uvs = [0, 1, 1, 1, 1, 0, 0, 0];
        indices = [0, 1, 2, 0, 2, 3];
        normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
        break;
        
      case 'card':
        // Double-sided card (two quads back-to-back)
        positions = [
          // Front
          -halfW, -halfH, 0.001,
           halfW, -halfH, 0.001,
           halfW,  halfH, 0.001,
          -halfW,  halfH, 0.001,
          // Back
          -halfW, -halfH, -0.001,
          -halfW,  halfH, -0.001,
           halfW,  halfH, -0.001,
           halfW, -halfH, -0.001
        ];
        uvs = [
          0, 1, 1, 1, 1, 0, 0, 0,  // Front
          1, 1, 1, 0, 0, 0, 0, 1   // Back (flipped)
        ];
        indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
        normals = [
          0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,  // Front
          0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1  // Back
        ];
        break;
        
      case 'extruded':
        // Extruded sprite with depth
        const depth = 0.1 * scale;
        positions = [
          // Front face
          -halfW, -halfH, depth/2,
           halfW, -halfH, depth/2,
           halfW,  halfH, depth/2,
          -halfW,  halfH, depth/2,
          // Back face
          -halfW, -halfH, -depth/2,
           halfW, -halfH, -depth/2,
           halfW,  halfH, -depth/2,
          -halfW,  halfH, -depth/2
        ];
        uvs = [
          0, 1, 1, 1, 1, 0, 0, 0,  // Front
          1, 1, 0, 1, 0, 0, 1, 0   // Back
        ];
        indices = [
          0, 1, 2, 0, 2, 3,  // Front
          4, 6, 5, 4, 7, 6,  // Back
          0, 4, 5, 0, 5, 1,  // Bottom
          2, 6, 7, 2, 7, 3,  // Top
          0, 3, 7, 0, 7, 4,  // Left
          1, 5, 6, 1, 6, 2   // Right
        ];
        normals = this.computeNormals(positions, indices);
        break;
        
      case 'volumetric':
        // Multi-layer volumetric billboard (for 2.5D effect)
        const layers = 8;
        const layerDepth = 0.2 * scale;
        const allPositions: number[] = [];
        const allUVs: number[] = [];
        const allIndices: number[] = [];
        
        for (let l = 0; l < layers; l++) {
          const z = (l - layers/2) * layerDepth / layers;
          const alpha = 1.0 - (l / layers) * 0.5;
          
          const baseIdx = allPositions.length / 3;
          allPositions.push(
            -halfW, -halfH, z,
             halfW, -halfH, z,
             halfW,  halfH, z,
            -halfW,  halfH, z
          );
          allUVs.push(0, 1, 1, 1, 1, 0, 0, 0);
          allIndices.push(
            baseIdx, baseIdx+1, baseIdx+2,
            baseIdx, baseIdx+2, baseIdx+3
          );
        }
        
        positions = allPositions;
        uvs = allUVs;
        indices = allIndices;
        normals = this.computeNormals(positions, indices);
        break;
    }
    
    // Create accessors
    const posAccessor = doc.createAccessor(prim.getAttribute('POSITION') || null)
      .setArray(new Float32Array(positions))
      .setType(Accessor.Type.VEC3);
    prim.setAttribute('POSITION', posAccessor);
    
    const uvAccessor = doc.createAccessor(prim.getAttribute('TEXCOORD_0') || null)
      .setArray(new Float32Array(uvs))
      .setType(Accessor.Type.VEC2);
    prim.setAttribute('TEXCOORD_0', uvAccessor);
    
    const idxAccessor = doc.createAccessor()
      .setArray(new Uint16Array(indices))
      .setType(Accessor.Type.SCALAR);
    prim.setIndices(idxAccessor);
    
    const normAccessor = doc.createAccessor()
      .setArray(new Float32Array(normals))
      .setType(Accessor.Type.VEC3);
    prim.setAttribute('NORMAL', normAccessor);
    
    mesh.addPrimitive(prim);
    return mesh;
  }
  
  private createMaterial(doc: Document, texturePath: string) {
    const material = doc.createMaterial('sprite_material')
      .setAlphaMode('BLEND')
      .setDoubleSided(this.config.type !== 'billboard');
    
    // Note: In production, we'd embed the texture. For now, reference external.
    const image = doc.createImage('sprite_texture')
      .setURI(texturePath);
    const texture = doc.createTexture('sprite_texture')
      .setImage(image)
      .setSampler(doc.createSampler().setMagFilter(9729).setMinFilter(9987));
    
    material.setBaseColorTexture(texture);
    
    return material;
  }
  
  private computeNormals(positions: number[], indices: number[]): number[] {
    const normals = new Array(positions.length).fill(0);
    
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i+1] * 3;
      const i2 = indices[i+2] * 3;
      
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1+1] - positions[i0+1];
      const az = positions[i1+2] - positions[i0+2];
      
      const bx = positions[i2] - positions[i0];
      const by = positions[i2+1] - positions[i0+1];
      const bz = positions[i2+2] - positions[i0+2];
      
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      if (len > 0) {
        const nxl = nx / len, nyl = ny / len, nzl = nz / len;
        for (const idx of [i0, i1, i2]) {
          normals[idx] += nxl;
          normals[idx+1] += nyl;
          normals[idx+2] += nzl;
        }
      }
    }
    
    // Normalize
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.sqrt(normals[i]**2 + normals[i+1]**2 + normals[i+2]**2);
      if (len > 0) {
        normals[i] /= len;
        normals[i+1] /= len;
        normals[i+2] /= len;
      }
    }
    
    return normals;
  }
}