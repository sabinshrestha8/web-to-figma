/** Phase 4 typography: paragraphs with mixed inline styles, decorations, shadows and font stacks. */
export default function Article() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16 text-slate-800">
      <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Field notes</p>
      <h1
        data-testid="title"
        className="mt-2 text-4xl leading-tight font-bold [text-shadow:0_2px_4px_rgb(0_0_0/0.25)]"
      >
        Reading the rendered page
      </h1>
      <p data-testid="intro" className="mt-6 text-lg leading-8">
        Converters work from <strong>what the browser drew</strong>, not from the source. A paragraph with{" "}
        <em>emphasis</em>, a{" "}
        <a href="#runs" className="text-indigo-600 underline">
          link with <strong>bold</strong> inside
        </a>{" "}
        and <span className="text-rose-600">colored words</span> still becomes a single text layer, wrapped at
        the same width as in the browser.
      </p>
      <p data-testid="decorations" className="mt-4 leading-7">
        Prices drop from <del>$40</del> to <ins>$25</ins> this week.
      </p>
      <p data-testid="inline-box" className="mt-4 leading-7">
        Run <code className="rounded bg-slate-100 px-1 font-mono text-sm">pnpm w2f</code> against any page.
      </p>
      <p data-testid="breaks" className="mt-4 leading-7">
        First line
        <br />
        Second line
      </p>
      <p
        data-testid="missing-font"
        className="mt-4"
        style={{ fontFamily: '"W2F Missing Serif", Georgia, serif' }}
      >
        This line asks for a font Figma does not have.
      </p>
    </article>
  );
}
