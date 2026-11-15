import {ImageResponse} from 'next/og';

export const alt =
  'DeskLab: an interactive workspace builder and portfolio storefront.';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#f8f6f0',
        color: '#30362f',
        padding: '56px 60px',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 570,
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <div
            style={{
              width: 18,
              height: 18,
              background: '#b75739',
              borderRadius: 4,
            }}
          />
          <div style={{fontSize: 32, fontWeight: 700, letterSpacing: -1}}>
            DeskLab
          </div>
        </div>
        <div style={{display: 'flex', flexDirection: 'column'}}>
          <div
            style={{
              fontSize: 16,
              letterSpacing: 3,
              color: '#767b70',
              marginBottom: 22,
            }}
          >
            MAKE ROOM FOR YOUR BEST WORK
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 73,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: -3,
            }}
          >
            <span>A workspace,</span>
            <span style={{color: '#b75739'}}>made for you.</span>
          </div>
          <div style={{fontSize: 24, color: '#767b70', marginTop: 24}}>
            Your space. Your style. Your budget.
          </div>
        </div>
        <div
          style={{display: 'flex', fontSize: 18, gap: 12, alignItems: 'center'}}
        >
          <span
            style={{
              border: '1px solid #dedfd5',
              borderRadius: 30,
              padding: '10px 17px',
            }}
          >
            3D setup builder
          </span>
          <span style={{color: '#767b70'}}>Portfolio demo</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          right: 36,
          top: 100,
          width: 480,
          height: 440,
          background: '#e9ecdf',
          borderRadius: '220px 220px 28px 28px',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="470"
          height="410"
          viewBox="0 0 470 410"
          xmlns="http://www.w3.org/2000/svg"
        >
          <ellipse cx="242" cy="357" rx="185" ry="22" fill="#d9ddcc" />
          <path d="M80 232 L95 232 L95 344 L84 350 Z" fill="#6c5342" />
          <path d="M373 224 L389 224 L388 342 L377 349 Z" fill="#6c5342" />
          <path d="M63 214 L330 173 L415 228 L142 279 Z" fill="#d3ad7e" />
          <path
            d="M63 214 L142 267 L415 216 L415 229 L142 280 L63 227 Z"
            fill="#a97b4f"
          />
          <path d="M63 214 L334 165 L415 216 L142 267 Z" fill="#d6b48c" />
          <path d="M110 208 L274 178 L304 194 L140 226 Z" fill="#ebe5d5" />
          <path d="M136 220 L146 218 L146 237 L137 240 Z" fill="#80654e" />
          <path d="M280 195 L291 193 L291 212 L281 215 Z" fill="#80654e" />
          <path
            d="M180 173 L193 170 L194 195 L221 199 L198 205 L168 198 L183 194 Z"
            fill="#434b41"
          />
          <path
            d="M115 104 Q115 96 123 94 L256 70 Q264 68 264 77 L264 163 Q264 170 256 172 L123 198 Q115 199 115 191 Z"
            fill="#343e34"
          />
          <path d="M123 104 L256 80 L256 161 L123 187 Z" fill="#bbc6ad" />
          <path
            d="M123 160 L158 133 L183 149 L216 112 L256 122 L256 161 L123 187 Z"
            fill="#8d9e7c"
          />
          <circle cx="224" cy="105" r="10" fill="#f6efd9" />
          <path d="M168 229 L253 213 L287 233 L199 250 Z" fill="#f3eee2" />
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3, 4, 5, 6].map((column) => (
              <path
                key={`${row}-${column}`}
                d={`M${178 + column * 10 + row * 7} ${228 - column * 1.8 + row * 4.5} l7 -1.3 l5 2.8 l-7 1.3 Z`}
                fill="#c4bba9"
              />
            )),
          )}
          <ellipse cx="331" cy="212" rx="29" ry="10" fill="#b75739" />
          <path d="M326 210 L331 208 L331 143 L326 145 Z" fill="#8e432e" />
          <path
            d="M307 143 Q310 113 331 112 Q351 112 359 134 L333 145 Z"
            fill="#b75739"
          />
          <ellipse cx="333" cy="141" rx="26" ry="7" fill="#e8b97b" />
          <path d="M343 180 L366 176 L363 202 L349 205 Z" fill="#f3eee2" />
          <path
            d="M354 180 Q329 158 342 145 Q357 149 355 175 Q354 145 367 139 Q380 151 356 179 Z"
            fill="#6c805e"
          />
          <path
            d="M301 239 Q312 229 321 234 Q330 240 318 245 Q308 250 301 239 Z"
            fill="#efe9dc"
          />
        </svg>
      </div>
    </div>,
    size,
  );
}
