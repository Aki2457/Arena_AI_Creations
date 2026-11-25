import { useState } from "react";

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <main className="card">
      <p className="eyebrow">Deployed with Vercel</p>
      <h1>Hello, World!</h1>
      <p className="subtitle">
        This is a simple Next.js site hosted on Vercel and published from GitHub.
      </p>
      <button
        id="click-me"
        className="button"
        onClick={() => setCount((c) => c + 1)}
      >
        Click me
      </button>
      <p className="counter" aria-live="polite">
        {count > 0 ? `You clicked ${count} time${count === 1 ? "" : "s"}.` : ""}
      </p>
      <footer className="footer">
        <span>Built with ❤️ · GitHub + Vercel</span>
      </footer>
    </main>
  );
}
