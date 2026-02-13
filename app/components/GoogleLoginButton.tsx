"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

type GoogleLoginButtonProps = {
    className?: string
    children?: string
}

export default function GoogleLoginButton({
    className,
    children = "Continue with Google",
}: GoogleLoginButtonProps) {
    const [loading, setLoading] = useState(false)

    const handleClick = async () => {
        if (loading) return
        setLoading(true)

        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        })

        if (error) {
            setLoading(false)
        }
    }

    return (
        <button
            type="button"
            className={className}
            onClick={handleClick}
            disabled={loading}
        >
            {loading ? "Redirecting..." : children}
        </button>
    )
}
