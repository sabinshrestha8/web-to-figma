"use client";
import { useEffect, useState } from "react";

/** Client-side half of a login: many apps keep the user in localStorage. */
export function Greeting() {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => setUser(localStorage.getItem("w2f_user")), []);
  return <p data-testid="greeting">{user ? `Signed in as ${user}` : "Anonymous"}</p>;
}
