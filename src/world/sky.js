// sky.js — a lid on the world.
//
// A flat background colour is honest and boring: there is nothing to tell you
// which way you are facing, and nothing moves. A dome costs one draw call and
// gives the meadow a horizon, a sun side and clouds that drift, which between
// them do more for the feel of being outdoors than any amount of ground detail.
//
// The clouds are value noise in the fragment shader rather than a texture:
// nothing to load, nothing to tile visibly, and the drift is free.

import * as THREE from 'three';

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uLow, uHigh, uCloud;
  uniform vec3 uSun;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 sky = mix(uLow, uHigh, pow(up, 0.65));

    // A warm lift towards the sun, so the world has a bright side.
    float toSun = max(dot(d, normalize(uSun)), 0.0);
    sky += vec3(0.16, 0.11, 0.04) * pow(toSun, 6.0);

    // Clouds live on a plane above the camera: project the view direction onto
    // it, which keeps them flat overhead and stretched at the horizon the way
    // real ones look.
    if (d.y > 0.02) {
      vec2 p = d.xz / max(d.y, 0.02) * 0.6 + vec2(uTime * 0.006, uTime * 0.0035);
      float f = fbm(p * 1.15);
      float mask = smoothstep(0.52, 0.78, f) * smoothstep(0.02, 0.22, d.y);
      float body = smoothstep(0.50, 0.92, f);
      vec3 lit = mix(uCloud * 0.78, uCloud, body);
      sky = mix(sky, lit, mask * 0.92);
    }
    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

export function buildSky(scene, sunDirection) {
  const uniforms = {
    uTime: { value: 0 },
    uLow: { value: new THREE.Color(0xbfe0f2) },
    uHigh: { value: new THREE.Color(0x5aa6dd) },
    uCloud: { value: new THREE.Color(0xffffff) },
    uSun: { value: sunDirection.clone().normalize() },
  };
  const mesh = new THREE.Mesh(
    // Smaller than the camera's far plane, or the dome is clipped away and the
    // sky renders as the void behind everything. It follows the camera, so its
    // radius is a rendering detail and not a distance anyone can measure.
    new THREE.SphereGeometry(320, 32, 20),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }),
  );
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  scene.add(mesh);
  scene.background = null;      // the dome is the background now

  return {
    mesh,
    update(dt, cameraPosition) {
      uniforms.uTime.value += dt;
      mesh.position.copy(cameraPosition);   // the sky never gets closer
    },
  };
}
