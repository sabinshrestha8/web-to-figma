"use client";

import { useState } from "react";

/** A form dialog that only exists after a click: the `clickSelectors` fixture. */
export default function DialogPage() {
  const [open, setOpen] = useState(false);
  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold">Employees</h1>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-white"
      >
        Add employee
      </button>
      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40">
          <form
            role="dialog"
            data-testid="employee-dialog"
            className="w-96 rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold">New employee</h2>
            <input placeholder="Full name" className="mt-4 w-full rounded-md border border-slate-300 p-2" />
          </form>
        </div>
      )}
    </main>
  );
}
