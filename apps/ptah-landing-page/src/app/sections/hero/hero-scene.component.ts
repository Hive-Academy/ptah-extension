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

/**
 * HeroSceneComponent - Egyptian Island 3D Scene
 *
 * COMPLEXITY LEVEL: 3 (Complex - GLTF model loading, lighting, controls)
 *
 * Features:
 * - Loads Egyptian island GLTF model with textures
 * - Ambient + directional + point lighting for dramatic effect
 * - OrbitControls for user interaction (auto-rotate enabled)
 * - Mouse parallax for subtle camera movement
 * - Gradient background matching theme
 * - Proper WebGL resource disposal
 *
 * Accessibility:
 * - Respects prefers-reduced-motion (disables auto-rotate)
 * - Canvas is decorative (aria-hidden handled by parent)
 *
 * Performance:
 * - Pixel ratio capped at 2x
 * - Damping on controls for smooth interaction
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
  private model?: THREE.Group;
  private animationId?: number;
  private mixer?: THREE.AnimationMixer;
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

    // Setup scene with gradient background
    this.scene = new THREE.Scene();

    // Create gradient background (dark brown/bronze theme)
    const bgColor1 = new THREE.Color(0x1a1410); // Dark brown (bottom)
    const bgColor2 = new THREE.Color(0x3d2d24); // Medium brown (top)
    this.scene.background = this.createGradientTexture(bgColor1, bgColor2);

    // Setup camera - positioned for dramatic wide-angle background view
    // Island fills viewport as an immersive background
    this.camera = new THREE.PerspectiveCamera(
      65, // Wider FOV for more dramatic effect
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    // Camera positioned closer and lower for immersive background feel
    this.camera.position.set(0, 6, 10);
    this.camera.lookAt(0, 2, 0);

    // Setup OrbitControls for user interaction
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false; // Disable zoom for landing page
    this.controls.enablePan = false; // Disable pan
    this.controls.autoRotate = !prefersReducedMotion; // Auto-rotate unless reduced motion
    this.controls.autoRotateSpeed = 0.3; // Slower rotation for background
    this.controls.minPolarAngle = Math.PI / 4; // Limit vertical rotation
    this.controls.maxPolarAngle = Math.PI / 2.2;
    // Target center of island for smooth rotation
    this.controls.target.set(0, 2, 0);

    // Add lighting
    this.setupLighting();

    // Load the GLTF model
    await this.loadModel();

    // Add floating particles for mystical atmosphere
    this.addParticles();

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
   * Create gradient texture for background
   */
  private createGradientTexture(
    color1: THREE.Color,
    color2: THREE.Color
  ): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, `#${color2.getHexString()}`);
    gradient.addColorStop(1, `#${color1.getHexString()}`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Setup dramatic lighting for the Egyptian scene (large background)
   */
  private setupLighting(): void {
    if (!this.scene) return;

    // Ambient light for base illumination - stronger for larger scene
    const ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
    this.scene.add(ambientLight);

    // Main directional light (sun) - warm golden light
    const sunLight = new THREE.DirectionalLight(0xffd89b, 2.0);
    sunLight.position.set(15, 30, 15);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -40;
    sunLight.shadow.camera.right = 40;
    sunLight.shadow.camera.top = 40;
    sunLight.shadow.camera.bottom = -40;
    this.scene.add(sunLight);

    // Torch lights - orange/fire glow (scaled for larger model)
    const torchPositions = [
      { x: -8, y: 10, z: 4 },
      { x: 8, y: 10, z: 4 },
      { x: -6, y: 10, z: -6 },
      { x: 6, y: 10, z: -6 },
    ];

    torchPositions.forEach((pos) => {
      const torchLight = new THREE.PointLight(0xff6b35, 3, 20);
      torchLight.position.set(pos.x, pos.y, pos.z);
      this.scene!.add(torchLight);
    });

    // Rim light from behind for dramatic effect
    const rimLight = new THREE.DirectionalLight(0x4fc3f7, 0.8);
    rimLight.position.set(-10, 10, -20);
    this.scene.add(rimLight);

    // Water reflection light (blue tint from below)
    const waterLight = new THREE.PointLight(0x4dd0e1, 1.2, 30);
    waterLight.position.set(0, -5, 0);
    this.scene.add(waterLight);

    // Additional fill light from front to brighten the scene
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(0, 5, 20);
    this.scene.add(fillLight);
  }

  /**
   * Load the Egyptian island GLTF model
   */
  private async loadModel(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      const gltf = await loader.loadAsync('/assets/3d-models/scene.gltf');
      this.model = gltf.scene;

      // Scale and position the model - massive scale for background effect
      this.model.scale.set(4.5, 4.5, 4.5);
      // Position to fill the viewport as immersive background
      this.model.position.set(0, -2, -3);

      // Enable shadows for all meshes
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.scene?.add(this.model);

      // Setup animations if any
      if (gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(this.model);
        gltf.animations.forEach((clip) => {
          this.mixer?.clipAction(clip).play();
        });
      }
    } catch (error) {
      console.error('[HeroScene] Failed to load 3D model:', error);
      // Fallback: show a simple placeholder if model fails to load
      this.addFallbackPyramid();
    }
  }

  /**
   * Fallback pyramid if GLTF fails to load
   */
  private addFallbackPyramid(): void {
    if (!this.scene) return;

    const geometry = new THREE.ConeGeometry(3, 4, 4);
    const material = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.6,
      roughness: 0.4,
    });
    const pyramid = new THREE.Mesh(geometry, material);
    pyramid.position.y = 2;
    pyramid.castShadow = true;
    this.scene.add(pyramid);
  }

  /**
   * Add floating golden particles for mystical atmosphere (scaled for large background)
   */
  private addParticles(): void {
    if (!this.scene) return;

    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 60;
      positions[i + 1] = Math.random() * 25 + 2;
      positions[i + 2] = (Math.random() - 0.5) * 60;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffd700,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);
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

    const delta = this.clock.getDelta();

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Very subtle camera parallax based on mouse position (slowed down)
    this.targetCameraX = this.mouseX * 0.8;
    this.targetCameraY = this.mouseY * 0.4;

    if (this.controls) {
      // Add very subtle offset to camera based on mouse (much slower lerp)
      this.controls.target.x +=
        (this.targetCameraX * 0.3 - this.controls.target.x) * 0.005;

      // Update controls (handles auto-rotate and damping)
      this.controls.update();
    }

    // Render
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
