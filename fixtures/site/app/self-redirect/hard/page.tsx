import { RedirectAfterLoad } from "../redirect.tsx";

// Full document navigation (location.replace) after load, to a destination that takes 6s and then
// redirects again: covers a pending navigation plus a page-initiated 3xx.
export default function HardSelfRedirect() {
  return <RedirectAfterLoad to="/self-redirect/slow" mode="hard" />;
}
