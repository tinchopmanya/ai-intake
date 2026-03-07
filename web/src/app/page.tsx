import Image from "next/image";
export default async function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL!;
  const res = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  const data = await res.json();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">AI Intake</h1>
      <p className="mt-2 text-sm text-gray-600">Backend health:</p>
      <pre className="mt-4 rounded bg-gray-100 p-4">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}