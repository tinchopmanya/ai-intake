import { AppShell } from "@/components/mvp/AppShell";
import { WizardScaffold } from "@/components/mvp/WizardScaffold";
import { API_URL } from "@/lib/config";

export default function MvpPage() {
  return (
    <AppShell>
      <section className="mb-4 rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-medium">Configuracion API</h2>
        <p className="mt-1 text-sm text-gray-700">
          Backend base URL: <code>{API_URL}</code>
        </p>
      </section>

      <WizardScaffold />
    </AppShell>
  );
}

