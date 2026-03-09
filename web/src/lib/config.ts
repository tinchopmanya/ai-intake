const fallbackApiUrl = "http://localhost:8000";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  fallbackApiUrl;

