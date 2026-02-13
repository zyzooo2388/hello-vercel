import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

let browserClient: SupabaseClient | null = null

export const createClient = (): SupabaseClient => {
    if (!browserClient) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !anonKey) {
            throw new Error(
                "Missing Supabase env vars. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
            )
        }
        browserClient = createBrowserClient(url, anonKey)
    }

    return browserClient
}

export const createSupabaseBrowserClient = createClient
