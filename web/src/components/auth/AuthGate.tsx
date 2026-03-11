"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/client";

type AuthGateProps = {
  children: React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function verifySession() {
      const user = await getCurrentUser();
      if (!mounted) return;
      if (!user) {
        const next = encodeURIComponent(pathname || "/mvp");
        router.replace(`/login?next=${next}`);
        return;
      }
      setReady(true);
    }

    verifySession();
    return () => {
      mounted = false;
    };
  }, [pathname, router]);

  if (!ready) {
    return <p className="text-sm text-gray-600">Validando sesion...</p>;
  }

  return <>{children}</>;
}
