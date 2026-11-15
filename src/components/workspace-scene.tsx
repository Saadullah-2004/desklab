'use client';

import dynamic from 'next/dynamic';
import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Canvas, useThree} from '@react-three/fiber';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {OrthographicCamera, Shape, Vector3} from 'three';
import type {Product} from '@/lib/types';

export interface WorkspaceSceneProps {
  products: Product[];
  deskWidthCm?: number;
  interactive?: boolean;
  className?: string;
}

type PartProps = {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  roughness?: number;
};

const backHill = new Shape();
backHill.moveTo(-0.27, 0.137);
backHill.lineTo(-0.27, 0.19);
backHill.bezierCurveTo(-0.1, 0.33, 0.04, 0.18, 0.27, 0.29);
backHill.lineTo(0.27, 0.137);
backHill.closePath();
const frontHill = new Shape();
frontHill.moveTo(-0.27, 0.137);
frontHill.lineTo(-0.27, 0.2);
frontHill.bezierCurveTo(-0.04, 0.16, 0.08, 0.28, 0.27, 0.18);
frontHill.lineTo(0.27, 0.137);
frontHill.closePath();

function Box({position, size, color, roughness = 0.7}: PartProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

function Plant({x, y, z}: {x: number; y: number; z: number}) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.045, 0.12, 28]} />
        <meshStandardMaterial color="#b06f4c" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.123, 0]}>
        <cylinderGeometry args={[0.052, 0.052, 0.004, 24]} />
        <meshStandardMaterial color="#554b3e" />
      </mesh>
      <mesh position={[0, 0.21, 0]}>
        <cylinderGeometry args={[0.003, 0.004, 0.18, 8]} />
        <meshStandardMaterial color="#5f7343" />
      </mesh>
      {[-1, 0, 1, 2, 3].map((index) => (
        <mesh
          key={index}
          position={[
            Math.sin(index * 2.4) * 0.035,
            0.2 + (index + 1) * 0.013,
            Math.cos(index * 2.4) * 0.035,
          ]}
          rotation={[0.3, index * 2.4, 0.7]}
          scale={[0.033, 0.08, 0.012]}
          castShadow
        >
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial
            color={index % 2 ? '#73834c' : '#566c3f'}
            roughness={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

function DeskObjects({products, deskWidthCm = 120}: WorkspaceSceneProps) {
  const desk = products.find((product) => product.category === 'desk');
  const shelf = products.find((product) => product.category === 'shelf');
  const keyboard = products.find((product) => product.category === 'keyboard');
  const light = products.find((product) => product.category === 'light');
  const accessory = products.find(
    (product) => product.category === 'accessory',
  );
  const width = (desk?.widthCm ?? deskWidthCm) / 100;
  const depth = (desk?.depthCm ?? 65) / 100;
  const top = 0.77;
  const wood = desk?.color ?? '#b89a72';
  const shelfWidth = (shelf?.widthCm ?? 80) / 100;
  const shelfDepth = (shelf?.depthCm ?? 22) / 100;
  const lightWidth = (light?.widthCm ?? 16) / 100;
  const lightDepth = (light?.depthCm ?? 16) / 100;
  const keyboardWidth = (keyboard?.widthCm ?? 33) / 100;
  const keyboardDepth = (keyboard?.depthCm ?? 15) / 100;
  const accessoryWidth = (accessory?.widthCm ?? 26) / 100;
  const accessoryDepth = (accessory?.depthCm ?? 16) / 100;
  // The exact two-row arrangement checked by recommendSetup: a 4 cm gap in each row.
  const rearWidth = lightWidth + (shelf ? shelfWidth + 0.04 : 0);
  const frontWidth = keyboardWidth + (accessory ? accessoryWidth + 0.04 : 0);
  const rearDepth = Math.max(lightDepth, shelf ? shelfDepth : 0);
  const frontDepth = Math.max(keyboardDepth, accessory ? accessoryDepth : 0);
  const layoutDepth = rearDepth + 0.04 + frontDepth;
  const rearZ = -layoutDepth / 2 + rearDepth / 2;
  const frontZ = layoutDepth / 2 - frontDepth / 2;
  const shelfX = -rearWidth / 2 + shelfWidth / 2;
  const lightX = shelf
    ? rearWidth / 2 - lightWidth / 2
    : width / 2 - lightWidth / 2 - 0.02;
  const keyboardX = -frontWidth / 2 + keyboardWidth / 2;
  const accessoryX = frontWidth / 2 - accessoryWidth / 2;
  const monitorY = top + (shelf ? 0.13 : 0);
  return (
    <group>
      <Box
        position={[0, top - 0.025, 0]}
        size={[width, 0.05, depth]}
        color={wood}
      />
      {Array.from({length: 8}, (_, index) => (
        <Box
          key={index}
          position={[0, top + 0.0005, -depth / 2 + ((index + 1) * depth) / 9]}
          size={[width - 0.01, 0.001, 0.002]}
          color={wood}
          roughness={0.9}
        />
      ))}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            position={[side * (width / 2 - 0.085), 0.36, -depth / 2 + 0.09]}
            size={[0.038, 0.72, 0.038]}
            color="#41443c"
          />
          <Box
            position={[side * (width / 2 - 0.085), 0.36, depth / 2 - 0.09]}
            size={[0.038, 0.72, 0.038]}
            color="#41443c"
          />
          <Box
            position={[side * (width / 2 - 0.085), 0.07, 0]}
            size={[0.04, 0.035, depth - 0.14]}
            color="#41443c"
          />
        </group>
      ))}
      <Box
        position={[0, 0.67, -depth / 2 + 0.09]}
        size={[width - 0.13, 0.05, 0.035]}
        color="#41443c"
      />
      {shelf && (
        <group>
          <Box
            position={[shelfX, top + 0.115, rearZ]}
            size={[shelfWidth, 0.026, shelfDepth]}
            color={shelf.color}
          />
          {[-1, 1].map((side) => (
            <Box
              key={side}
              position={[
                shelfX + side * (shelfWidth / 2 - 0.05),
                top + 0.052,
                rearZ,
              ]}
              size={[0.024, 0.105, shelfDepth - 0.05]}
              color="#46493e"
            />
          ))}
          <Box
            position={[shelfX, top + 0.025, rearZ]}
            size={[0.19, 0.035, 0.13]}
            color="#e3dccb"
          />
          <Box
            position={[shelfX, top + 0.046, rearZ]}
            size={[0.18, 0.008, 0.125]}
            color="#798368"
          />
        </group>
      )}
      <group position={[shelf ? shelfX + 0.06 : -0.08, monitorY, rearZ]}>
        <Box
          position={[0, 0.006, 0]}
          size={[0.22, 0.012, 0.13]}
          color="#c3c6bb"
          roughness={0.35}
        />
        <Box
          position={[0, 0.09, -0.015]}
          size={[0.032, 0.17, 0.025]}
          color="#c3c6bb"
          roughness={0.35}
        />
        <Box
          position={[0, 0.285, -0.015]}
          size={[0.57, 0.34, 0.024]}
          color="#333b35"
          roughness={0.4}
        />
        <Box
          position={[0, 0.29, 0.0001]}
          size={[0.546, 0.31, 0.002]}
          color="#c0c6ad"
        />
        <mesh position={[-0.13, 0.32, 0.002]}>
          <circleGeometry args={[0.076, 40]} />
          <meshBasicMaterial color="#e8dfc5" />
        </mesh>
        <mesh position={[0, 0, 0.003]}>
          <shapeGeometry args={[backHill]} />
          <meshBasicMaterial color="#7d8c67" />
        </mesh>
        <mesh position={[0, 0, 0.004]}>
          <shapeGeometry args={[frontHill]} />
          <meshBasicMaterial color="#5f7553" />
        </mesh>
      </group>
      {keyboard && (
        <group
          position={[keyboardX, top + 0.018, frontZ]}
          scale={[keyboardWidth / 0.36, 1, keyboardDepth / 0.125]}
        >
          <Box
            position={[0, 0, 0]}
            size={[0.36, 0.026, 0.125]}
            color={keyboard.color}
          />
          {Array.from({length: 5}, (_, row) =>
            Array.from({length: 14}, (_, column) => (
              <Box
                key={row + '-' + column}
                position={[
                  -0.164 + column * 0.025,
                  0.017,
                  -0.048 + row * 0.023,
                ]}
                size={[0.021, 0.009, 0.019]}
                color={
                  row === 0 && column === 0
                    ? '#bc7455'
                    : row === 4
                      ? '#d5d4c7'
                      : '#eeeade'
                }
                roughness={0.45}
              />
            )),
          )}
          <Box
            position={[0, 0.023, 0.045]}
            size={[0.12, 0.004, 0.02]}
            color="#e6dfcc"
          />
        </group>
      )}
      {light && (
        <group
          position={[lightX, top, rearZ]}
          scale={[lightWidth / 0.23, 1, lightDepth / 0.23]}
        >
          <mesh position={[0, 0.01, 0]} castShadow>
            <cylinderGeometry args={[0.078, 0.08, 0.02, 36]} />
            <meshStandardMaterial color={light.color} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.16, 0]} castShadow>
            <cylinderGeometry args={[0.009, 0.009, 0.3, 16]} />
            <meshStandardMaterial color={light.color} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.31, 0]} castShadow>
            <sphereGeometry
              args={[0.115, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]}
            />
            <meshStandardMaterial color={light.color} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.309, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.108, 32]} />
            <meshStandardMaterial
              color="#fff2c7"
              emissive="#ffdc9c"
              emissiveIntensity={0.45}
            />
          </mesh>
          <pointLight
            position={[0, 0.27, 0]}
            color="#ffe8bd"
            intensity={0.1}
            distance={0.6}
          />
        </group>
      )}
      {shelf && (
        <Plant x={shelfX - shelfWidth / 2 + 0.065} y={top + 0.13} z={rearZ} />
      )}
      {accessory && (
        <group
          position={[accessoryX, top + 0.009, frontZ]}
          scale={[accessoryWidth / 0.17, 1, accessoryDepth / 0.12]}
        >
          <Box
            position={[0, 0, 0]}
            size={[0.17, 0.012, 0.12]}
            color={accessory.color}
          />
          <Box
            position={[0, 0.01, -0.055]}
            size={[0.17, 0.015, 0.008]}
            color={accessory.color}
          />
          <Box
            position={[0, 0.01, 0.055]}
            size={[0.17, 0.015, 0.008]}
            color={accessory.color}
          />
          <Box
            position={[-0.08, 0.01, 0]}
            size={[0.008, 0.015, 0.12]}
            color={accessory.color}
          />
          <Box
            position={[0.08, 0.01, 0]}
            size={[0.008, 0.015, 0.12]}
            color={accessory.color}
          />
          <mesh position={[0.02, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.023, 0.003, 10, 24]} />
            <meshStandardMaterial
              color="#b59f6a"
              metalness={0.4}
              roughness={0.4}
            />
          </mesh>
        </group>
      )}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.008, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#e6e4d8" roughness={1} />
      </mesh>
    </group>
  );
}

