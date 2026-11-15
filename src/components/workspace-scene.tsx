'use client';

import dynamic from 'next/dynamic';
import {Component, useSyncExternalStore, useState, type ReactNode} from 'react';
import type {Product} from '@/lib/types';

export interface WorkspaceSceneProps {
  products: Product[];
  deskWidthCm?: number;
  interactive?: boolean;
  className?: string;
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

const ClientScene = dynamic(() => import('./workspace-canvas'), {
  ssr: false,
  loading: () => null,
});

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The server renders the lightweight illustration. Hydration opts into WebGL
// only when the visitor has not asked for reduced motion.
function serverMotionPreference() {
  return true;
}

export function WorkspaceScene({
  products,
  deskWidthCm = 120,
  interactive = true,
  className,
}: WorkspaceSceneProps) {
  const [angle, setAngle] = useState(0.72);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    serverMotionPreference,
  );
  const [illustrationOverride, setIllustrationOverride] = useState<
    boolean | null
  >(null);
  const showIllustration = illustrationOverride ?? reducedMotion;
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const staticView = showIllustration || unavailable;
  const buttonStyle = {
    border: '1px solid rgba(69,76,57,.18)',
    background: 'rgba(250,249,243,.92)',
    color: '#424a39',
    width: 44,
    height: 44,
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
            {!ready && <SceneFallback products={products} />}
            <div style={{position: 'absolute', inset: 0}}>
              <ClientScene
                products={products}
                deskWidthCm={deskWidthCm}
                interactive={interactive}
                angle={angle}
                onUnavailable={() => setUnavailable(true)}
                onReady={() => setReady(true)}
                fallback={<SceneFallback products={products} />}
              />
            </div>
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
            disabled={staticView || !ready}
            aria-label="Rotate workspace left"
            title="Rotate left"
            style={buttonStyle}
            onClick={() => setAngle((value) => value - 0.35)}
          >
            ↶
          </button>
          <button
            type="button"
            disabled={staticView || !ready}
            aria-label="Reset workspace view"
            title="Reset view"
            style={buttonStyle}
            onClick={() => setAngle(0.72)}
          >
            ↺
          </button>
          <button
            type="button"
            disabled={staticView || !ready}
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
            style={{...buttonStyle, fontSize: 11, fontWeight: 600}}
            aria-pressed={showIllustration}
            onClick={() => {
              if (showIllustration) setReady(false);
              setIllustrationOverride(!showIllustration);
            }}
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
