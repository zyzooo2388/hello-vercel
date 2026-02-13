"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import type { Session } from "@supabase/supabase-js"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

const getSafeNext = (value: string | null) => {
    if (!value) return "/protected"
    return value.startsWith("/") ? value : "/protected"
}

function LoginClient() {
    const searchParams = useSearchParams()
    const nextValue = useMemo(
        () => getSafeNext(searchParams.get("next")),
        [searchParams]
    )
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [session, setSession] = useState<Session | null>(null)

    useEffect(() => {
        const supabase = createSupabaseBrowserClient()
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session ?? null)
        })
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession)
        })

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const handleGoogleSignIn = async () => {
        if (loading) return
        setLoading(true)
        setError(null)

        const secure = window.location.protocol === "https:" ? "; Secure" : ""
        document.cookie = `sb-next=${encodeURIComponent(nextValue)}; Path=/; Max-Age=600; SameSite=Lax${secure}`

        const supabase = createSupabaseBrowserClient()
        const { error: signInError } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        })

        if (signInError) {
            setError(signInError.message)
            setLoading(false)
        }
    }

    const handleSignOut = async () => {
        if (loading) return
        setLoading(true)
        setError(null)
        const supabase = createSupabaseBrowserClient()
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) {
            setError(signOutError.message)
        }
        setLoading(false)
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-eyebrow">Welcome back</div>
                <h1>Sign in to continue</h1>
                <p>Access the private gallery and manage your view.</p>
                <button
                    type="button"
                    className="login-button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                >
                    {loading ? "Redirecting…" : "Continue with Google"}
                </button>
                {session && (
                    <button
                        type="button"
                        className="login-secondary"
                        onClick={handleSignOut}
                        disabled={loading}
                    >
                        {loading ? "Signing out…" : "Sign out"}
                    </button>
                )}
                {error && <div className="login-error">{error}</div>}
            </div>

            <style jsx global>{`
                :root {
                    color-scheme: light;
                }

                body {
                    margin: 0;
                    font-family: "Helvetica Neue", "Nimbus Sans", Arial, sans-serif;
                    color: #1f2428;
                }

                .login-page {
                    min-height: 100vh;
                    display: grid;
                    place-items: center;
                    padding: 32px;
                    position: relative;
                    overflow: hidden;
                    background: radial-gradient(
                            circle at top left,
                            rgba(255, 238, 214, 0.9),
                            rgba(255, 238, 214, 0)
                    ),
                    radial-gradient(
                            circle at 20% 20%,
                            rgba(198, 232, 255, 0.8),
                            rgba(198, 232, 255, 0)
                    ),
                    radial-gradient(
                            circle at 80% 0%,
                            rgba(255, 206, 222, 0.75),
                            rgba(255, 206, 222, 0)
                    ),
                    linear-gradient(140deg, #f7f5f2, #f0f4ff 60%, #fff7f1 100%);
                }

                .login-page::after {
                    content: "";
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    opacity: 0.18;
                    mix-blend-mode: multiply;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
                }

                .login-card {
                    position: relative;
                    z-index: 1;
                    width: min(420px, 100%);
                    padding: 32px 30px 28px;
                    border-radius: 24px;
                    background: rgba(255, 255, 255, 0.8);
                    border: 1px solid rgba(31, 36, 40, 0.12);
                    box-shadow: 0 24px 60px rgba(31, 36, 40, 0.14);
                    backdrop-filter: blur(8px);
                }

                .login-eyebrow {
                    text-transform: uppercase;
                    letter-spacing: 0.16em;
                    font-size: 0.7rem;
                    color: #6b7280;
                    font-weight: 700;
                    margin-bottom: 10px;
                }

                .login-card h1 {
                    margin: 0 0 8px;
                    font-size: 1.9rem;
                }

                .login-card p {
                    margin: 0 0 20px;
                    color: #4a4f55;
                }

                .login-button {
                    width: 100%;
                    padding: 14px 18px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.2);
                    background: rgba(255, 255, 255, 0.85);
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
                }

                .login-secondary {
                    width: 100%;
                    margin-top: 12px;
                    padding: 12px 18px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.15);
                    background: rgba(255, 255, 255, 0.55);
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
                }

                .login-button:disabled {
                    cursor: default;
                    opacity: 0.7;
                    transform: none;
                    box-shadow: none;
                }

                .login-secondary:disabled {
                    cursor: default;
                    opacity: 0.7;
                    transform: none;
                    box-shadow: none;
                }

                .login-button:not(:disabled):hover {
                    transform: translateY(-1px);
                    box-shadow: 0 10px 22px rgba(31, 36, 40, 0.18);
                }

                .login-secondary:not(:disabled):hover {
                    transform: translateY(-1px);
                    box-shadow: 0 8px 18px rgba(31, 36, 40, 0.14);
                }

                .login-error {
                    margin-top: 16px;
                    font-size: 0.9rem;
                    color: #b42318;
                }
            `}</style>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="login-page" />}>
            <LoginClient />
        </Suspense>
    )
}
