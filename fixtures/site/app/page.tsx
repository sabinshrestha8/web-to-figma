const ROUTES = [
  "/landing",
  "/card-grid",
  "/boxes",
  "/hostile/redirect-ok",
  "/hostile/redirect-blocked",
  "/hostile/redirect-chain",
  "/self-redirect/hard",
  "/self-redirect/soft",
  "/hostile/blocked-subresource",
  "/auth",
  "/app-shell",
  "/article",
  "/image-heavy",
  "/svg-icons",
];

export default function Index() {
  return (
    <ul className="p-8">
      {ROUTES.map((r) => (
        <li key={r}>
          <a href={r}>{r}</a>
        </li>
      ))}
    </ul>
  );
}
