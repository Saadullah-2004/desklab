'use client';
import Link from 'next/link';
export default function ErrorPage({reset}: {reset: () => void}) {
  return (
    <main className="error-page">
      <p className="eyebrow">A SMALL INTERRUPTION</p>
      <h1>Let’s try that again.</h1>
      <p>
        We couldn’t load this workspace. Your saved cart is still on this
        device.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <Link className="text-link" href="/">
        Back to DeskLab
      </Link>
    </main>
  );
}
