import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { getSupabaseEnv } from "./env"

export const createSupabaseServerClient = async (): Promise<SupabaseClient> => {
    const cookieStore = await cookies()
    const { url, anonKey } = getSupabaseEnv()

    return createServerClient(url, anonKey, {
        cookies: {
            get(name) {
                return cookieStore.get(name)?.value
            },
            set(name, value, options) {
                cookieStore.set({ name, value, ...options })
            },
            remove(name, options) {
                cookieStore.set({ name, value: "", ...options })
            },
        },
    })
}