function CameraControls({
  interactive,
  angle,
}: {
  interactive: boolean;
  angle: number;
}) {
  const {camera, gl, size, invalidate} = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      // Three.js owns this mutable camera; resize its projection through its imperative API.
      // eslint-disable-next-line react-hooks/immutability
      camera.zoom = Math.min(size.width / 2.25, size.height / 1.75);
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, size, invalidate]);
  useEffect(() => {
    const control = new OrbitControls(camera, gl.domElement);
    control.target.set(0, 0.69, 0);
    control.enablePan = false;
    control.enableZoom = false;
    control.enableDamping = false;
    control.minPolarAngle = 0.4;
    control.maxPolarAngle = Math.PI / 2.1;
    control.enabled = interactive;
    const onChange = () => invalidate();
    control.addEventListener('change', onChange);
    control.update();
    controls.current = control;
    return () => {
      control.removeEventListener('change', onChange);
      control.dispose();
      controls.current = null;
    };
  }, [camera, gl, interactive, invalidate]);
  useEffect(() => {
    const radius = 3.4;
    camera.position.copy(
      new Vector3(Math.sin(angle) * radius, 2.35, Math.cos(angle) * radius),
    );
    camera.lookAt(0, 0.69, 0);
    controls.current?.update();
    invalidate();
  }, [angle, camera, invalidate]);
  return null;
}

