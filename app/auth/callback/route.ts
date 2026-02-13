import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSupabaseEnv } from "@/lib/supabase/env"

const getSafeNext = (value: string | null | undefined) => {
    if (!value) return "/protected"
    return value.startsWith("/") ? value : "/protected"
}

export async function GET(request: Request) {
    const { url, anonKey } = getSupabaseEnv()
    const cookieStore = await cookies()
    const response = new NextResponse()

    const supabase = createServerClient(url, anonKey, {
        cookies: {
            get(name) {
                return cookieStore.get(name)?.value
            },
            set(name, value, options) {
                response.cookies.set({ name, value, ...options })
            },
            remove(name, options) {
                response.cookies.set({ name, value: "", ...options })
            },
        },
    })

    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")

    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
            const errorRedirect = NextResponse.redirect(new URL("/login", request.url))
            response.cookies.getAll().forEach((cookie) => {
                errorRedirect.cookies.set(cookie)
            })
            errorRedirect.cookies.set({ name: "sb-next", value: "", path: "/", maxAge: 0 })
            return errorRedirect
        }
    }

    const nextFromQuery = searchParams.get("next")
    const nextFromCookie = cookieStore.get("sb-next")?.value
    const nextValue = getSafeNext(nextFromQuery ?? nextFromCookie ?? "/protected")

    const redirectResponse = NextResponse.redirect(new URL(nextValue, request.url))
    response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie)
    })
    redirectResponse.cookies.set({ name: "sb-next", value: "", path: "/", maxAge: 0 })

    return redirectResponse
}
