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
                    <span style={styles.navLinkLabel}>Vote</span>
                    <span style={styles.navLinkHint}>Rate captions in seconds</span>
                </Link>
                <Link href="/upload" style={styles.navLink}>
                    <span style={styles.navLinkLabel}>Upload</span>
                    <span style={styles.navLinkHint}>Upload an image to generate captions</span>
                </Link>
            </nav>
            <p style={styles.navDescription}>
                Vote to shape what rises to the top, then check the leaderboard to see what people love.
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
        fontWeight: 700,
        color: "#2c2c2c",
        padding: "8px 12px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.7)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
    },
    navLinkLabel: {
        fontSize: 13.5,
        fontWeight: 750,
        letterSpacing: "0.2px",
    },
    navLinkHint: {
        fontSize: 12.5,
        fontWeight: 500,
        color: "#6b6b6b",
        lineHeight: 1.2,
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
