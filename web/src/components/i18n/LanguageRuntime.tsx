"use client";

import { useEffect } from "react";

import { resolveRuntimeLocale } from "@/lib/i18n/runtime";

export function LanguageRuntime() {
  useEffect(() => {
    const locale = resolveRuntimeLocale();
    document.documentElement.lang = locale;
  }, []);

  return null;
}
