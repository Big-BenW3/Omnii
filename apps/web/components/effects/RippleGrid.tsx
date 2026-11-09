"use client";

import { useEffect, useRef, useState } from "react";
import "./RippleGrid.css";

export interface RippleGridProps {
  color?: string;
  variant?: "lines" | "dots";
  cellSize?: number;
  lineWidth?: number;
  glow?: number;
  rippleStrength?: number;
  rippleSpeed?: number;
  rippleSize?: number;
  autoRipple?: "center" | "off";
  rippleInterval?: number;
  tilt?: number;
  rotation?: number;
  mouseInteraction?: boolean;
  clickRipple?: boolean;
  intro?: boolean;
  fade?: number;
  opacity?: number;
  lightMode?: boolean;
  paused?: boolean;
  className?: string;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const MAX_RIPPLES = 8;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uResolution;
uniform vec3 uColor;
uniform float uTime;
uniform float uCellSize;
uniform float uLineWidth;
uniform float uGlow;
uniform float uRippleStrength;
uniform float uRippleSpeed;
uniform float uRippleSize;
uniform float uTilt;
uniform float uRotation;
uniform float uOpacity;
uniform float uFade;
uniform float uLightMode;
uniform float uVariant;
uniform float uIntro;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform vec2 uRippleOrigin[${MAX_RIPPLES}];
uniform float uRippleStart[${MAX_RIPPLES}];

#define PI 3.14159265359
#define TAU 6.28318530718

vec2 rotate(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * p;
}

// A single ripple's displacement (pushes the grid) and glow contribution.
void applyRipple(vec2 p, vec2 origin, float age, inout vec2 disp, inout float glowAcc) {
  if (age < 0.0) return;
  float d = distance(p, origin);
  float front = age * uRippleSpeed * 0.6;
  float band = exp(-pow((d - front) / max(uRippleSize * 0.18, 0.02), 2.0));
  float decay = exp(-age * 0.55);
  float wave = sin(d * (10.0 / max(uRippleSize, 0.05)) - age * uRippleSpeed * TAU * 0.5);
  vec2 dir = d > 0.0001 ? (p - origin) / d : vec2(0.0);
  disp += dir * wave * band * decay * uRippleStrength * 0.035;
  glowAcc += band * decay;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;

  p = rotate(p, uRotation * PI / 180.0);
  p.y += p.x * tan(uTilt * PI / 180.0) * 0.5;

  vec2 disp = vec2(0.0);
  float glowAcc = 0.0;

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    float age = uTime - uRippleStart[i];
    applyRipple(p, uRippleOrigin[i], uRippleStart[i] < 0.0 ? -1.0 : age, disp, glowAcc);
  }
  if (uMouseActive > 0.5) {
    float d = distance(p, uMouse);
    float localGlow = exp(-d * 5.0) * 0.5;
    disp += (d > 0.0001 ? (p - uMouse) / d : vec2(0.0)) * localGlow * uRippleStrength * 0.02;
    glowAcc += localGlow * 0.6;
  }

  vec2 gp = (p + disp) * (uResolution.y / max(uCellSize, 1.0)) * 0.5;

  float mask;
  if (uVariant > 0.5) {
    vec2 cell = fract(gp) - 0.5;
    float dot = 1.0 - smoothstep(0.0, uLineWidth * 0.18, length(cell));
    mask = dot;
  } else {
    vec2 cell = abs(fract(gp) - 0.5) * 2.0;
    vec2 edge = 1.0 - smoothstep(0.0, uLineWidth * 0.08, 1.0 - cell);
    mask = max(edge.x, edge.y);
  }

  float r = length(p);
  float fadeMask = 1.0 - smoothstep(0.2, mix(1.6, 0.5, clamp(uFade, 0.0, 1.0)), r);
  float introMask = smoothstep(0.0, 1.0, uIntro * 1.6 - r * 0.6);