function SceneFallback({products}: Pick<WorkspaceSceneProps, 'products'>) {
  const wood =
    products.find((product) => product.category === 'desk')?.color ?? '#b79b72';
  const shelf = products.find((product) => product.category === 'shelf');
  const light = products.find((product) => product.category === 'light');
  const keyboard = products.find((product) => product.category === 'keyboard');
  const accessory = products.find(
    (product) => product.category === 'accessory',
  );
  return (
    <svg
      viewBox="0 0 640 480"
      aria-hidden="true"
      style={{width: '100%', height: '100%', display: 'block'}}
    >
      <ellipse
        cx="320"
        cy="386"
        rx="205"
        ry="30"
        fill="#797960"
        opacity=".12"
      />
      <path
        d="M160 237v130l14 9V242M482 234v125l-14 9V239M331 309v120l-15 7V310"
        stroke="#454c40"
        strokeWidth="12"
      />
      <path d="m110 230 184-86 244 93-207 105Z" fill={wood} />
      <path d="m110 230 221 112v15L110 245Z" fill={wood} />
      <path d="m331 342 207-105v15L331 357Z" fill="#8b765b" />
      {shelf && (
        <g>
          <path d="m190 223 135-58 123 48-137 65Z" fill={shelf.color} />
          <path
            d="m190 223 121 55v13l-121-54ZM311 278l137-65v13l-137 65Z"
            fill={shelf.color}
          />
          <path
            d="m190 223 121 55v13l-121-54ZM311 278l137-65v13l-137 65Z"
            fill="#000"
            opacity=".15"
          />
        </g>
      )}
      <path d="m257 229 38-16 53 18-40 18Z" fill="#b6bcae" />
      <path d="M303 229v-44" stroke="#b6bcae" strokeWidth="12" />
      <path d="m225 94 143 48v93l-143-51Z" fill="#333c34" />
      <path d="m234 107 125 41v72l-125-44Z" fill="#bcc6a9" />
      <path d="m234 150 33-17 35 47 25-14 32 29v25l-125-44Z" fill="#798d65" />
      {keyboard && (
        <g>
          <path d="m236 280 59-27 87 31-59 31Z" fill={keyboard.color} />
          <path
            d="m246 278 69 25m-57-31 69 25m-57-31 69 25"
            stroke="#f5f0e3"
            strokeWidth="5"
          />
        </g>
      )}
      {light && (
        <g>
          <ellipse cx="446" cy="260" rx="29" ry="10" fill={light.color} />
          <path d="M446 258v-91" stroke={light.color} strokeWidth="8" />
          <path d="M406 176c0-62 80-62 80 0Z" fill={light.color} />
          <ellipse cx="446" cy="176" rx="40" ry="10" fill="#efe4b9" />
        </g>
      )}
      {accessory && (
        <g>
          <path d="m385 281 31-15 39 15-32 17Z" fill={accessory.color} />
          <path
            d="m385 281 38 17v6l-38-17zm38 17 32-17v6l-32 17Z"
            fill={accessory.color}
          />
          <path
            d="m385 281 38 17v6l-38-17zm38 17 32-17v6l-32 17Z"
            fill="#000"
            opacity=".17"
          />
        </g>
      )}
      <path d="M180 210h37l-5 35c-8 6-21 5-27 0Z" fill="#b57352" />
      <path d="m199 211-3-58" stroke="#617546" strokeWidth="4" />
      <ellipse
        cx="189"
        cy="165"
        rx="12"
        ry="26"
        transform="rotate(-30 189 165)"
        fill="#71884d"
      />
      <ellipse
        cx="208"
        cy="185"
        rx="12"
        ry="25"
        transform="rotate(38 208 185)"
        fill="#536d40"
      />
    </svg>
  );
}

