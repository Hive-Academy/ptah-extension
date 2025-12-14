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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * HeroSceneComponent - Golden Ankh 3D Scene with Particle Halo
 *
 * COMPLEXITY LEVEL: 3 (Complex - Post-processing, procedural geometry, 500 particles)
 *
 * Features:
 * - Loads Golden Ankh GLTF model with procedural fallback
 * - 500-particle spherical halo with additive blending
 * - UnrealBloomPass post-processing for golden glow
 * - Radial gradient background (obsidian → gold)
 * - OrbitControls for user interaction (auto-rotate enabled)
 * - Mouse parallax for subtle camera movement
 * - Proper WebGL resource disposal
 *
 * Accessibility:
 * - Respects prefers-reduced-motion (disables auto-rotate)
 * - Canvas is decorative (aria-hidden handled by parent)
 *
 * Performance:
 * - 500 particles optimized with BufferGeometry
 * - Pixel ratio capped at 2x
 * - Post-processing with optimized bloom settings
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
  private controls?: OrbitControls;
  private ankhModel?: THREE.Object3D;
  private particles?: THREE.Points;
  private composer?: EffectComposer;
  private animationId?: number;
  private clock = new THREE.Clock();

  // Mouse parallax state
  private mouseX = 0;
  private mouseY = 0;
  private targetCameraX = 0;
  private targetCameraY = 0;

  constructor() {
    afterNextRender(() => this.initScene());
  }

  /**
   * Initialize Three.js scene with Egyptian island model
   */
  private async initScene(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    // Setup renderer with gradient background
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Setup scene with radial gradient background
    this.scene = new THREE.Scene();

    // Create radial gradient background (obsidian → gold glow)
    this.scene.background = this.createRadialGradientTexture();

    // Setup camera - positioned for Golden Ankh focal point
    this.camera = new THREE.PerspectiveCamera(
      65, // Wider FOV for dramatic effect
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    // Camera positioned to showcase Ankh and particle halo
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 0, 0);

    // Setup OrbitControls for user interaction
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false; // Disable zoom for landing page
    this.controls.enablePan = false; // Disable pan
    this.controls.autoRotate = !prefersReducedMotion; // Auto-rotate unless reduced motion
    this.controls.autoRotateSpeed = 0.5; // Rotation speed for Ankh showcase
    this.controls.minPolarAngle = Math.PI / 4; // Limit vertical rotation
    this.controls.maxPolarAngle = Math.PI / 2.2;
    // Target center of Ankh
    this.controls.target.set(0, 0, 0);

    // Add lighting
    this.setupLighting();

    // Load the Golden Ankh model
    await this.loadAnkhModel();

    // Add spherical particle halo (500 particles)
    this.addAnkhParticleHalo();

    // Setup post-processing bloom effect
    this.setupBloomEffect();

    // Event listeners
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);

    // Start animation loop
    this.animate();

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('resize', this.onResize);
      this.controls?.dispose();
      this.composer?.dispose();
      this.renderer?.dispose();
      // Dispose scene resources
      this.scene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m.dispose());
          } else {
            object.material?.dispose();
          }
        }
      });
    });
  }

  /**
   * Create radial gradient texture for background (obsidian → gold glow)
   */
  private createRadialGradientTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Radial gradient: gold glow center → dark fade → obsidian edge
    const gradient = ctx.createRadialGradient(256, 358, 0, 256, 358, 512);
    gradient.addColorStop(0, 'rgba(212, 175, 55, 0.15)'); // Gold glow center
    gradient.addColorStop(0.5, 'rgba(26, 26, 26, 1)'); // Dark fade
    gradient.addColorStop(1, 'rgba(10, 10, 10, 1)'); // Obsidian edge

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Setup dramatic lighting for the Golden Ankh scene
   */
  private setupLighting(): void {
    if (!this.scene) return;

    // Ambient light for base illumination
    const ambientLight = new THREE.AmbientLight(0xffeedd, 0.5);
    this.scene.add(ambientLight);

    // Main directional light - warm golden light from above
    const sunLight = new THREE.DirectionalLight(0xd4af37, 1.8);
    sunLight.position.set(10, 15, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    this.scene.add(sunLight);

    // Key light from front-left for Ankh highlight
    const keyLight = new THREE.DirectionalLight(0xfbbf24, 1.2);
    keyLight.position.set(-8, 8, 12);
    this.scene.add(keyLight);

    // Rim light from behind for golden edge glow
    const rimLight = new THREE.DirectionalLight(0xd4af37, 1.0);
    rimLight.position.set(-5, 5, -10);
    this.scene.add(rimLight);

    // Point light at Ankh center for inner glow (enhances bloom)
    const centerGlow = new THREE.PointLight(0xd4af37, 2.0, 10);
    centerGlow.position.set(0, 0, 0);
    this.scene.add(centerGlow);

    // Fill light from below for particle illumination
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(0, -5, 8);
    this.scene.add(fillLight);
  }

  /**
   * Load the Golden Ankh GLTF model with procedural fallback
   */
  private async loadAnkhModel(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      // Attempt to load Ankh GLTF model
      const gltf = await loader.loadAsync('/assets/3d-models/ankh.gltf');
      const ankh = gltf.scene;

      // Apply golden material to all meshes
      ankh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xd4af37,
            metalness: 1.0,
            roughness: 0.2,
          });
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Scale and position the Ankh
      ankh.scale.setScalar(2.5);
      ankh.position.set(0, 0, 0);
      this.scene!.add(ankh);
      this.ankhModel = ankh;

      console.log('[HeroScene] Golden Ankh model loaded successfully');
    } catch (error) {
      console.warn(
        '[HeroScene] Ankh model not found, using procedural fallback',
        error
      );
      // Fallback to procedural golden pyramid
      this.createProceduralAnkh();
    }
  }

  /**
   * Create procedural Golden Ankh geometry (fallback if GLTF fails)
   */
  private createProceduralAnkh(): void {
    if (!this.scene) return;

    // Simplified Ankh representation using golden pyramid
    const geometry = new THREE.ConeGeometry(1.5, 3, 4);
    const material = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 1.0,
      roughness: 0.2,
    });
    const pyramid = new THREE.Mesh(geometry, material);
    pyramid.rotation.y = Math.PI / 4; // Rotate 45 degrees for diamond shape
    pyramid.castShadow = true;
    pyramid.receiveShadow = true;
    this.scene.add(pyramid);
    this.ankhModel = pyramid;

    console.log('[HeroScene] Using procedural golden pyramid fallback');
  }

  /**
   * Add spherical particle halo around the Golden Ankh (500 particles)
   */
  private addAnkhParticleHalo(): void {
    if (!this.scene) return;

    const particleCount = 500;
    const positions = new Float32Array(particleCount * 3);

    // Spherical distribution using spherical coordinates
    for (let i = 0; i < particleCount; i++) {
      // Random spherical coordinates
      const theta = Math.random() * Math.PI * 2; // Azimuthal angle (0 to 2π)
      const phi = Math.acos(2 * Math.random() - 1); // Polar angle (0 to π)
      const radius = 3 + Math.random() * 2; // Radius 3-5 units

      // Convert spherical to Cartesian coordinates
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta); // x
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta); // y
      positions[i * 3 + 2] = radius * Math.cos(phi); // z
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xd4af37, // Golden color
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending, // Additive blending for glow effect
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);

    console.log('[HeroScene] 500-particle spherical halo created');
  }

  /**
   * Setup UnrealBloomPass post-processing for golden glow
   */
  private setupBloomEffect(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    // Create EffectComposer
    this.composer = new EffectComposer(this.renderer);

    // Add RenderPass (renders the scene)
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Add UnrealBloomPass for glow effect
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5, // strength - intensity of bloom
      0.4, // radius - spread of glow
      0.85 // threshold - brightness threshold for bloom
    );
    this.composer.addPass(bloomPass);

    console.log('[HeroScene] UnrealBloomPass post-processing enabled');
  }

  /**
   * Handle mouse move for subtle camera parallax
   */
  private readonly onMouseMove = (event: MouseEvent): void => {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  /**
   * Handle window resize
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
   * Animation loop
   */
  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    // Particle rotation and subtle emanation
    if (this.particles) {
      this.particles.rotation.y += 0.001; // Slow rotation
      // Optional: Add subtle pulsing effect to particle scale
      const time = Date.now() * 0.0005;
      const scale = 1.0 + Math.sin(time) * 0.05;
      this.particles.scale.setScalar(scale);
    }

    // Very subtle camera parallax based on mouse position
    this.targetCameraX = this.mouseX * 0.8;
    this.targetCameraY = this.mouseY * 0.4;

    if (this.controls) {
      // Add very subtle offset to camera based on mouse
      this.controls.target.x +=
        (this.targetCameraX * 0.3 - this.controls.target.x) * 0.005;

      // Update controls (handles auto-rotate and damping)
      this.controls.update();
    }

    // Render using composer (with bloom) or fallback to direct render
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
