import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="error-page">
      <p className="eyebrow">404 / OUT OF PLACE</p>
      <h1>This isn’t your workspace.</h1>
      <p>The page may have moved. There is still plenty to explore.</p>
      <Link className="button primary" href="/">
        Back to DeskLab
      </Link>
    </main>
  );
}
