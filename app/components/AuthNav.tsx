"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"

export default function AuthNav() {
    const supabase = useMemo(() => createClient(), [])
    const [hasSession, setHasSession] = useState(false)

    useEffect(() => {
        let isMounted = true

        supabase.auth.getSession().then(({ data }) => {
            if (!isMounted) return
            setHasSession(Boolean(data.session))
        })

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!isMounted) return
            setHasSession(Boolean(nextSession))
        })

        return () => {
            isMounted = false
            subscription.unsubscribe()
        }
    }, [supabase])

    if (!hasSession) {
        return null
    }

    return (
        <header style={styles.navShell}>
            <nav style={styles.nav}>
                <Link href="/" style={styles.navLink}>
                    Vote
                </Link>
                <Link href="/upload" style={styles.navLink}>
                    Upload
                </Link>
            </nav>
            <p style={styles.navDescription}>
                Vote on whether the caption is humorous, or upload your own image to generate creative and
                interesting captions.
            </p>
        </header>
    )
}

const styles: Record<string, React.CSSProperties> = {
    navShell: {
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(255,255,255,0.85)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        backdropFilter: "blur(10px)",
    },
    nav: {
        maxWidth: 960,
        margin: "0 auto",
        padding: "12px 20px",
        display: "flex",
        gap: 16,
        alignItems: "center",
    },
    navLink: {
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 600,
        color: "#2c2c2c",
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.7)",
    },
    navDescription: {
        maxWidth: 960,
        margin: "12px auto 14px",
        padding: "0 20px 12px",
        fontSize: 14,
        lineHeight: 1.5,
        color: "#6b6b6b",
    },
}
