import { createClient } from "@supabase/supabase-js";

export const getSupabaseConfig = () => {
  if (typeof window === "undefined") {
    return {
      url: process.env.SUPABASE_URL || "",
      key: process.env.SUPABASE_ANON_KEY || "",
    };
  }

  // Frontend environment
  const envUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL || "";
  const envKey = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY || "";

  let localUrl = "";
  let localKey = "";
  try {
    if (typeof localStorage !== "undefined") {
      localUrl = localStorage.getItem("quizcrack_supabase_url") || "";
      localKey = localStorage.getItem("quizcrack_supabase_key") || "";
    }
  } catch {
    // Storage restricted or unavailable
  }

  return {
    url: envUrl || localUrl,
    key: envKey || localKey,
  };
};

export const getSupabaseClient = () => {
  try {
    const { url, key } = getSupabaseConfig();
    if (url && key && url.trim().length > 0 && key.trim().length > 0) {
      let cleanUrl = url.trim();
      if (cleanUrl.endsWith("/rest/v1/")) {
        cleanUrl = cleanUrl.slice(0, -9);
      } else if (cleanUrl.endsWith("/rest/v1")) {
        cleanUrl = cleanUrl.slice(0, -8);
      }
      return createClient(cleanUrl, key.trim());
    }
  } catch (err) {
    console.warn("Could not initialize Supabase client:", err);
  }
  return null;
};
