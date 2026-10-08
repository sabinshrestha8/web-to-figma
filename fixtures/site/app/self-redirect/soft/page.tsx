import { RedirectAfterLoad } from "../redirect.tsx";

// Client-side router navigation (no new document) after load.
export default function SoftSelfRedirect() {
  return <RedirectAfterLoad to="/landing" mode="soft" />;
}