class SceneBoundary extends Component<
  {fallback: ReactNode; children: ReactNode; onUnavailable: () => void},
  {failed: boolean}
> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch() {
    this.props.onUnavailable();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneCanvas({
  products,
  deskWidthCm,
  interactive = true,
  angle,
  onUnavailable,
  onReady,
}: WorkspaceSceneProps & {
  angle: number;
  onUnavailable: () => void;
  onReady: () => void;
}) {
  // Canvas mounts HTML fallback children even when WebGL succeeds. Keep fallback side-effect free.
  return (
    <Canvas
      orthographic
      camera={{position: [2.4, 2.35, 2.4], zoom: 140, near: 0.01, far: 100}}
      shadows
      dpr={[1, 1.75]}
      frameloop="demand"
      gl={{antialias: true, alpha: true, powerPreference: 'low-power'}}
      fallback={<SceneFallback products={products} />}
      onCreated={({gl}) => {
        onReady();
        gl.domElement.addEventListener('webglcontextlost', onUnavailable, {
          once: true,
        });
      }}
      style={{
        width: '100%',
        height: '100%',
        touchAction: interactive ? 'pan-y' : 'auto',
      }}
    >
      <color attach="background" args={['#e6e4d8']} />
      <ambientLight intensity={1.4} />
      <hemisphereLight color="#fff8e8" groundColor="#949b85" intensity={1.6} />
      <directionalLight
        position={[-3, 6, 4]}
        intensity={3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-normalBias={0.025}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[3, 2, -2]} intensity={0.7} color="#e7eee2" />
      <Suspense fallback={null}>
        <DeskObjects products={products} deskWidthCm={deskWidthCm} />
      </Suspense>
      <CameraControls interactive={interactive} angle={angle} />
    </Canvas>
  );
}

const ClientScene = dynamic(() => Promise.resolve(SceneCanvas), {
  ssr: false,
  loading: () => <SceneFallback products={[]} />,
});

export function WorkspaceScene({
  products,
  deskWidthCm = 120,
  interactive = true,
  className,
}: WorkspaceSceneProps) {
  const [angle, setAngle] = useState(0.72);
  const [showIllustration, setShowIllustration] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const staticView = showIllustration || unavailable;
  const buttonStyle = {
    border: '1px solid rgba(69,76,57,.18)',
    background: 'rgba(250,249,243,.92)',
    color: '#424a39',
    width: 34,
    height: 34,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    fontSize: 17,
  } as const;
  return (
    <div
      className={className}
      data-preview={
        unavailable
          ? 'unavailable'
          : showIllustration
            ? 'static'
            : ready
              ? 'interactive'
              : 'loading'
      }
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 300,
        overflow: 'hidden',
        background: '#e6e4d8',
      }}
    >
      <div
        role="img"
        aria-label={
          'Workspace preview with ' +
          (products.map((product) => product.name).join(', ') ||
            'a sample desk setup') +
          '. Monitor and plant are styling props, not included products.'
        }
        style={{position: 'absolute', inset: 0}}
      >
        {staticView ? (
          <SceneFallback products={products} />
        ) : (
          <SceneBoundary
            onUnavailable={() => setUnavailable(true)}
            fallback={<SceneFallback products={products} />}
          >
            <ClientScene
              products={products}
              deskWidthCm={deskWidthCm}
              interactive={interactive}
              angle={angle}
              onUnavailable={() => setUnavailable(true)}
              onReady={() => setReady(true)}
            />
          </SceneBoundary>
        )}
      </div>
      <span
        style={{
          position: 'absolute',
          top: 22,
          left: 24,
          color: '#626b54',
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        Your space, considered.
      </span>
      {interactive && (
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            right: 18,
            display: 'flex',
            gap: 7,
          }}
        >
          <button
            type="button"
            disabled={staticView}
            aria-label="Rotate workspace left"
            title="Rotate left"
            style={buttonStyle}
            onClick={() => setAngle((value) => value - 0.35)}
          >
            ↶
          </button>
          <button
            type="button"
            disabled={staticView}
            aria-label="Reset workspace view"
            title="Reset view"
            style={buttonStyle}
            onClick={() => setAngle(0.72)}
          >
            ↺
          </button>
          <button
            type="button"
            disabled={staticView}
            aria-label="Rotate workspace right"
            title="Rotate right"
            style={buttonStyle}
            onClick={() => setAngle((value) => value + 0.35)}
          >
            ↷
          </button>
          <button
            type="button"
            disabled={unavailable}
            aria-label={
              unavailable
                ? '3D preview unavailable'
                : showIllustration
                  ? 'Show 3D workspace'
                  : 'Show static workspace illustration'
            }
            title={
              unavailable
                ? '3D is unavailable in this browser'
                : showIllustration
                  ? 'Show 3D'
                  : 'Static view'
            }
            style={{...buttonStyle, width: 42, fontSize: 11, fontWeight: 600}}
            onClick={() => setShowIllustration((value) => !value)}
          >
            {showIllustration && !unavailable ? '3D' : '2D'}
          </button>
        </div>
      )}
      <span
        style={{
          position: 'absolute',
          top: 44,
          left: 24,
          right: 20,
          color: '#727968',
          fontSize: 10,
          pointerEvents: 'none',
        }}
      >
        {unavailable
          ? 'Static preview · 3D is unavailable in this browser'
          : staticView || !interactive
            ? 'Illustrative preview · styling props not included'
            : 'Drag to explore · styling props not included'}
      </span>
    </div>
  );
}

export default WorkspaceScene;
