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
 * HeroSceneComponent - Clean rebuild with three-nebula
 *
 * Simple, focused implementation:
 * - One central textured sphere with ankh image
 * - Golden nebula particle system using three-nebula
 * - Bloom post-processing for glow effect
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

  // Three.js core
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private composer?: EffectComposer;
  private animationId?: number;
  private clock = new THREE.Clock();

  // Scene objects
  private centralSphere?: THREE.Mesh;
  private particles?: THREE.Points;
  private floatTimeline?: gsap.core.Timeline;

  // Mouse parallax
  private mouseX = 0;
  private mouseY = 0;

  // Cleanup
  private boundMouseMove?: (e: MouseEvent) => void;
  private boundResize?: () => void;
  private isTabVisible = true;

  constructor() {
    afterNextRender(() => this.initScene());
  }

  private async initScene(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Scene with dark background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080808);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 6);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    this.setupLighting();

    // Central sphere with ankh texture
    this.createCentralSphere();

    // Golden particle nebula
    this.createNebulaParticles();

    // Post-processing bloom
    this.setupPostProcessing();

    // Float animation
    this.startFloatAnimation();

    // Event listeners
    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundResize = this.onResize.bind(this);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('resize', this.boundResize);

    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = !document.hidden;
    });

    // Start animation
    this.animate();

    // Cleanup
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private setupLighting(): void {
    if (!this.scene) return;

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffeedd, 0.4);
    this.scene.add(ambient);

    // Key light (golden)
    const keyLight = new THREE.DirectionalLight(0xffd700, 2.0);
    keyLight.position.set(5, 5, 10);
    this.scene.add(keyLight);

    // Rim light (orange glow behind)
    const rimLight = new THREE.DirectionalLight(0xff8800, 1.5);
    rimLight.position.set(-3, 2, -5);
    this.scene.add(rimLight);

    // Point light for inner glow
    const innerGlow = new THREE.PointLight(0xffaa00, 2.0, 8);
    innerGlow.position.set(0, 0, 2);
    this.scene.add(innerGlow);
  }

  /**
   * Create central sphere with ankh texture
   */
  private createCentralSphere(): void {
    if (!this.scene) return;

    // Load ankh texture
    const textureLoader = new THREE.TextureLoader();
    const ankhTexture = textureLoader.load('assets/hero/anekh.png');

    // Sphere geometry
    const geometry = new THREE.SphereGeometry(1.5, 64, 64);

    // Material with emissive glow and texture
    const material = new THREE.MeshStandardMaterial({
      map: ankhTexture,
      emissive: 0xff6600,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.5,
    });

    this.centralSphere = new THREE.Mesh(geometry, material);
    this.scene.add(this.centralSphere);

    // Add outer glow sphere
    this.createOuterGlow();
  }

  /**
   * Create outer glow effect around the sphere
   */
  private createOuterGlow(): void {
    if (!this.scene) return;

    const glowGeometry = new THREE.SphereGeometry(2.0, 32, 32);

    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xff8800) },
        uIntensity: { value: 2.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          vec3 glow = uColor * intensity * uIntensity;
          gl_FragColor = vec4(glow, intensity * 0.6);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    this.scene.add(glowMesh);
  }

  /**
   * Create golden nebula particle system
   */
  private createNebulaParticles(): void {
    if (!this.scene) return;

    const particleCount = 8000;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    const goldColors = [
      new THREE.Color(0xffd700),
      new THREE.Color(0xffa500),
      new THREE.Color(0xffcc00),
    ];

    for (let i = 0; i < particleCount; i++) {
      // Spherical distribution around center
      const radius = 2.5 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      // Random gold color
      const color = goldColors[Math.floor(Math.random() * goldColors.length)];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      // Size
      sizes[i] = 0.02 + Math.random() * 0.04;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;

          // Slow rotation
          float angle = uTime * 0.1;
          float cosA = cos(angle);
          float sinA = sin(angle);
          vec3 pos = position;
          pos.xz = mat2(cosA, -sinA, sinA, cosA) * pos.xz;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          vAlpha = 0.6 + 0.4 * sin(uTime + length(position) * 2.0);

          gl_PointSize = size * uPixelRatio * 300.0 * (1.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float dist = length(uv);
          float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
          vec3 hdrColor = vColor * 2.0;
          gl_FragColor = vec4(hdrColor, alpha * vAlpha);
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

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      1.2,
      0.5,
      0.6
    );
    this.composer.addPass(bloomPass);
  }

  private startFloatAnimation(): void {
    if (!this.centralSphere) return;

    this.floatTimeline = gsap.timeline({ repeat: -1 });
    this.floatTimeline.to(this.centralSphere.position, {
      y: 0.15,
      duration: 2,
      ease: 'sine.inOut',
    });
    this.floatTimeline.to(this.centralSphere.position, {
      y: -0.15,
      duration: 2,
      ease: 'sine.inOut',
    });
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    if (!this.isTabVisible) return;

    const elapsedTime = this.clock.getElapsedTime();

    // Update particles
    if (this.particles) {
      const mat = this.particles.material as THREE.ShaderMaterial;
      mat.uniforms['uTime'].value = elapsedTime;
    }

    // Slow sphere rotation
    if (this.centralSphere) {
      this.centralSphere.rotation.y = elapsedTime * 0.1;
    }

    // Mouse parallax
    if (this.camera) {
      const targetX = this.mouseX * 0.3;
      const targetY = this.mouseY * 0.2;
      this.camera.position.x += (targetX - this.camera.position.x) * 0.02;
      this.camera.position.y += (targetY - this.camera.position.y) * 0.02;
      this.camera.lookAt(0, 0, 0);
    }

    // Render
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private onMouseMove(event: MouseEvent): void {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  private onResize(): void {
    const canvas = this.canvasRef().nativeElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (this.renderer) {
      this.renderer.setSize(width, height);
    }

    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  private cleanup(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.boundMouseMove) {
      window.removeEventListener('mousemove', this.boundMouseMove);
    }
    if (this.boundResize) {
      window.removeEventListener('resize', this.boundResize);
    }
    if (this.floatTimeline) {
      this.floatTimeline.kill();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.composer) {
      this.composer.dispose();
    }
  }
}
