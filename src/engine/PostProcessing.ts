import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type RenderDebugMode = 'lit' | 'solid' | 'wireframe' | 'normals';

export interface VisualSettings {
  version: 4;
  postEnabled: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  contrast: number;
  saturation: number;
  vignette: number;
  renderMode: RenderDebugMode;
}

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  version: 4,
  postEnabled: true,
  bloomEnabled: true,
  bloomStrength: 0.1,
  bloomRadius: 0.37,
  bloomThreshold: 0.045,
  contrast: 1,
  saturation: 1,
  vignette: 0.2,
  renderMode: 'lit',
};

const FINISH_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      vec2 centered = vUv - 0.5;
      float edge = smoothstep(0.18, 0.72, dot(centered, centered) * 1.7);
      color.rgb *= 1.0 - edge * vignette;
      gl_FragColor = color;
    }
  `,
};

export class PostProcessing {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private settings = DEFAULT_VISUAL_SETTINGS;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size, 0.2, 0.3, 0.1);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.apply(DEFAULT_VISUAL_SETTINGS);
  }

  apply(settings: VisualSettings): void {
    this.settings = settings;
    this.bloom.enabled = settings.postEnabled && settings.bloomEnabled;
    this.bloom.strength = THREE.MathUtils.clamp(settings.bloomStrength, 0, 1);
    this.bloom.radius = THREE.MathUtils.clamp(settings.bloomRadius, 0, 1);
    this.bloom.threshold = THREE.MathUtils.clamp(settings.bloomThreshold, 0, 0.25);
    this.finish.enabled = settings.postEnabled;
    this.finish.uniforms['contrast']!.value = settings.contrast;
    this.finish.uniforms['saturation']!.value = settings.saturation;
    this.finish.uniforms['vignette']!.value = settings.vignette;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(dt: number): void {
    if (this.settings.postEnabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.finish.dispose();
  }
}
