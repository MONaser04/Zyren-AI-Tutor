/**
 * ThreeGraph3DCard — Interactive 3D WebGL Mathematical Card
 *
 * Integrated with the modular Math3D Geometry Engine (Router & Specialized Builders):
 * - Single 3D Surfaces z = f(x, y)
 * - Linear Extrusions of 2D bounded regions along Z
 * - Closed 3D Solids bounded between two surfaces z1(x, y) and z2(x, y)
 * - 3D Solids of Revolution around X, Y, or Z axis
 * - Unified 3D right-handed Cartesian coordinate space with glowing axes and grid plane
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Graph3DOptions } from '../types';
import { generate3DGeometry, classifyPlotType, type Math3DPlotType } from '../math3d';

export interface ThreeGraph3DCardProps {
  id: string;
  title?: string;
  options: Graph3DOptions;
  x: number;
  y: number;
  width?: number;
  height?: number;
  onRemove?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
}

export const ThreeGraph3DCard: React.FC<ThreeGraph3DCardProps> = ({
  id,
  title,
  options,
  x,
  y,
  width = 500,
  height = 420,
  onRemove,
  onMove,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isWireframe, setIsWireframe] = useState<boolean>(!!options.showWireframe);
  const [autoRotate, setAutoRotate] = useState<boolean>(!!options.autoRotate);
  const [formulaLabel, setFormulaLabel] = useState<string>('');

  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // ── Header Dragging on Whiteboard Canvas ──
  const isDraggingCardRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingCardRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: x,
      startY: y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingCardRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    if (onMove) {
      onMove(
        id,
        Math.round(dragStartRef.current.startX + dx),
        Math.round(dragStartRef.current.startY + dy)
      );
    }
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    isDraggingCardRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const resolvedPlotType: Math3DPlotType = classifyPlotType(options);

  // Reset Camera View
  const handleResetView = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }, []);

  // Zoom In button handler
  const handleZoomIn = useCallback(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target;
    const currentDist = camera.position.distanceTo(target);
    if (currentDist > controls.minDistance) {
      camera.position.sub(target).multiplyScalar(0.75).add(target);
      controls.update();
    }
  }, []);

  // Zoom Out button handler
  const handleZoomOut = useCallback(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target;
    const currentDist = camera.position.distanceTo(target);
    if (currentDist < controls.maxDistance) {
      camera.position.sub(target).multiplyScalar(1.3).add(target);
      controls.update();
    }
  }, []);

  // ─── 1. Initialize Scene, Camera, Renderer & OrbitControls (ONCE on mount) ───
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderWidth = width;
    const renderHeight = height - 70; // Header & footer offset

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera (Positioned in positive octant overlooking origin)
    const camera = new THREE.PerspectiveCamera(42, renderWidth / renderHeight, 0.1, 1000);
    camera.position.set(6.5, 7.5, 9.5);

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(renderWidth, renderHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.userSelect = 'none';
    renderer.domElement.style.cursor = 'grab';
    rendererRef.current = renderer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // OrbitControls: Direct 1:1 rotation & smooth independent camera zoom
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.8;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.2;
    controls.maxDistance = 60;
    controls.minDistance = 0.5;
    controls.saveState();
    controlsRef.current = controls;

    // Stop wheel, pointer, and touch events from bubbling to the whiteboard zoom handler
    const stopPropagationNative = (e: Event) => {
      e.stopPropagation();
    };
    renderer.domElement.addEventListener('wheel', stopPropagationNative, { passive: false });
    renderer.domElement.addEventListener('pointerdown', stopPropagationNative);
    renderer.domElement.addEventListener('touchstart', stopPropagationNative, { passive: false });
    renderer.domElement.addEventListener('touchmove', stopPropagationNative, { passive: false });

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.3);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x4ecdc4, 0.8);
    dirLight2.position.set(-10, -5, -10);
    scene.add(dirLight2);

    // Coordinate Space: Fixed Right-Handed Cartesian Axes (X=Cyan, Y=Green, Z=Orange)
    const axesGroup = new THREE.Group();
    const axisRadius = 0.035;
    const axisLen = 4.2;

    // X-Axis (Cyan - Horizontal)
    const xAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen * 2, 16);
    const xAxisMat = new THREE.MeshBasicMaterial({ color: 0x4ecdc4 });
    const xAxisMesh = new THREE.Mesh(xAxisGeo, xAxisMat);
    xAxisMesh.rotation.z = Math.PI / 2;
    axesGroup.add(xAxisMesh);

    // Y-Axis (Green - Depth)
    const yAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen * 2, 16);
    const yAxisMat = new THREE.MeshBasicMaterial({ color: 0xa8ff78 });
    const yAxisMesh = new THREE.Mesh(yAxisGeo, yAxisMat);
    yAxisMesh.rotation.x = Math.PI / 2;
    axesGroup.add(yAxisMesh);

    // Z-Axis (Orange/Gold - Vertical Up)
    const zAxisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen * 2, 16);
    const zAxisMat = new THREE.MeshBasicMaterial({ color: 0xff9f43 });
    const zAxisMesh = new THREE.Mesh(zAxisGeo, zAxisMat);
    axesGroup.add(zAxisMesh);

    // Grid Floor on (X, Y) Plane at Z = 0
    const gridHelper = new THREE.GridHelper(8, 16, 0x4ecdc4, 0x223344);
    gridHelper.position.y = -0.01;
    (gridHelper.material as THREE.Material).opacity = 0.25;
    (gridHelper.material as THREE.Material).transparent = true;
    axesGroup.add(gridHelper);

    scene.add(axesGroup);

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      meshRef.current = null;
      controlsRef.current = null;
    };
  }, [width, height]);

  // ─── 2. Build or Update Mesh Geometry using Math3D Router ───
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }

    // Delegate to Math3D Geometry Router
    const result = generate3DGeometry(options);
    setFormulaLabel(result.formulaLabel);

    if (!result.geometry.attributes.normal) {
      result.geometry.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.1,
      wireframe: isWireframe,
    });

    const mesh = new THREE.Mesh(result.geometry, material);
    meshRef.current = mesh;
    scene.add(mesh);
  }, [options, isWireframe]);

  // ─── 3. Update Wireframe without rebuilding scene ───
  useEffect(() => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshStandardMaterial).wireframe = isWireframe;
    }
  }, [isWireframe]);

  // ─── 4. Update Auto-Rotate without rebuilding scene ───
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Card Header Meta
  const getHeaderMeta = () => {
    switch (resolvedPlotType) {
      case 'parametric':
        return { icon: '🎨', badge: '3D Parametric Surface', defaultTitle: '3D Parametric Surface' };
      case 'implicit_isosurface':
        return { icon: '🌐', badge: '3D Implicit Isosurface', defaultTitle: '3D Algebraic Isosurface' };
      case 'linear_extrusion':
        return { icon: '🧊', badge: '3D Extrusion', defaultTitle: '3D Extruded Solid' };
      case 'bounded_surfaces':
        return { icon: '💎', badge: '3D CSG Solid', defaultTitle: '3D Volumetric CSG Solid' };
      case 'solid_of_revolution':
        return { icon: '🌀', badge: '3D Revolution', defaultTitle: '3D Solid of Revolution' };
      case 'surface':
      default:
        return { icon: '✨', badge: '3D WebGL Surface', defaultTitle: '3D Mathematical Surface' };
    }
  };

  const meta = getHeaderMeta();

  return (
    <div
      className="graph-3d-card interactive no-zoom"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        backgroundColor: 'rgba(19, 19, 36, 0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(78, 205, 196, 0.3)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 25,
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Card Header (Draggable) ── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ color: '#4ECDC4', fontSize: 13, cursor: 'grab' }} title="Drag to move 3D figure">
            ⠿
          </span>
          <span style={{ fontSize: 14 }}>{meta.icon}</span>
          <span
            style={{
              color: '#4ECDC4',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 180,
            }}
          >
            {title || meta.defaultTitle}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              backgroundColor: 'rgba(78, 205, 196, 0.2)',
              color: '#4ECDC4',
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.5px',
              flexShrink: 0,
            }}
          >
            {meta.badge}
          </span>
        </div>

        {/* Toolbar Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Zoom In & Out Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 4,
              padding: '1px 2px',
              gap: 2,
            }}
          >
            <button
              onClick={handleZoomIn}
              title="Zoom In 3D Graph (or scroll mouse wheel up)"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#4ecdc4',
                fontSize: 13,
                fontWeight: 700,
                padding: '2px 7px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              +
            </button>
            <span style={{ color: 'rgba(255, 255, 255, 0.2)', fontSize: 10 }}>|</span>
            <button
              onClick={handleZoomOut}
              title="Zoom Out 3D Graph (or scroll mouse wheel down)"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#4ecdc4',
                fontSize: 13,
                fontWeight: 700,
                padding: '2px 7px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              −
            </button>
          </div>

          {/* Wireframe toggle */}
          <button
            onClick={() => setIsWireframe(!isWireframe)}
            title="Toggle Wireframe / Solid"
            style={{
              background: isWireframe ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 4,
              color: isWireframe ? '#4ECDC4' : '#aaa',
              fontSize: 11,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            {isWireframe ? '🌐 Mesh' : '🧊 Solid'}
          </button>

          {/* Auto-Rotate toggle */}
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle Auto Rotation"
            style={{
              background: autoRotate ? 'rgba(255, 159, 67, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 4,
              color: autoRotate ? '#ff9f43' : '#aaa',
              fontSize: 11,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            {autoRotate ? '⏸️ Spin' : '▶️ Spin'}
          </button>

          {/* Reset Camera */}
          <button
            onClick={handleResetView}
            title="Reset 3D Camera View & Zoom"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 11,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            ↺ Reset
          </button>

          {/* Close button */}
          {onRemove && (
            <button
              onClick={() => onRemove(id)}
              title="Remove 3D Graph"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                fontSize: 14,
                cursor: 'pointer',
                padding: '0 4px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── 3D WebGL Canvas Mount ── */}
      <div
        ref={mountRef}
        className="three-canvas-container no-zoom"
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      />

      {/* ── Card Footer with Math Formula & Legend ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          fontSize: 11,
          fontFamily: "'Inter', monospace",
          color: '#aaa',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>Formula:</span>
          <span style={{ color: '#4ECDC4' }}>
            {formulaLabel || options.title || '3D Geometry'}
          </span>
        </div>

        {/* 3D Coordinate Axis Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ color: '#4ECDC4' }}>X</span>
          <span style={{ color: '#A8FF78' }}>Y</span>
          <span style={{ color: '#FF9F43' }}>Z (Up)</span>
        </div>
      </div>
    </div>
  );
};
