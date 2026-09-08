import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type RenderDebugMode = 'lit' | 'solid' | 'wireframe' | 'normals';

export interface VisualSettings {
  version: 8;
  postEnabled: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  contrast: number;
  saturation: number;
  vignette: number;
  renderMode: RenderDebugMode;
  // ── Screen-space ambient occlusion (GTAO) ──
  aoEnabled: boolean;
  aoIntensity: number;
  aoRadius: number;
}

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  version: 8,
  postEnabled: true,
  bloomEnabled: true,
  bloomStrength: 0.045,
  bloomRadius: 0.28,
  bloomThreshold: 0.2,
  contrast: 1,
  saturation: 0.9,
  vignette: 0,
  renderMode: 'lit',
  aoEnabled: true,
  aoIntensity: 0.6,
  aoRadius: 1,
};

/** Adopt the new look only for old default values; deliberate player choices
 * such as disabled AO or zero vignette survive the material/visibility migration.
 * Legacy storage has no per-field intent flag: only exact old defaults migrate. */
export function migrateVisualSettings(saved: unknown): VisualSettings {
  const raw = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  if (raw['version'] !== 6 && raw['version'] !== 7 && raw['version'] !== 8)
    return { ...DEFAULT_VISUAL_SETTINGS };
  const old = {
    bloomStrength: 0.1,
    bloomRadius: 0.37,
    bloomThreshold: 0.045,
    contrast: 1,
    saturation: 1,
    vignette: 0.2,
    aoIntensity: 0.5,
    aoRadius: 1,
  };
  const n = (key: keyof typeof old, min: number, max: number): number => {
    const value = raw[key],
      fallback = DEFAULT_VISUAL_SETTINGS[key];
    if (raw['version'] === 6 && value === old[key]) return fallback;
    if (
      raw['version'] === 7 &&
      ((key === 'contrast' && value === 1.04) || (key === 'vignette' && value === 0.06))
    )
      return fallback;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  };
  const b = (key: 'postEnabled' | 'bloomEnabled' | 'aoEnabled'): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_VISUAL_SETTINGS[key];
  const mode = raw['renderMode'];
  return {
    ...DEFAULT_VISUAL_SETTINGS,
    postEnabled: b('postEnabled'),
    bloomEnabled: b('bloomEnabled'),
    aoEnabled: b('aoEnabled'),
    bloomStrength: n('bloomStrength', 0, 1),
    bloomRadius: n('bloomRadius', 0, 1),
    bloomThreshold: n('bloomThreshold', 0, 0.25),
    contrast: n('contrast', 0.8, 1.2),
    saturation: n('saturation', 0, 1.5),
    vignette: n('vignette', 0, 0.5),
    aoIntensity: n('aoIntensity', 0, 1),
    aoRadius: n('aoRadius', 0.3, 2),
    renderMode:
      mode === 'lit' || mode === 'solid' || mode === 'wireframe' || mode === 'normals'
        ? mode
        : 'lit',
  };
}

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
      // Composer input is linear HDR, not display RGB: an additive 0.5
      // pivot crushes dim surfaces/fog below zero. Scale luminance around
      // linear middle gray instead, preserving true black and RGB ratios.
      color.rgb = max(color.rgb, vec3(0.0));
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb *= pow(max(luma, 0.000001) / 0.18, contrast - 1.0);
      luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
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
  private gtao: GTAOPass;
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
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // GTAOPass hides Points/Lines during its depth/normal prepass but NOT
    // Sprites — additive halo glints would land in the AO depth buffer as
    // solid squares and get boxed with occlusion. Extend its hide-list.
    const gtaoInternals = this.gtao as unknown as {
      _overrideVisibility: () => void;
      _visibilityCache: THREE.Object3D[];
    };
    gtaoInternals._overrideVisibility = () => {
      const cache = gtaoInternals._visibilityCache;
      scene.traverse((object) => {
        const o = object as THREE.Object3D & {
          isPoints?: boolean;
          isLine?: boolean;
          isLine2?: boolean;
          isSprite?: boolean;
        };
        if ((o.isPoints || o.isLine || o.isLine2 || o.isSprite) && o.visible) {
          o.visible = false;
          cache.push(o);
        }
      });
    };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(size, 0.2, 0.3, 0.1);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.apply(DEFAULT_VISUAL_SETTINGS);
  }

  apply(settings: VisualSettings): void {
    this.settings = settings;
    this.gtao.enabled = settings.postEnabled && settings.aoEnabled;
    this.gtao.blendIntensity = THREE.MathUtils.clamp(settings.aoIntensity, 0, 1);
    this.gtao.updateGtaoMaterial({ radius: THREE.MathUtils.clamp(settings.aoRadius, 0.3, 2) });
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
    // Inspection modes (wireframe/solid/normals) must bypass the
    // composer regardless of the post toggle: GTAOPass's prepass swaps
    // scene.overrideMaterial and restores it to NULL, silently killing
    // the debug override after one frame.
    if (this.settings.postEnabled && this.settings.renderMode === 'lit') {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.composer.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
    this.finish.dispose();
  }
}
