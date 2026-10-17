import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { buildUniversalSolidMesh } from './universalSolidBuilder';

/**
 * Enclosed 3D Solid Engine
 *
 * Exclusively delegates to the 3D Volumetric Marching Cubes Engine (universalSolidBuilder.ts).
 * Completely eliminates 2.5D heightmaps, dual-surface root assumptions, and shape templates.
 * Natively samples full (X, Y, Z) space to extract watertight meshes for any topology (Genus 0, Genus 1+, multi-sheet, etc.).
 */
export function buildTwoSurfacesSolidMesh(options: Math3DOptions): Math3DGeometryResult {
  return buildUniversalSolidMesh(options);
}
