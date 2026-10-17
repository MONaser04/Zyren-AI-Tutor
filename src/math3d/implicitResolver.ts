import type { Math3DOptions } from './types';

export interface ResolvedSurfaces {
  zTop: string;
  zBottom: string;
  domainMask?: string;
  isImplicit: boolean;
}

/**
 * @deprecated Legacy 2.5D implicit resolver.
 * All implicit and CSG geometry is now directly meshed in true 3D space via universalSolidBuilder.ts & implicitIsosurfaceBuilder.ts.
 */
export function resolveImplicitSurfaces(options: Math3DOptions): ResolvedSurfaces {
  return {
    zTop: options.zTop || options.equationZ || 'x + 2',
    zBottom: options.zBottom || 'x^2 + y^2',
    domainMask: options.domainMask,
    isImplicit: true,
  };
}
