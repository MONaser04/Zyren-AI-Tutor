import type * as THREE from 'three';

export type Math3DPlotType =
  | 'surface'
  | 'parametric'
  | 'implicit_isosurface'
  | 'bounded_surfaces'
  | 'linear_extrusion'
  | 'solid_of_revolution';

export interface Math3DOptions {
  title?: string;
  plotType?: Math3DPlotType | 'extrusion' | 'two_surfaces' | 'implicit' | 'solid'; // backwards-compatible aliases
  
  // Expressions
  equationZ?: string;       // For single surface z = f(x, y) or implicit F(x, y, z) = C or inequalities
  zTop?: string;            // Top 3D surface z2 = f2(x, y) for bounded surfaces
  zBottom?: string;         // Bottom 3D surface z1 = f1(x, y) for bounded surfaces
  fTop?: string;            // Top 2D curve y2 = f2(x) for linear extrusion & revolution
  fBottom?: string;         // Bottom 2D curve y1 = f1(x) for linear extrusion & revolution
  curve2D?: string;         // Single 2D curve y = f(x) for revolution
  
  // Parametric Surface Expressions r(u, v) = (x(u,v), y(u,v), z(u,v))
  xUV?: string;
  yUV?: string;
  zUV?: string;
  uRange?: [number, number];
  vRange?: [number, number];
  
  // Domain & Ranges & Masks
  domainMask?: string;      // 2D bounding inequality constraint (e.g. 'x^2 + y^2 <= 1')
  xRange?: [number, number];
  yRange?: [number, number];
  zRange?: [number, number];
  
  // Revolution parameters
  revolutionAxis?: 'x' | 'y' | 'z';
  revolutionAngle?: number; // in degrees (default 360)
  
  // Visuals & Meshing Resolution
  colorTheme?: 'cyan_orange' | 'plasma' | 'electric_blue' | 'emerald';
  showWireframe?: boolean;
  autoRotate?: boolean;
  gridResolution?: number; // Dynamic 3D Marching Cubes grid resolution (default 80, safety clamped [24..140])
  resolution?: number;     // Alias for gridResolution
  clippingPlane?: string;  // Implicit cutting plane for watertight CSG cross-sections (e.g. 'x >= 0', 'z <= 2')
  crossSection?: string;   // Alias for clippingPlane
}

export interface Math3DGeometryResult {
  geometry: THREE.BufferGeometry;
  plotType: Math3DPlotType;
  formulaLabel: string;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}
