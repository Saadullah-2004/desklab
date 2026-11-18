'use client';
import Link from 'next/link';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CircleHelp,
  Copy,
  Heart,
  Menu,
  Minus,
  MoveUpRight,
  Plus,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import {products as demoProducts, formatMoney} from '@/lib/catalog';
import {evaluateSelectedSetup, recommendSetup} from '@/lib/recommend';
import {
  decodeSharedConfiguration,
  encodeConfiguration,
  validateCartLines,
} from '@/lib/configuration';
import type {
  CartLine,
  Category,
  Preferences,
  Product,
  Recommendation,
  Style,
} from '@/lib/types';
import {WorkspaceScene} from './workspace-scene';
import {ProductVisual} from './product-visual';

const DEFAULTS: Preferences = {
  budgetCents: 65000,
  deskWidthCm: 140,
  style: 'warm',
  quiet: true,
};
const labels: Record<Category, string> = {
  desk: 'Desks',
  shelf: 'Shelves',
  keyboard: 'Keyboards',
  light: 'Lighting',
  accessory: 'Small things',
};
const categories: Category[] = [
  'desk',
  'shelf',
  'keyboard',
  'light',
  'accessory',
];
const CART_KEY = 'desklab-cart-v1';
const CHECKOUT_HANDOFF_KEY = 'desklab-checkout-handoff-v1';
const CATALOG_TIMEOUT_MS = 15000;
// Checkout verifies inventory and creates the Shopify cart in two bounded server calls.
const CHECKOUT_TIMEOUT_MS = 35000;
type Page = 'home' | 'builder' | 'shop' | 'about';
type Result = Recommendation & {
  engine: 'rules' | 'gemini';
  notices: string[];
  catalogSource: 'demo' | 'shopify';
  catalogSnapshot: Product[];
  checkoutEnabled: boolean;
};

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    const opener = document.activeElement;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      // Safari does not restore a pointer-triggered dialog opener consistently.
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({preventScroll: true});
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled, [hidden], [aria-hidden="true"]') &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        // Native dialog containment can include the scrollable dialog itself.
        // Keep sequential keyboard navigation cycling through its actual controls.
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || active === dialog)) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        // Keep React state in sync before focus returns to the opener. Native
        // dismissal queues close later, allowing a quick reopen to reuse stale state.
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        // React's development effect replay can queue a close event before reopening.
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export default function DeskLab({page}: {page: Page}) {
  const [catalog, setCatalog] = useState<Product[]>(demoProducts);
  const [source, setSource] = useState<'demo' | 'shopify'>('demo');
  const [ready, setReady] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = catalog.find((product) => product.id === detailId) ?? null;
  const [notice, setNotice] = useState('');
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [brief, setBrief] = useState('');
  const [engineNotices, setEngineNotices] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState(() =>
    recommendSetup(DEFAULTS).products.map((p) => p.id),
  );
  const [engine, setEngine] = useState<'rules' | 'gemini'>('rules');
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [returnedFromCheckout, setReturnedFromCheckout] = useState(false);
  const checkoutInFlight = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [builderCategory, setBuilderCategory] = useState<Category>('desk');
  const [shareUrl, setShareUrl] = useState('');
  const requestRef = useRef(0);
  const recommendationController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      ++requestRef.current;
      recommendationController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    fetch('/api/catalog', {signal: controller.signal})
      .then(async (r) => {
        if (!r.ok)
          throw Error('The current catalog is temporarily unavailable.');
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setCatalog(data.products);
          setDetailId((id) =>
            data.products.some((product: Product) => product.id === id)
              ? id
              : null,
          );
          setSource(data.source);
          setCheckoutEnabled(data.checkoutEnabled);
          setCatalogError('');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogError(
            controller.signal.aborted
              ? 'The catalog took too long to respond.'
              : 'The current catalog is temporarily unavailable.',
          );
          setCheckoutEnabled(false);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) {
          setReady(true);
          setCatalogLoading(false);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [catalogAttempt]);
  function retryCatalog() {
    setCatalogLoading(true);
    setCheckoutEnabled(false);
    setCatalogAttempt((attempt) => attempt + 1);
  }
  useEffect(() => {
    if (menuOpen) navigationRef.current?.querySelector('a')?.focus();
  }, [menuOpen]);
  // Browser state is restored once after hydration so server and initial client markup agree.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      const lines = saved ? validateCartLines(JSON.parse(saved)) : null;
      if (lines) setCart(lines);
    } catch {
      setNotice(
        'Saved items could not be loaded. You can start a fresh workspace.',
      );
    }
    const encoded = new URLSearchParams(window.location.search).get('setup');
    if (encoded) {
      const shared = decodeSharedConfiguration(encoded);
      if (
        shared &&
        shared.lines.length > 0 &&
        shared.lines.every((line) => line.quantity === 1)
      ) {
        setSelectedIds(shared.lines.map((line) => line.productId));
        const items = shared.lines.map((line) =>
          demoProducts.find((p) => p.id === line.productId)!,
        );
        if (shared.version === 2) {
          setPreferences(shared.preferences);
        } else {
          // Legacy links did not store preferences. Respect their explicitly
          // selected keyboard rather than imposing the default quiet constraint.
          setPreferences((p) => ({
            ...p,
            quiet:
              items.find((item) => item.category === 'keyboard')?.quiet ??
              p.quiet,
            style:
              items.find((item) => item.category === 'desk')?.styles[0] ??
              p.style,
            deskWidthCm: Math.max(
              p.deskWidthCm,
              ...items.map((item) => item.widthCm),
            ),
            budgetCents: Math.max(
              p.budgetCents,
              items.reduce((sum, item) => sum + item.priceCents, 0),
            ),
          }));
        }
        setNotice(
          'Shared workspace loaded. Prices and availability are checked at checkout.',
        );
      } else
        setNotice(
          'That shared workspace is invalid. Start a fresh build below.',
        );
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    function restoreCheckoutHandoff(event?: PageTransitionEvent) {
      // Initial document loads are handled by this effect; only BFCache restores
      // need the pageshow path. A late initial load must not release a submit lock.
      if (event && !event.persisted) return;
      // A navigation or browser Back event proves no order or payment status.
      checkoutInFlight.current = false;
      setCheckoutBusy(false);
      try {
        if (sessionStorage.getItem(CHECKOUT_HANDOFF_KEY)) {
          sessionStorage.removeItem(CHECKOUT_HANDOFF_KEY);
          setReturnedFromCheckout(true);
          setCartOpen(true);
        }
      } catch {
        /* The saved bag still works when session storage is unavailable. */
      }
    }
    restoreCheckoutHandoff();
    window.addEventListener('pageshow', restoreCheckoutHandoff);
    return () => window.removeEventListener('pageshow', restoreCheckoutHandoff);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
      } catch {
        /* Cart remains usable without storage. */
      }
    }
  }, [cart, hydrated]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  const selected = selectedIds
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is Product => !!p);
  const total = selected.reduce((sum, p) => sum + p.priceCents, 0);
  const cartProducts = cart.flatMap((line) => {
    const product = catalog.find((p) => p.id === line.productId);
    return product ? [{...line, product}] : [];
  });
  const cartTotal = cartProducts.reduce(
    (sum, l) => sum + l.product.priceCents * l.quantity,
    0,
  );
  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const validation = evaluateSelectedSetup(selected, preferences);
  const valid = validation.valid;
  const missingCart = cart.filter(
    (line) => !catalog.some((product) => product.id === line.productId),
  );
  function showProduct(product: Product, trigger: HTMLButtonElement) {
    // WebKit does not focus buttons on pointer activation. Preserve the actual
    // opener so closing a modal returns to the same place for every input method.
    trigger.focus({preventScroll: true});
    setDetailId(product.id);
  }
  function openCart(trigger?: HTMLButtonElement) {
    trigger?.focus({preventScroll: true});
    setCartOpen(true);
  }
  function addToCart(items: Product[], trigger?: HTMLButtonElement) {
    setCart((old) => {
      const next = [...old];
      for (const p of items) {
        if (!p.available) continue;
        const i = next.findIndex((l) => l.productId === p.id);
        if (i < 0) next.push({productId: p.id, quantity: 1});
        else
          next[i] = {
            ...next[i],
            quantity: Math.min(10, next[i].quantity + 1),
          };
      }
      return next;
    });
    setCheckoutError('');
    openCart(trigger);
  }
  function quantity(id: string, delta: number) {
    setCart((old) =>
      old
        .map((l) =>
          l.productId === id
            ? {...l, quantity: Math.min(10, l.quantity + delta)}
            : l,
        )
        .filter((l) => l.quantity > 0),
    );
    setCheckoutError('');
  }
  function editWorkspace() {
    // Edits win over every part of an older response, including errors and its
    // catalog snapshot. Release pending feedback so the new brief can be built.
    ++requestRef.current;
    recommendationController.current?.abort();
    recommendationController.current = null;
    setBusy(false);
    setRequestError('');
    setEngine('rules');
    setEngineNotices([]);
    setShareUrl('');
  }
  function updatePreferences(change: Partial<Preferences>) {
    editWorkspace();
    setPreferences((previous) => ({...previous, ...change}));
  }
  function selectProduct(p: Product) {
    editWorkspace();
    setSelectedIds((old) => [
      ...old.filter(
        (id) => catalog.find((item) => item.id === id)?.category !== p.category,
      ),
      p.id,
    ]);
  }
  async function generate() {
    const id = ++requestRef.current;
    recommendationController.current?.abort();
    const controller = new AbortController();
    recommendationController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    setRequestError('');
    setShareUrl('');
    try {
      const r = await fetch('/api/recommend', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({brief, preferences}),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          data.error || 'We couldn’t build a recommendation. Try again.',
        );
      if (id !== requestRef.current) return;
      const result = data as Result;
      setCatalog(result.catalogSnapshot);
      setDetailId((id) =>
        result.catalogSnapshot.some((product) => product.id === id) ? id : null,
      );
      setSource(result.catalogSource);
      setCheckoutEnabled(result.checkoutEnabled);
      setEngineNotices(result.notices);
      setSelectedIds(result.products.map((p) => p.id));
      setPreferences(result.preferences);
      setEngine(result.engine);
      if (!result.feasible)
        setRequestError(
          result.warnings.join(' ') ||
            'No complete setup fits. Try a larger budget or desk width.',
        );
    } catch (error) {
      if (id !== requestRef.current) return;
      setRequestError(
        controller.signal.aborted
          ? 'Recommendations took too long to respond. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Please try again.',
      );
    } finally {
      clearTimeout(timeout);
      if (id === requestRef.current) {
        recommendationController.current = null;
        setBusy(false);
      }
    }
  }
  async function share() {
    let url: string;
    try {
      url = `${window.location.origin}/builder?setup=${encodeConfiguration(
        selected.map((p) => ({productId: p.id, quantity: 1})),
        preferences,
      )}`;
    } catch {
      setNotice(
        'This workspace could not be shared. Check the budget and desk width.',
      );
      return;
    }
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Workspace link copied. Make something good together.');
    } catch {
      setNotice('Your workspace link is ready to copy below.');
    }
  }
  async function checkout() {
    if (
      checkoutInFlight.current ||
      !checkoutEnabled ||
      catalogLoading ||
      catalogError ||
      missingCart.length ||
      !cart.length
    )
      return;
    checkoutInFlight.current = true;
    setCheckoutBusy(true);
    setCheckoutError('');
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHECKOUT_TIMEOUT_MS);
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({lines: cart}),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Checkout is unavailable.');
      const url = new URL(data.checkoutUrl);
      if (url.protocol !== 'https:') throw Error('Invalid checkout link.');
      try {
        sessionStorage.setItem(CHECKOUT_HANDOFF_KEY, String(Date.now()));
      } catch {
        /* Navigation and the saved bag do not depend on session storage. */
      }
      window.location.assign(url.toString());
    } catch (error) {
      setCheckoutError(
        error instanceof Error && !timedOut
          ? error.message
          : 'Checkout took too long to respond. Your bag is saved. Try again.',
      );
      checkoutInFlight.current = false;
      setCheckoutBusy(false);
    } finally {
      clearTimeout(timeout);
    }
  }
  const card = (p: Product) => (
    <article className="product-card" key={p.id}>
      <button
        className="product-art-button"
        onClick={(event) => showProduct(p, event.currentTarget)}
        aria-label={`View ${p.name}`}
      >
        <ProductVisual product={p} />
        <span className="product-tag">
          {p.available ? 'DESKLAB ORIGINAL' : 'OUT OF STOCK'}
        </span>
        <span className="product-open">
          <Plus size={18} />
        </span>
      </button>
      <div className="product-info">
        <div>
          <button
            className="product-name"
            onClick={(event) => showProduct(p, event.currentTarget)}
          >
            {p.name}
          </button>
          <p>{p.subtitle}</p>
        </div>
        <span>{formatMoney(p.priceCents)}</span>
      </div>
      <div className="product-bottom">
        <span className="swatch" style={{background: p.color}} />
        <span>{p.finish}</span>
        <button
          onClick={(event) => addToCart([p], event.currentTarget)}
          disabled={!p.available || !ready || catalogLoading || !!catalogError}
          aria-label={`Add ${p.name} to bag`}
        >
          Add to bag <Plus size={14} />
        </button>
      </div>
    </article>
  );
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="announcement">
        <span>A little more intention. A much better workspace.</span>
        <Link href="/builder">
          Find your setup <ArrowRight size={12} />
        </Link>
      </div>
      <header
        className="site-header"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false);
            menuButtonRef.current?.focus();
          }
        }}
      >
        <Link href="/" className="wordmark" aria-label="DeskLab home">
          desk<span>lab</span>
          <i />
        </Link>
        <nav
          id="main-navigation"
          ref={navigationRef}
          aria-label="Main navigation"
          className={menuOpen ? 'navigation open' : 'navigation'}
        >
          <Link
            href="/shop"
            aria-current={page === 'shop' ? 'page' : undefined}
          >
            The collection
          </Link>
          <Link
            href="/builder"
            aria-current={page === 'builder' ? 'page' : undefined}
          >
            Workspace studio <span className="tiny-label">NEW</span>
          </Link>
          <Link
            href="/about"
            aria-current={page === 'about' ? 'page' : undefined}
          >
            Behind the build
          </Link>
        </nav>
        <div className="header-actions">
          <button
            ref={menuButtonRef}
            className="icon-button mobile-menu"
            aria-controls="main-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
          >
            <Menu size={21} />
          </button>
          <button
            className="bag-button"
            onClick={(event) => openCart(event.currentTarget)}
            aria-label={`Open bag, ${cartCount} items`}
          >
            <ShoppingBag size={19} />
            <span>Bag</span>
            <b>{cartCount}</b>
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {(catalogLoading || catalogError) && (
          <div className="catalog-status">
            {catalogError ? (
              <p role="alert">
                {catalogError} Your bag and setup are kept. Preview prices may
                be out of date.
              </p>
            ) : (
              <p role="status">
                Checking the current catalog. Preview prices are loading.
              </p>
            )}
            {catalogError && (
              <button
                className="text-link"
                onClick={retryCatalog}
                disabled={catalogLoading}
              >
                {catalogLoading ? 'Retrying catalog…' : 'Retry catalog'}
              </button>
            )}
          </div>
        )}
        {page === 'home' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="little-star">✳</span> GOOD THINGS START HERE
                </div>
                <h1>
                  Make room for
                  <br />
                  your <em>best work.</em>
                </h1>
                <p>
                  Thoughtful tools. A space that feels like you.
                  <br />
                  Build a workspace you’ll love coming back to.
                </p>
                <div className="hero-actions">
                  <Link className="button primary" href="/builder">
                    Build your workspace <ArrowRight size={17} />
                  </Link>
                  <Link className="text-link" href="/shop">
                    Explore the collection <MoveUpRight size={15} />
                  </Link>
                </div>
                <div className="hero-footnote">
                  <span className="line" /> Made for your space. Matched to your
                  budget.
                </div>
              </div>
              <div className="hero-visual">
                <WorkspaceScene
                  products={selected}
                  deskWidthCm={140}
                  interactive
                  className="hero-scene"
                />
                <div className="floating-note">
                  <span>FIND YOUR FOCUS</span>
                  <strong>
                    Less clutter.
                    <br />
                    More possibility.
                  </strong>
                  <ArrowDown size={18} />
                </div>
              </div>
            </section>
            <div className="principles">
              <span>
                <Check size={15} /> A setup that actually fits
              </span>
              <span>
                <Check size={15} /> Your budget, respected
              </span>
              <span>
                <Check size={15} /> Small details. Big difference.
              </span>
              <span>
                <Check size={15} /> Designed to work together
              </span>
            </div>
            <section className="section collection-section">
              <div className="section-top">
                <div>
                  <p className="eyebrow">THE EVERYDAY ESSENTIALS</p>
                  <h2>Good company for your desk.</h2>
                </div>
                <Link className="text-link" href="/shop">
                  Shop the collection <ArrowRight size={16} />
                </Link>
              </div>
              <div className="product-grid">
                {categories
                  .slice(0, 4)
                  .map((c) => catalog.find((p) => p.category === c))
                  .filter((p): p is Product => !!p)
                  .map(card)}
              </div>
            </section>
            <section className="studio-story">
              <div className="story-art">
                <div className="story-grid" />
                <span className="eyebrow">YOUR SPACE, FIGURED OUT.</span>
                <div className="brief-card">
                  <Sparkles size={20} />
                  <p>
                    “A quiet setup, warm wood,
                    <br />
                    and room for big ideas.
                    <br />
                    <em>Under $650, please.”</em>
                  </p>
                  <div>
                    <span className="dot" /> LET’S MAKE IT YOURS{' '}
                    <ArrowRight size={16} />
                  </div>
                </div>
                <div className="match-card">
                  <Check size={17} />
                  <span>
                    Fits your desk.
                    <br />
                    <strong>And your budget.</strong>
                  </span>
                </div>
              </div>
              <div className="story-copy">
                <p className="eyebrow">MEET THE WORKSPACE STUDIO</p>
                <h2>
                  A little inspiration.
                  <br />
                  <em>A setup that’s you.</em>
                </h2>
                <p>
                  Tell us how you like to work. We’ll bring together the right
                  pieces for your space, with every dimension and dollar
                  accounted for.
                </p>
                <Link className="button dark" href="/builder">
                  Find your everyday setup <ArrowRight size={17} />
                </Link>
                <span className="small-note">
                  No perfect prompt needed. Just bring your ideas.
                </span>
              </div>
            </section>
            <section className="closing-note">
              <span className="little-star">✳</span>
              <p>
                Not just where you work.
                <br />
                <em>Where good ideas begin.</em>
              </p>
              <Link href="/about" className="text-link">
                A closer look at DeskLab <ArrowRight size={15} />
              </Link>
            </section>
          </>
        )}
        {page === 'shop' && (
          <section className="section shop-page">
            <div className="page-intro">
              <p className="eyebrow">LESS, BUT BETTER</p>
              <h1>The good-work collection.</h1>
              <p>
                Original essentials for a space with a little more intention.
              </p>
            </div>
            <div className="catalog-toolbar">
              <div className="filter-tabs" aria-label="Filter products">
                <button
                  aria-pressed={filter === 'all'}
                  className={filter === 'all' ? 'active' : ''}
                  onClick={() => setFilter('all')}
                >
                  Everything
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    aria-pressed={filter === c}
                    className={filter === c ? 'active' : ''}
                    onClick={() => setFilter(c)}
                  >
                    {labels[c]}
                  </button>
                ))}
              </div>
              <span>
                {
                  catalog.filter(
                    (p) => filter === 'all' || p.category === filter,
                  ).length
                }{' '}
                pieces
              </span>
            </div>
            <div className="product-grid shop-grid">
              {catalog
                .filter((p) => filter === 'all' || p.category === filter)
                .map(card)}
            </div>
          </section>
        )}
        {page === 'builder' && (
          <section className="builder-page">
            <div className="builder-heading">
              <div>
                <p className="eyebrow">THE WORKSPACE STUDIO</p>
                <h1>
                  Make it <em>yours.</em>
                </h1>
              </div>
              <p>A few good pieces. One place to make them work.</p>
            </div>
            <div className="builder-layout">
              <aside className="builder-controls">
                <div className="panel-heading">
                  <span className="number">01</span>
                  <h2>Start with your space</h2>
                </div>
                <label htmlFor="brief">
                  What does a good workday look like?
                </label>
                <textarea
                  id="brief"
                  aria-describedby="brief-privacy"
                  disabled={!ready}
                  value={brief}
                  maxLength={600}
                  onChange={(e) => {
                    editWorkspace();
                    setBrief(e.target.value);
                  }}
                  placeholder="A quiet, warm workspace for coding, under $650..."
                />
                <p className="brief-privacy" id="brief-privacy">
                  Connected AI sends your brief to Google. Free-tier requests
                  may be used to improve Google products. Avoid personal
                  information.{' '}
                  <Link href="/about#privacy">How your brief is used</Link>
                </p>
                <div className="field-heading">
                  <label htmlFor="budget">Your budget</label>
                  <strong>{formatMoney(preferences.budgetCents)}</strong>
                </div>
                <input
                  id="budget"
                  disabled={!ready}
                  type="range"
                  min={Math.min(25000, preferences.budgetCents)}
                  max={Math.max(150000, preferences.budgetCents)}
                  step="2500"
                  value={preferences.budgetCents}
                  onChange={(e) =>
                    updatePreferences({
                      budgetCents: Number(e.target.value),
                    })
                  }
                />
                <div className="range-labels">
                  <span>$250</span>
                  <span>$1,500 CAD</span>
                </div>
                <label htmlFor="desk-width">Available desk width</label>
                <select
                  id="desk-width"
                  disabled={!ready}
                  value={preferences.deskWidthCm}
                  onChange={(e) =>
                    updatePreferences({
                      deskWidthCm: Number(e.target.value),
                    })
                  }
                >
                  {Array.from(
                    new Set([100, 120, 140, 160, 180, preferences.deskWidthCm]),
                  )
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <option key={w} value={w}>
                        {w} cm
                      </option>
                    ))}
                </select>
                <span className="field-label" id="style-label">
                  A feeling to start with
                </span>
                <div
                  className="style-options"
                  role="group"
                  aria-labelledby="style-label"
                >
                  {(['warm', 'minimal', 'studio'] as Style[]).map((s) => (
                    <button
                      disabled={!ready}
                      aria-pressed={preferences.style === s}
                      className={preferences.style === s ? 'selected' : ''}
                      key={s}
                      onClick={() => updatePreferences({style: s})}
                    >
                      <span className={`style-dot ${s}`} />
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    disabled={!ready}
                    checked={preferences.quiet}
                    onChange={(e) =>
                      updatePreferences({quiet: e.target.checked})
                    }
                  />{' '}
                  Keep the keyboard quiet
                </label>
                <button
                  className="button primary full"
                  onClick={generate}
                  disabled={busy || !ready || catalogLoading || !!catalogError}
                >
                  <Sparkles size={17} />
                  {busy ? 'Finding your fit…' : 'Build my workspace'}
                  <ArrowRight size={16} />
                </button>
                <p className="engine-note">
                  {engine === 'gemini'
                    ? 'AI interprets your brief. Verified rules check every fit.'
                    : 'Preference matching with verified budget and fit rules.'}
                </p>
                {engineNotices.length > 0 && (
                  <p className="engine-note">{engineNotices.join(' ')}</p>
                )}
                {requestError && (
                  <p role="alert" className="error-message">
                    {requestError}
                  </p>
                )}
              </aside>
              <div className="builder-main">
                <div className="builder-scene">
                  <WorkspaceScene
                    products={selected}
                    deskWidthCm={preferences.deskWidthCm}
                    interactive
                    className="config-scene"
                  />
                </div>
                <div className="build-summary">
                  <div>
                    <span className="eyebrow">YOUR WORKSPACE</span>
                    <strong>
                      {formatMoney(total)} <small>CAD</small>
                    </strong>
                    <span
                      className={
                        valid ? 'build-status' : 'build-status warning'
                      }
                    >
                      {valid ? <Check size={14} /> : <CircleHelp size={14} />}{' '}
                      {valid
                        ? `${formatMoney(preferences.budgetCents - total)} inside your budget`
                        : validation.warnings[0] || 'Review this selection'}
                    </span>
                  </div>
                  <div className="summary-actions">
                    <button
                      className="icon-button outlined"
                      onClick={share}
                      aria-label="Share this workspace"
                      disabled={!selected.length}
                    >
                      <Copy size={17} />
                    </button>
                    <button
                      className="button dark"
                      onClick={(event) =>
                        addToCart(selected, event.currentTarget)
                      }
                      disabled={
                        !valid || !ready || catalogLoading || !!catalogError
                      }
                    >
                      Add setup to bag <ShoppingBag size={17} />
                    </button>
                  </div>
                </div>
                <details className="setup-explanation">
                  <summary>
                    {valid ? 'Why this setup fits' : 'Review this setup'}
                  </summary>
                  <ul>
                    {(valid ? validation.reasons : validation.warnings).map(
                      (reason) => (
                        <li key={reason}>{reason}</li>
                      ),
                    )}
                  </ul>
                  {validation.compromises.length > 0 && (
                    <div className="setup-compromises">
                      <strong>A few compromises</strong>
                      <ul>
                        {validation.compromises.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p>
                    Fit uses published footprints in a fixed layout. It does not
                    assess ergonomics or load ratings. Styling props are not
                    included.
                  </p>
                </details>
                {shareUrl && (
                  <label className="share-field">
                    Share your workspace
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
                <div className="customize">
                  <div className="panel-heading">
                    <span className="number">02</span>
                    <h2>Make the details yours</h2>
                    <span>Swap a piece. Find your fit.</span>
                  </div>
                  <div className="filter-tabs">
                    {categories.map((c) => (
                      <button
                        key={c}
                        aria-pressed={builderCategory === c}
                        className={builderCategory === c ? 'active' : ''}
                        onClick={() => setBuilderCategory(c)}
                      >
                        {labels[c]}
                      </button>
                    ))}
                  </div>
                  <div className="choice-grid">
                    {catalog
                      .filter((p) => p.category === builderCategory)
                      .map((p) => (
                        <button
                          key={p.id}
                          disabled={!p.available || !ready}
                          aria-pressed={selectedIds.includes(p.id)}
                          className={`product-choice ${selectedIds.includes(p.id) ? 'selected' : ''}`}
                          onClick={() => selectProduct(p)}
                        >
                          <ProductVisual product={p} />
                          <strong>{p.name}</strong>
                          <span>
                            {formatMoney(p.priceCents)} · {p.widthCm} cm
                          </span>
                          {selectedIds.includes(p.id) && (
                            <i>
                              <Check size={14} />
                            </i>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
                <div className="why-panel">
                  <Heart size={17} />
                  <div>
                    <strong>Thoughtful by design</strong>
                    <p>
                      {valid
                        ? 'These pieces pass budget, availability, desk-fit and keyboard checks. Styling props in the preview are not included in your bag.'
                        : validation.warnings.join(' ')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        {page === 'about' && (
          <section className="section about-page">
            <p className="eyebrow">
              A STORE. A STUDIO. AN ENGINEERING PROJECT.
            </p>
            <h1>
              A little more
              <br />
              <em>thought behind it.</em>
            </h1>
            <p className="about-lede">
              DeskLab explores how shopping can become a useful design tool.
              Start with a space and a few preferences. End with a workspace
              that fits.
            </p>
            <div className="about-grid">
              <article>
                <span>01 / THE EXPERIENCE</span>
                <h2>Make space tangible.</h2>
                <p>
                  An original catalog, an interactive 3D workspace, accessible
                  controls and shareable configurations turn a shopping list
                  into something you can explore.
                </p>
              </article>
              <article id="privacy">
                <span>02 / THE INTELLIGENCE</span>
                <h2>Let rules do the checking.</h2>
                <p>
                  AI can interpret a brief when a model is connected. A
                  deterministic solver checks budget, dimensions, stock and
                  keyboard preferences. Without a model, structured controls and
                  preference matching remain available.
                </p>
                <p>
                  When connected AI is enabled, your brief and preferences are
                  sent to Google Gemini. Google may use free-tier requests to
                  improve its products. Do not include personal or confidential
                  information. The structured controls also work without a
                  written brief.
                </p>
              </article>
              <article>
                <span>03 / THE COMMERCE</span>
                <h2>Keep the source of truth.</h2>
                <p>
                  When connected, Shopify owns live prices, inventory and
                  checkout. The app rechecks products before creating a cart.
                  Checkout is enabled only after the store is configured for
                  test payments. There is no physical fulfillment.
                </p>
              </article>
              <article>
                <span>04 / THE PROOF</span>
                <h2>Built to be inspected.</h2>
                <p>
                  The source, test suite and setup documentation are public.
                  Demo mode is labeled and live integration status is stated
                  explicitly.
                </p>
                <a
                  className="text-link"
                  href="https://github.com/Saadullah-2004/desklab"
                  target="_blank"
                  rel="noreferrer"
                >
                  Explore the source <MoveUpRight size={15} />
                </a>
              </article>
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <Link href="/" className="wordmark">
            desk<span>lab</span>
            <i />
          </Link>
          <p>
            A good place to start.
            <br />A better place to work.
          </p>
          <div>
            <Link href="/shop">The collection</Link>
            <Link href="/builder">Workspace studio</Link>
            <Link href="/about">Behind the build</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} DeskLab. A portfolio project by Saad
            Shahzad.
          </span>
          <span className="demo-status">
            <span className="dot" />
            {catalogError
              ? 'Catalog unavailable · Preview only'
              : catalogLoading
                ? 'Checking catalog · Preview only'
                : source === 'demo'
                  ? 'Demo catalog · No physical fulfillment'
                  : checkoutEnabled
                    ? 'Shopify catalog · Test checkout'
                    : 'Shopify catalog · Checkout disabled'}
          </span>
          <a
            href="https://github.com/Saadullah-2004/desklab"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <MoveUpRight size={12} />
          </a>
        </div>
      </footer>
      {notice && (
        <div role="status" className="toast">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetailId(null)} wide>
          <div className="product-detail">
            <ProductVisual product={detail} />
            <div>
              <p className="eyebrow">
                {labels[detail.category]} / DESKLAB ORIGINAL
              </p>
              <h3>{detail.subtitle}</h3>
              <p>{detail.description}</p>
              <strong className="detail-price">
                {formatMoney(detail.priceCents)} CAD
              </strong>
              <dl>
                <div>
                  <dt>Finish</dt>
                  <dd>{detail.finish}</dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {detail.widthCm} × {detail.depthCm} cm
                  </dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{detail.available ? 'Available' : 'Out of stock'}</dd>
                </div>
              </dl>
              <button
                className="button dark full"
                disabled={
                  !detail.available ||
                  !ready ||
                  catalogLoading ||
                  !!catalogError
                }
                onClick={(event) => {
                  addToCart([detail], event.currentTarget);
                  setDetailId(null);
                }}
              >
                Add to bag <Plus size={17} />
              </button>
              <p className="small-note">
                Original demo product. No physical fulfillment.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {cartOpen && (
        <Modal
          title={`Your bag (${cartCount})`}
          onClose={() => setCartOpen(false)}
        >
          {returnedFromCheckout && (
            <div className="demo-callout checkout-return" role="status">
              <div>
                <strong>Your bag is still here.</strong>
                <p>
                  DeskLab cannot confirm whether your Shopify order was
                  completed. Check Shopify for confirmation before submitting
                  again. Clear your bag when you are finished.
                </p>
                <button
                  className="text-link"
                  onClick={() => setReturnedFromCheckout(false)}
                >
                  Dismiss checkout notice
                </button>
              </div>
            </div>
          )}
          {cart.length ? (
            <>
              <div className="cart-lines">
                {missingCart.map((line) => (
                  <div className="demo-callout" key={line.productId}>
                    <span>
                      A saved item is no longer available in this catalog.
                    </span>
                    <button
                      className="text-link"
                      onClick={() =>
                        setCart((old) =>
                          old.filter(
                            (item) => item.productId !== line.productId,
                          ),
                        )
                      }
                    >
                      Remove unavailable item
                    </button>
                  </div>
                ))}
                {cartProducts.map((l) => (
                  <article className="cart-line" key={l.productId}>
                    <div className="cart-art">
                      <ProductVisual product={l.product} />
                    </div>
                    <div>
                      <h3>{l.product.name}</h3>
                      <p>{l.product.finish}</p>
                      <div className="quantity">
                        <button
                          disabled={checkoutBusy}
                          aria-label={`Decrease ${l.product.name} quantity`}
                          onClick={() => quantity(l.productId, -1)}
                        >
                          <Minus size={13} />
                        </button>
                        <span>{l.quantity}</span>
                        <button
                          aria-label={`Increase ${l.product.name} quantity`}
                          onClick={() => quantity(l.productId, 1)}
                          disabled={checkoutBusy || l.quantity >= 10}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                    <strong>
                      {formatMoney(l.quantity * l.product.priceCents)}
                    </strong>
                  </article>
                ))}
              </div>
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>{formatMoney(cartTotal)} CAD</strong>
              </div>
              <p className="small-note">
                Shipping and taxes are calculated by Shopify at checkout.
              </p>
              {checkoutEnabled && (
                <div className="demo-callout">
                  <CircleHelp size={18} />
                  <div>
                    <strong>
                      Test payments only. No physical fulfillment.
                    </strong>
                    <p>
                      Use the test payment details shown by the configured
                      Shopify gateway. Do not enter a real payment card.
                    </p>
                  </div>
                </div>
              )}
              {!checkoutEnabled && (
                <div className="demo-callout">
                  <CircleHelp size={18} />
                  <div>
                    <strong>Explore freely. This is a demo.</strong>
                    <p>
                      {catalogError ||
                        (source === 'shopify'
                          ? 'Test checkout is currently disabled. Your bag stays saved on this device.'
                          : 'Shopify checkout is not connected yet. Your bag stays saved on this device.')}
                    </p>
                  </div>
                </div>
              )}
              <button
                className="button dark full"
                disabled={
                  !checkoutEnabled ||
                  checkoutBusy ||
                  catalogLoading ||
                  !!catalogError ||
                  missingCart.length > 0
                }
                onClick={checkout}
              >
                {checkoutBusy
                  ? 'Opening secure checkout…'
                  : checkoutEnabled
                    ? 'Continue to test checkout'
                    : source === 'shopify'
                      ? 'Test checkout disabled'
                      : 'Checkout not connected'}
                <ArrowRight size={17} />
              </button>
              {checkoutError && (
                <p role="alert" className="error-message">
                  {checkoutError}
                </p>
              )}
              {returnedFromCheckout && (
                <button
                  className="text-link continue"
                  disabled={checkoutBusy}
                  onClick={() => {
                    setCart([]);
                    setReturnedFromCheckout(false);
                    setCheckoutError('');
                  }}
                >
                  Clear bag
                </button>
              )}
              <button
                className="text-link continue"
                onClick={() => setCartOpen(false)}
              >
                A little more exploring <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <div className="empty-bag">
              <ShoppingBag size={38} strokeWidth={1} />
              <h3>A little room for possibility.</h3>
              <p>Your bag is empty. Find a few things that feel like you.</p>
              <Link
                href="/shop"
                className="button primary"
                onClick={() => setCartOpen(false)}
              >
                Explore the collection <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
