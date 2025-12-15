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
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap';

/**
 * HeroComponent - Three.js Best Practices Implementation
 *
 * Features:
 * - Central textured sphere with ankh image
 * - High-density particle nebula (12,000 particles)
 * - Fresnel glow shader for rim lighting
 * - UnrealBloom post-processing for HDR glow
 * - GSAP float animation
 */
@Component({
  selector: 'ptah-hero',
  standalone: true,
  template: `
    <section class="relative min-h-screen overflow-hidden bg-[#080808]">
      <!-- Three.js Canvas -->
      <canvas #canvas class="absolute inset-0 w-full h-full z-0"></canvas>

      <!-- Content Overlay -->
      <div
        class="relative z-10 container mx-auto px-6 text-center flex flex-col items-center justify-center min-h-screen"
      >
        <h1
          class="font-display font-bold text-6xl md:text-7xl lg:text-8xl mb-6 gradient-text-gold"
        >
          Ancient Wisdom for Modern AI
        </h1>
        <p
          class="text-xl md:text-2xl mb-12 max-w-3xl mx-auto font-medium"
          style="color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.9), 0 4px 8px rgba(0,0,0,0.7);"
        >
          Transform Claude Code CLI into a native VS Code experience. Built by
          architects who understand your craft.
        </p>
        <div
          class="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <a
            href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-gradient-to-r from-secondary to-accent text-secondary-content px-8 py-4 rounded-xl text-lg font-semibold shadow-[0_0_40px_rgba(212,175,55,0.4)] hover:scale-105 transition-all"
          >
            Install Free
          </a>
          <a
            href="#demo"
            class="text-secondary hover:text-accent transition-colors flex items-center gap-2"
          >
            <span>See what it builds</span>
            <span class="animate-bounce">↓</span>
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroComponent {
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  // Three.js core
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private composer?: EffectComposer;
  private animationId?: number;
  private clock = new THREE.Clock();

  // Scene objects
  private centralSphere?: THREE.Mesh;
  private glowSphere?: THREE.Mesh;
  private particles?: THREE.Points;
  private floatTimeline?: gsap.core.Timeline;

  // Interaction
  private mouseX = 0;
  private mouseY = 0;
  private isTabVisible = true;

  constructor() {
    afterNextRender(() => this.initScene());
  }

  private async initScene(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080808);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 5);

    // Setup components
    this.setupLighting();
    this.createCentralSphere();
    this.createGlowSphere();
    this.createParticleNebula();
    this.setupPostProcessing();
    this.startFloatAnimation();

    // Events
    const onMouseMove = (e: MouseEvent) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    const onResize = () => this.handleResize();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = !document.hidden;
    });

    // Start animation
    this.animate();

    // Cleanup
    this.destroyRef.onDestroy(() => {
      if (this.animationId) cancelAnimationFrame(this.animationId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      this.floatTimeline?.kill();
      this.renderer?.dispose();
      this.composer?.dispose();
    });
  }

  private setupLighting(): void {
    if (!this.scene) return;

    // Ambient
    this.scene.add(new THREE.AmbientLight(0xffeedd, 0.3));

    // Key light
    const keyLight = new THREE.DirectionalLight(0xffd700, 2.0);
    keyLight.position.set(3, 3, 5);
    this.scene.add(keyLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xff8800, 1.5);
    rimLight.position.set(-3, 1, -3);
    this.scene.add(rimLight);

    // Point light for inner glow
    const innerLight = new THREE.PointLight(0xffaa00, 2.0, 6);
    innerLight.position.set(0, 0, 1);
    this.scene.add(innerLight);
  }

  /**
   * Central sphere with ankh texture
   */
  private createCentralSphere(): void {
    if (!this.scene) return;

    const geometry = new THREE.SphereGeometry(1.2, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('assets/hero/anekh.png');

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xff6600,
      emissiveIntensity: 0.6,
      metalness: 0.2,
      roughness: 0.4,
    });

    this.centralSphere = new THREE.Mesh(geometry, material);
    this.scene.add(this.centralSphere);
  }

  /**
   * Fresnel glow sphere (outer rim effect)
   */
  private createGlowSphere(): void {
    if (!this.scene) return;

    const geometry = new THREE.SphereGeometry(1.5, 32, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xff8800) },
        uIntensity: { value: 2.5 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-worldPos.xyz);
          gl_Position = projectionMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.0);
          vec3 glow = uColor * fresnel * uIntensity;
          gl_FragColor = vec4(glow, fresnel * 0.7);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.glowSphere = new THREE.Mesh(geometry, material);
    this.scene.add(this.glowSphere);
  }

  /**
   * High-density particle nebula using best practices
   */
  private createParticleNebula(): void {
    if (!this.scene) return;

    const count = 12000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    const goldPalette = [
      new THREE.Color(0xffd700),
      new THREE.Color(0xffa500),
      new THREE.Color(0xffcc33),
      new THREE.Color(0xffee88),
    ];

    for (let i = 0; i < count; i++) {
      // Spherical distribution with density falloff
      const radius = 1.8 + Math.pow(Math.random(), 0.6) * 3.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const color = goldPalette[Math.floor(Math.random() * goldPalette.length)];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = 0.015 + Math.random() * 0.03;
      randoms[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        attribute float aRandom;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;

          // Slow orbital rotation
          float angle = uTime * 0.08 * (0.5 + aRandom * 0.5);
          float c = cos(angle);
          float s = sin(angle);
          vec3 pos = position;
          pos.xz = mat2(c, -s, s, c) * pos.xz;

          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          float dist = length(position);
          vAlpha = 0.4 + 0.6 * (1.0 - smoothstep(1.8, 5.0, dist));
          vAlpha *= 0.7 + 0.3 * sin(uTime * 2.0 + aRandom * 10.0);

          gl_PointSize = size * uPixelRatio * 250.0 * (1.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float alpha = 1.0 - smoothstep(0.3, 0.5, d);
          vec3 hdr = vColor * 2.0;
          gl_FragColor = vec4(hdr, alpha * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  private setupPostProcessing(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    const canvas = this.canvasRef().nativeElement;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      1.0,
      0.4,
      0.7
    );
    this.composer.addPass(bloom);
  }

  private startFloatAnimation(): void {
    if (!this.centralSphere || !this.glowSphere) return;

    this.floatTimeline = gsap.timeline({ repeat: -1 });
    this.floatTimeline
      .to([this.centralSphere.position, this.glowSphere.position], {
        y: 0.12,
        duration: 2.5,
        ease: 'sine.inOut',
      })
      .to([this.centralSphere.position, this.glowSphere.position], {
        y: -0.12,
        duration: 2.5,
        ease: 'sine.inOut',
      });
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    if (!this.isTabVisible) return;

    const time = this.clock.getElapsedTime();

    // Update particles
    if (this.particles) {
      (this.particles.material as THREE.ShaderMaterial).uniforms[
        'uTime'
      ].value = time;
    }

    // Slow sphere rotation
    if (this.centralSphere) {
      this.centralSphere.rotation.y = time * 0.08;
    }

    // Mouse parallax
    if (this.camera) {
      this.camera.position.x +=
        (this.mouseX * 0.3 - this.camera.position.x) * 0.02;
      this.camera.position.y +=
        (this.mouseY * 0.2 - this.camera.position.y) * 0.02;
      this.camera.lookAt(0, 0, 0);
    }

    this.composer?.render();
  };

  private handleResize(): void {
    const canvas = this.canvasRef().nativeElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer?.setSize(w, h);
    this.composer?.setSize(w, h);
  }
}
