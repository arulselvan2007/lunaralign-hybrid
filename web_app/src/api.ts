/**
 * LunarAlign-Hybrid: Cloud API & Backend Routing Configuration
 * =============================================================
 * Supports dynamic backend injection for Vercel -> Hugging Face Docker Spaces deployment.
 *
 * Environment Variable:
 *   NEXT_PUBLIC_BACKEND_URL - Absolute URL to the deployed FastAPI/Docker backend
 *                             e.g., "https://syntrix-lunaralign-api.hf.space"
 * Fallback:
 *   Placeholder: "https://your-huggingface-space-name.hf.space"
 */

export const BACKEND_URL: string =
  process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
  "https://your-huggingface-space-name.hf.space";

/**
 * Resolve an API endpoint path to the full backend URL.
 * Example: getApiUrl("/api/match") -> "https://your-space.hf.space/api/match"
 */
export function getApiUrl(path: string): string {
  if (!path) return BACKEND_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_URL}${cleanPath}`;
}

/**
 * Resolve a backend asset path (e.g., /static/... or generated heatmaps/warped imagery)
 * to the full cloud backend URL.
 * Preserves local Next.js static assets (/textures/...) within the frontend domain.
 */
export function getAssetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  ) {
    return path;
  }
  // Keep local Next.js public textures on the local Vercel domain
  if (path.startsWith("/textures/")) {
    return path;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_URL}${cleanPath}`;
}

const apiConfig = {
  BACKEND_URL,
  getApiUrl,
  getAssetUrl,
};

export default apiConfig;
