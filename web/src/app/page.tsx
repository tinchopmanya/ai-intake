import Link from "next/link";

export default async function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL!;
  const res = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  const data = await res.json();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">AI Intake</h1>
      <div className="mt-3 flex gap-2">
        <Link href="/chat" className="rounded bg-gray-900 px-3 py-2 text-sm text-white">
          Ir a Chat
        </Link>
        <Link href="/advisor" className="rounded border border-gray-300 px-3 py-2 text-sm">
          Ir a Advisor
        </Link>
      </div>
      <p className="mt-2 text-sm text-gray-600">Backend health:</p>
      <pre className="mt-4 rounded bg-gray-100 p-4">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
