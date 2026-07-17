import { createClient } from "@supabase/supabase-js";

export const getSupabaseConfig = () => {
  if (typeof window === "undefined") {
    return {
      url: process.env.SUPABASE_URL || "",
      key: process.env.SUPABASE_ANON_KEY || "",
    };
  }

  // Frontend environment
  const envUrl = (import.meta as any).env.VITE_SUPABASE_URL || "";
  const envKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || "";

  const localUrl = localStorage.getItem("quizcrack_supabase_url") || "";
  const localKey = localStorage.getItem("quizcrack_supabase_key") || "";

  return {
    url: envUrl || localUrl,
    key: envKey || localKey,
  };
};

export const getSupabaseClient = () => {
  const { url, key } = getSupabaseConfig();
  if (url && key) {
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith("/rest/v1/")) {
      cleanUrl = cleanUrl.slice(0, -9);
    } else if (cleanUrl.endsWith("/rest/v1")) {
      cleanUrl = cleanUrl.slice(0, -8);
    }
    return createClient(cleanUrl, key);
  }
  return null;
};

