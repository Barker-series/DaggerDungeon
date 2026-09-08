import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';

// Extract the actual production shader, not a duplicated CPU implementation.
const source = readFileSync('src/engine/PostProcessing.ts', 'utf8');
const fragment = source.match(/fragmentShader: `([\s\S]*?)`/)![1]!;
const fog = new THREE.Color(0x171b1c);
const crushed = fog.toArray().map((c) => (c - 0.5) * 1.04 + 0.5);
assert.ok(
  crushed.every((c) => c < 0),
  'historical default fog reproduces HDR black clipping',
);
console.log('Old linear fog RGB:', fog.toArray(), 'old contrast output:', crushed);
const shaders = [
  {
    name: 'actual-distance-finish',
    vertex: `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,
    fragment:
      `#version 300 es
precision highp float;
#define varying in
#define texture2D texture
out vec4 resultColor;
#define gl_FragColor resultColor
uniform vec4 probeColor;
` + fragment.replace('texture2D(tDiffuse, vUv)', 'probeColor'),
  },
];
const result = spawnSync('python', ['tools/probe-distance-finish.py'], {
  input: JSON.stringify(shaders),
  encoding: 'utf8',
});
console.log(result.stdout);
assert.equal(result.status, 0, result.stderr);
