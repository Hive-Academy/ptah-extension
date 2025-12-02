import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  afterNextRender,
  DestroyRef,
  inject,
} from '@angular/core';
import * as THREE from 'three';

/**
 * HeroSceneComponent - Egyptian-themed Three.js scene with gold wireframe pyramid
 *
 * COMPLEXITY LEVEL: 2 (Medium - state + 3D scene management)
 *
 * SOLID Principles Applied:
 * - Single Responsibility: Manages only the hero 3D scene rendering
 * - Composition: Uses Three.js objects composed together (pyramid, particles, lights)
 * - Dependency Inversion: Relies on Three.js abstractions, not concrete implementations
 *
 * Patterns Applied:
 * - Direct Three.js Integration (from research-report.md findings)
 * - afterNextRender for DOM-dependent initialization
 * - DestroyRef for cleanup lifecycle management
 *
 * Accessibility:
 * - Respects prefers-reduced-motion media query
 * - Canvas role handled by parent component
 * - Decorative animation only (no critical content)
 *
 * Performance:
 * - Pixel ratio capped at 2x for performance
 * - Proper WebGL resource disposal on destroy
 * - RAF animation loop with proper cleanup
 */
@Component({
  selector: 'app-hero-scene',
  standalone: true,
  template: `<canvas #canvas class="absolute inset-0 w-full h-full"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroSceneComponent {
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  // Three.js scene objects
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private pyramid?: THREE.Mesh;
  private particles?: THREE.Points;
  private animationId?: number;

  // Mouse parallax state
  private mouseX = 0;
  private mouseY = 0;

  constructor() {
    afterNextRender(() => this.initScene());
  }

  /**
   * Initialize Three.js scene with Egyptian theme
   * ACCESSIBILITY: Respects prefers-reduced-motion
   */
  private initScene(): void {
    // Check reduced motion preference - skip 3D if user prefers
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const canvas = this.canvasRef().nativeElement;

    // Setup renderer with alpha for transparent background
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    // Cap pixel ratio at 2 for performance (no need for 3x on high-end displays)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Setup scene with transparent background
    this.scene = new THREE.Scene();

    // Setup camera with 60-degree FOV for natural perspective
    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.z = 15;

    // Create gold wireframe pyramid (Egyptian theme)
    const pyramidGeometry = new THREE.ConeGeometry(3, 4, 4);
    const pyramidMaterial = new THREE.MeshBasicMaterial({
      color: 0xd4af37, // Gold color (#d4af37)
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    this.pyramid = new THREE.Mesh(pyramidGeometry, pyramidMaterial);
    this.scene.add(this.pyramid);

    // Create floating particles for mystical atmosphere
    const particleCount = 150;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    // Distribute particles randomly in 3D space
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 30; // X
      positions[i + 1] = (Math.random() - 0.5) * 30; // Y
      positions[i + 2] = (Math.random() - 0.5) * 20; // Z
    }

    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xd4af37, // Gold particles
      size: 0.1,
      transparent: true,
      opacity: 0.6,
    });
    this.particles = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(this.particles);

    // Add ambient light for subtle illumination (blue theme from visual spec)
    const ambientLight = new THREE.AmbientLight(0x1e3a8a, 0.3); // blue-900
    this.scene.add(ambientLight);

    // Mouse move listener for parallax effect
    window.addEventListener('mousemove', this.onMouseMove);

    // Resize listener for responsive canvas
    window.addEventListener('resize', this.onResize);

    // Start animation loop
    this.animate();

    // Cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      // Cancel animation frame
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }

      // Remove event listeners
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('resize', this.onResize);

      // Dispose Three.js resources
      this.renderer?.dispose();
      pyramidGeometry.dispose();
      pyramidMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
    });
  }

  /**
   * Handle mouse move for parallax camera effect
   * Normalizes mouse position to [-1, 1] range
   */
  private readonly onMouseMove = (event: MouseEvent): void => {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  /**
   * Handle window resize to maintain aspect ratio
   */
  private readonly onResize = (): void => {
    const canvas = this.canvasRef().nativeElement;
    if (this.camera) {
      this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.updateProjectionMatrix();
    }
    this.renderer?.setSize(canvas.clientWidth, canvas.clientHeight);
  };

  /**
   * Animation loop - updates pyramid rotation, particle animation, and camera parallax
   * Uses RAF for smooth 60fps animation
   */
  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    // Rotate pyramid slowly on Y and X axes for dynamic effect
    if (this.pyramid) {
      this.pyramid.rotation.y += 0.003; // Slow Y rotation
      this.pyramid.rotation.x += 0.001; // Subtle X tilt
    }

    // Rotate particle field for floating atmosphere
    if (this.particles) {
      this.particles.rotation.y += 0.0005; // Very slow drift
    }

    // Mouse parallax on camera for interactive depth
    // Smooth interpolation (lerp) for natural movement
    if (this.camera) {
      this.camera.position.x +=
        (this.mouseX * 2 - this.camera.position.x) * 0.02;
      this.camera.position.y +=
        (-this.mouseY * 2 - this.camera.position.y) * 0.02;
      this.camera.lookAt(0, 0, 0); // Always look at pyramid
    }

    // Render scene
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