  float alpha = (mask * 0.5 + glowAcc * uGlow) * fadeMask * introMask * uOpacity;
  vec3 base = uLightMode > 0.5 ? mix(uColor, vec3(0.05), 0.2) : uColor;
  outColor = vec4(base, clamp(alpha, 0.0, 1.0));
}`;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(info ?? "shader compile failed");
  }
  return sh;
}

/**
 * Animated WebGL2 grid: subtle lines that ripple outward from clicks, the
 * pointer, and an idle auto-pulse. Falls back to a static CSS grid when
 * WebGL2 is unavailable or the viewer prefers reduced motion.
 */
export default function RippleGrid({
  color = "#9B91FF",
  variant = "lines",
  cellSize = 56,
  lineWidth = 0.8,
  glow = 0.5,
  rippleStrength = 0.7,
  rippleSpeed = 0.8,
  rippleSize = 1.1,
  autoRipple = "center",
  rippleInterval = 3.6,
  tilt = 8,
  rotation = 0,
  mouseInteraction = true,
  clickRipple = true,
  intro = true,
  fade = 0.75,
  opacity = 0.25,
  lightMode = false,
  paused = false,
  className = "",
}: RippleGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supported, setSupported] = useState(true);
  const propsRef = useRef({
    color, variant, cellSize, lineWidth, glow, rippleStrength, rippleSpeed, rippleSize,
    autoRipple, rippleInterval, tilt, rotation, mouseInteraction, clickRipple, fade, opacity, lightMode, paused,
  });
  propsRef.current = {
    color, variant, cellSize, lineWidth, glow, rippleStrength, rippleSpeed, rippleSize,
    autoRipple, rippleInterval, tilt, rotation, mouseInteraction, clickRipple, fade, opacity, lightMode, paused,
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      setSupported(false);
      return;
    }

    let program: WebGLProgram;
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
      }
    } catch (e) {
      console.warn("RippleGrid: WebGL init failed, using fallback", e);
      setSupported(false);
      return;
    }

    const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      resolution: u("uResolution"),
      color: u("uColor"),
      time: u("uTime"),
      cellSize: u("uCellSize"),
      lineWidth: u("uLineWidth"),
      glow: u("uGlow"),
      rippleStrength: u("uRippleStrength"),
      rippleSpeed: u("uRippleSpeed"),
      rippleSize: u("uRippleSize"),
      tilt: u("uTilt"),
      rotation: u("uRotation"),
      opacity: u("uOpacity"),
      fade: u("uFade"),
      lightMode: u("uLightMode"),
      variant: u("uVariant"),
      intro: u("uIntro"),
      mouse: u("uMouse"),
      mouseActive: u("uMouseActive"),
      rippleOrigin: u("uRippleOrigin[0]"),
      rippleStart: u("uRippleStart[0]"),
    };

    const ripples = new Array(MAX_RIPPLES).fill(null).map(() => ({ x: 0, y: 0, start: -1 }));
    let ringIndex = 0;
    const pushRipple = (x: number, y: number, time: number) => {
      ripples[ringIndex] = { x, y, start: time };
      ringIndex = (ringIndex + 1) % MAX_RIPPLES;
    };

    let mouse = { x: 0, y: 0, active: 0 };
    const toLocal = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width - 0.5) * 2 * (rect.width / rect.height);
      const y = -((clientY - rect.top) / rect.height - 0.5) * 2;
      return { x, y };
    };
    const onMove = (e: PointerEvent) => {
      if (!propsRef.current.mouseInteraction) return;
      const p = toLocal(e.clientX, e.clientY);
      mouse = { x: p.x, y: p.y, active: 1 };
    };
    const onLeave = () => {
      mouse.active = 0;
    };
    const onClick = (e: PointerEvent) => {
      if (!propsRef.current.clickRipple) return;
      const p = toLocal(e.clientX, e.clientY);
      pushRipple(p.x, p.y, performance.now() / 1000 - startTime);
    };
    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerleave", onLeave, { passive: true });
    container.addEventListener("pointerdown", onClick, { passive: true });

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(container);

    const startTime = performance.now() / 1000;
    let lastAuto = 0;
    let raf = 0;
    let introStart = -1;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { paused: isPaused, autoRipple: auto, rippleInterval: interval } = propsRef.current;
      if (isPaused || !visible || reducedMotion) {
        if (reducedMotion && introStart < 0) introStart = -2; // render exactly one static frame, no reveal animation
      }
      const now = performance.now() / 1000 - startTime;
      if (introStart === -1) introStart = now;

      if (!isPaused && visible && !reducedMotion) {
        if (auto === "center" && now - lastAuto > interval) {
          pushRipple(0, 0, now);
          lastAuto = now;
        }
      } else if (isPaused || !visible) {
        return; // skip redraw entirely while paused/offscreen to save GPU
      }

      const p = propsRef.current;
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      const [r, g, b] = hexToRgb(p.color);
      gl.uniform3f(uniforms.color, r, g, b);
      gl.uniform1f(uniforms.time, now);
      gl.uniform1f(uniforms.cellSize, p.cellSize * dpr);
      gl.uniform1f(uniforms.lineWidth, p.lineWidth);
      gl.uniform1f(uniforms.glow, p.glow);
      gl.uniform1f(uniforms.rippleStrength, p.rippleStrength);
      gl.uniform1f(uniforms.rippleSpeed, p.rippleSpeed);
      gl.uniform1f(uniforms.rippleSize, p.rippleSize);
      gl.uniform1f(uniforms.tilt, p.tilt);
      gl.uniform1f(uniforms.rotation, p.rotation);
      gl.uniform1f(uniforms.opacity, p.opacity);
      gl.uniform1f(uniforms.fade, p.fade);
      gl.uniform1f(uniforms.lightMode, p.lightMode ? 1 : 0);
      gl.uniform1f(uniforms.variant, p.variant === "dots" ? 1 : 0);
      const introT = intro ? Math.min(1, reducedMotion ? 1 : (now - introStart) / 1.1) : 1;
      gl.uniform1f(uniforms.intro, introT);
      gl.uniform2f(uniforms.mouse, mouse.x, mouse.y);
      gl.uniform1f(uniforms.mouseActive, reducedMotion ? 0 : mouse.active);
      const ox = new Float32Array(MAX_RIPPLES * 2);
      const st = new Float32Array(MAX_RIPPLES).fill(-1);
      if (!reducedMotion) {
        ripples.forEach((rp, i) => {
          ox[i * 2] = rp.x;
          ox[i * 2 + 1] = rp.y;
          st[i] = rp.start;
        });
      }
      gl.uniform2fv(uniforms.rippleOrigin, ox);
      gl.uniform1fv(uniforms.rippleStart, st);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onClick);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
    };
    // Re-init only when truly structural props change; per-frame values read from propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={`ripple-grid-container ${className}`}>
      <canvas ref={canvasRef} className="ripple-grid-canvas" />
      {!supported && (
        <div
          className="ripple-grid-fallback"
          style={
            {
              "--rg-fallback-cell": `${cellSize}px`,
              "--rg-fallback-line": `${color}22`,
            } as React.CSSProperties
          }
        />
      )}
    </div>
  );
}
