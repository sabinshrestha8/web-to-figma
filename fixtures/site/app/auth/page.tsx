import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Greeting } from "./greeting";

/** A logged-in page: without the session cookie it redirects, like a real auth guard. */
export default async function Private() {
  if ((await cookies()).get("w2f_session")?.value !== "fixture-session-token") redirect("/landing");
  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <Greeting />
    </main>
  );
}
