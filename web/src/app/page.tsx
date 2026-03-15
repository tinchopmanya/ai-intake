import Link from "next/link";
import { API_URL } from "@/lib/config";

/**
 * Landing page that verifies backend availability and links to key flows.
 */
export default async function Home() {
  const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
  const data = await res.json();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">AI Intake</h1>
      <div className="mt-3 flex gap-2">
        <Link href="/login" className="rounded border border-gray-300 px-3 py-2 text-sm">
          Login
        </Link>
        <Link href="/onboarding" className="rounded border border-gray-300 px-3 py-2 text-sm">
          Onboarding
        </Link>
        <Link href="/mvp" className="rounded bg-gray-900 px-3 py-2 text-sm text-white">
          MVP
        </Link>
      </div>
      <p className="mt-2 text-sm text-gray-600">Backend health:</p>
      <pre className="mt-4 rounded bg-gray-100 p-4">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
