'use client';

import {useId} from 'react';
import type {Product} from '@/lib/types';

interface ProductVisualProps {
  product: Product;
  className?: string;
}

/** Original SVG product studies. These illustrate the fictional demo catalog. */
export function ProductVisual({product, className}: ProductVisualProps) {
  const id = useId().replaceAll(':', '');
  const color = product.color;
  const shadow = 'url(#shadow-' + id + ')';
  return (
    <svg
      className={className}
      viewBox="0 0 400 300"
      role="img"
      aria-label={product.name + ', original product illustration'}
      style={{
        display: 'block',
        width: '100%',
        overflow: 'visible',
      }}
    >
      <defs>
        <filter
          id={'shadow-' + id}
          x="-50%"
          y="-80%"
          width="200%"
          height="260%"
        >
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <linearGradient id={'finish-' + id} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <ellipse
        cx="204"
        cy="241"
        rx="112"
        ry="17"
        fill="#4c4237"
        opacity=".13"
        filter={shadow}
      />
      {product.category === 'desk' && (
        <g>
          <path
            d="M89 140v87l10 5 7-5v-84M291 137v82l10 5 7-5v-87M224 171v91l10 5 7-5v-89M166 103v80l10 5 7-5v-83"
            fill="#3d423c"
          />
          <path d="m72 134 115-54 143 55-113 60Z" fill={color} />
          <path d="m72 134 145 61v11L72 145Z" fill={color} />
          <path d="m72 134 145 61v11L72 145Z" fill="#000" opacity=".14" />
          <path d="m217 195 113-60v11l-113 60Z" fill={color} />
          <path d="m217 195 113-60v11l-113 60Z" fill="#000" opacity=".23" />
          <g stroke="#fff" strokeOpacity=".16" strokeWidth="1.4">
            <path d="m95 132 130 52M110 126l130 51M133 115l129 50M151 107l129 49M171 98l128 48" />
          </g>
          <path
            d="m103 161 122 52M235 206l62-32"
            stroke="#252e29"
            strokeWidth="6"
          />
        </g>
      )}
      {product.category === 'shelf' && (
        <g>
          <path
            d="m90 160 22-10v58l-22 10zM268 163l22-11v55l-22 11z"
            fill="#363d35"
          />
          <path d="m75 146 102-49 150 53-104 54Z" fill={color} />
          <path d="m75 146 148 58v15L75 161Z" fill={color} />
          <path d="m75 146 148 58v15L75 161Z" fill="#000" opacity=".14" />
          <path d="m223 204 104-54v15l-104 54Z" fill={color} />
          <path d="m223 204 104-54v15l-104 54Z" fill="#000" opacity=".24" />
          <path
            d="m100 143 127 47m-109-56 127 47m-108-56 128 47m-107-57 128 47"
            stroke="#fff"
            strokeOpacity=".17"
            strokeWidth="1.5"
          />
        </g>
      )}
      {product.category === 'keyboard' && (
        <g transform="translate(0 8)">
          <path d="m65 144 91-53 184 60-90 61Z" fill="#45473e" />
          <path d="m65 144 185 68v15L65 159Z" fill="#343c36" />
          <path d="m250 212 90-61v15l-90 61Z" fill="#262d28" />
          <path d="m70 141 86-47 179 58-86 54Z" fill={color} />
          <g transform="matrix(1.25 .43 -.96 .57 155 104)">
            {Array.from({length: 5}, (_, row) =>
              Array.from({length: row === 4 ? 9 : 13}, (_, column) => (
                <rect
                  key={row + '-' + column}
                  x={column * 10 + (row === 4 ? 20 : row % 2 ? 3 : 0)}
                  y={row * 13}
                  width={row === 4 && column === 3 ? 37 : 8}
                  height="10"
                  rx="1.5"
                  fill={row === 0 && column === 0 ? '#b46446' : '#f0ebdf'}
                  stroke="#272c24"
                  strokeOpacity=".13"
                  strokeWidth=".7"
                  opacity={row === 4 && column > 3 && column < 7 ? 0 : 1}
                />
              )),
            )}
          </g>
          <circle cx="311" cy="150" r="7" fill="#bb7449" />
        </g>
      )}
      {product.category === 'light' && (
        <g>
          <ellipse cx="204" cy="235" rx="54" ry="13" fill={color} />
          <path d="M150 232v6c0 19 108 19 108 0v-6" fill={color} />
          <ellipse
            cx="204"
            cy="231"
            rx="54"
            ry="13"
            fill="#fff"
            opacity=".12"
          />
          <path
            d="M202 225V125c0-22 22-31 43-32"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M199 219v-88"
            stroke="#fff"
            strokeOpacity=".22"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M141 124c2-49 29-75 63-75s62 26 65 75Z" fill={color} />
          <path
            d="M141 124c2-49 29-75 63-75-25 10-42 37-45 75Z"
            fill="#fff"
            opacity=".16"
          />
          <ellipse cx="205" cy="124" rx="64" ry="17" fill="#ece2bd" />
          <ellipse cx="205" cy="124" rx="55" ry="11" fill="#fff4ce" />
          <path
            d="M203 236c60 0 48 21 75 21"
            fill="none"
            stroke="#5c594e"
            strokeWidth="2"
          />
        </g>
      )}
      {product.category === 'accessory' &&
        (/plant|pot/i.test(product.handle + product.name) ? (
          <g>
            <path d="M161 171h87l-9 69c-19 13-53 13-70 0Z" fill={color} />
            <ellipse cx="204" cy="171" rx="44" ry="13" fill={color} />
            <ellipse cx="204" cy="172" rx="35" ry="9" fill="#635447" />
            <path
              d="M205 176V83m0 45-32-30m32 54 37-32"
              fill="none"
              stroke="#5d6f42"
              strokeWidth="5"
            />
            <ellipse
              cx="179"
              cy="93"
              rx="15"
              ry="32"
              transform="rotate(-42 179 93)"
              fill="#7c8e58"
            />
            <ellipse
              cx="210"
              cy="81"
              rx="16"
              ry="37"
              transform="rotate(12 210 81)"
              fill="#566c43"
            />
            <ellipse
              cx="235"
              cy="122"
              rx="16"
              ry="32"
              transform="rotate(46 235 122)"
              fill="#8d995f"
            />
            <ellipse
              cx="185"
              cy="143"
              rx="13"
              ry="25"
              transform="rotate(-55 185 143)"
              fill="#617a4b"
            />
          </g>
        ) : (
          <g>
            <path d="m84 163 105-61 131 52-97 64Z" fill={color} />
            <path d="m84 163 139 55v13L84 176Z" fill={color} />
            <path d="m84 163 139 55v13L84 176Z" fill="#000" opacity=".2" />
            <path d="m223 218 97-64v13l-97 64Z" fill={color} />
            <path d="m223 218 97-64v13l-97 64Z" fill="#000" opacity=".3" />
            <path
              d="m105 161 85-46 107 42-76 49Z"
              fill="#000"
              opacity=".09"
              stroke="#fff"
              strokeOpacity=".2"
              strokeWidth="2"
            />
            <path d="m135 158 40-23 31 11-40 24Z" fill="#e6dfd1" />
            <path d="m196 163 30-16 47 18-29 18Z" fill="#69745b" />
            <path d="m203 162 20-11" stroke="#a3ad92" strokeWidth="2" />
          </g>
        ))}
    </svg>
  );
}

export default ProductVisual;
