import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { setMaxAnisotropy } from './textures.js';
import { clamp } from './util.js';

// Guards the bloom chain: a single NaN/Inf pixel (e.g. an extreme specular in a
// half-float target) would otherwise smear across the whole frame.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = min(c, vec4(48.0));
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.045 },
    uCA: { value: 0.0012 },
    uDrunk: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 0.8, 0.3, 0) },
    uSaturation: { value: 1.08 },
    uWarm: { value: 0.035 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uCA, uDrunk, uSaturation, uWarm;
    uniform vec4 uFlash;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*0.0) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uDrunk > 0.0) {
        uv += vec2(sin(uv.y*9.0 + uTime*1.7), cos(uv.x*7.0 + uTime*1.3)) * 0.006 * uDrunk;
      }
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      vec2 off = dc * r2 * (uCA + uDrunk*0.01);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      if (uDrunk > 0.0) {
        vec3 ghost = texture2D(tDiffuse, uv + vec2(sin(uTime*0.9), cos(uTime*1.1))*0.012*uDrunk).rgb;
        col = mix(col, ghost, 0.35*uDrunk);
      }
      // gentle split-tone grade: warm highlights, teal-ish shadows
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSaturation);
      col += vec3(uWarm, uWarm*0.4, -uWarm*0.6) * smoothstep(0.35, 1.0, l);
      col += vec3(-0.008, 0.004, 0.014) * (1.0 - smoothstep(0.0, 0.35, l));
      // vignette
      float vig = smoothstep(0.95, 0.25, length(dc * vec2(1.15, 1.0)) * uVignette);
      col *= mix(0.55, 1.0, vig);
      // flash overlay (win / loss)
      col = mix(col, uFlash.rgb, uFlash.a * (0.35 + 0.65*(1.0-vig)));
      // film grain
      float n = rnd(uv * vec2(1920.0,1080.0) + fract(uTime*7.13)*100.0) - 0.5;
      col += n * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x050304, 1);
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.quality = 'high';
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.scale = 1; // dynamic resolution factor
    this.minScale = 0.55;
    this.frameTimes = [];
    this.autoQuality = true;
    this.scene = null; this.camera = null;
    this.composer = null;
  }

  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = this.r;
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.sanitize);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    const r = this.r;
    if (q === 'low') {
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1) * 0.75;
      r.shadowMap.enabled = false;
      this.bloom.enabled = true; this.bloom.strength = 0.45;
      this.fxaa.enabled = true;
    } else if (q === 'medium') {
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.25);
      r.shadowMap.enabled = true;
      this.bloom.enabled = true;
      this.fxaa.enabled = true;
    } else {
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.75);
      r.shadowMap.enabled = true;
      this.bloom.enabled = true;
      this.fxaa.enabled = true;
    }
    if (this.scene) this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.needsUpdate = true)); } });
    this.scale = 1;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = (this.baseDpr || this.dpr) * this.scale;
    this.r.setPixelRatio(dpr);
    this.r.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
      this.bloom.resolution.set(w / 2, h / 2);
    }
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  /** Dynamic resolution: keep frame times near target by scaling the render resolution. */
  adapt(dt) {
    if (!this.autoQuality) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.scale;
    if (avg > 1 / 42) s -= 0.1; else if (avg < 1 / 57 && s < 1) s += 0.05;
    s = clamp(s, this.minScale, 1);
    if (Math.abs(s - this.scale) > 0.001) {
      this.scale = s;
      this.resize();
      if (s <= this.minScale + 0.001 && this.quality === 'high') this.setQuality('medium');
      else if (s <= this.minScale + 0.001 && this.quality === 'medium') this.setQuality('low');
    }
  }

  render(time) {
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }
}
