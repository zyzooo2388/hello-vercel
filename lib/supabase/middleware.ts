import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseEnv } from "./env"

type UpdateSessionResult = {
    response: NextResponse
    supabase: SupabaseClient
}

export const updateSession = async (
    request: NextRequest
): Promise<UpdateSessionResult> => {
    const { url, anonKey } = getSupabaseEnv()
    const response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const supabase = createServerClient(url, anonKey, {
        cookies: {
            get(name) {
                return request.cookies.get(name)?.value
            },
            set(name, value, options) {
                response.cookies.set({ name, value, ...options })
            },
            remove(name, options) {
                response.cookies.set({ name, value: "", ...options })
            },
        },
    })

    await supabase.auth.getClaims()

    return { response, supabase }
}
