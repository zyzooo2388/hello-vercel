"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type ImageRow = {
    id: number | string
    url: string
    image_description: string | null
}

type SortOption = "newest" | "az" | "za"

type GalleryClientProps = {
    initialImages?: ImageRow[]
    initialHasMore?: boolean
    initialError?: string | null
    initialLoading?: boolean
    showTopBar?: boolean
}

export default function GalleryClient({
    initialImages,
    initialHasMore,
    initialError = null,
    initialLoading,
    showTopBar = false,
}: GalleryClientProps) {
    const resolvedInitialImages = initialImages ?? []
    const resolvedInitialLoading =
        initialLoading ?? initialImages === undefined

    const [items, setItems] = useState<ImageRow[]>(resolvedInitialImages)
    const [loading, setLoading] = useState(resolvedInitialLoading)
    const [error, setError] = useState<string | null>(initialError)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(initialHasMore ?? false)
    const [logoutPending, setLogoutPending] = useState(false)

    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<SortOption>("newest")
    const [selected, setSelected] = useState<ImageRow | null>(null)
    const [newItemIds, setNewItemIds] = useState<Set<ImageRow["id"]>>(new Set())
    const modalRef = useRef<HTMLDivElement | null>(null)
    const lastFocusedRef = useRef<HTMLElement | null>(null)
    const router = useRouter()

    const pageSize = 20

    useEffect(() => {
        if (initialImages !== undefined) return
        let isMounted = true

        const load = async () => {
            const supabase = createSupabaseBrowserClient()
            const { data, error: fetchError } = await supabase
                .from("images")
                .select("id, url, image_description")
                .order("id", { ascending: false })
                .range(0, pageSize - 1)

            if (!isMounted) return

            if (fetchError) {
                setError(fetchError.message)
                setLoading(false)
                return
            }

            setItems((data ?? []) as ImageRow[])
            setHasMore((data ?? []).length === pageSize)
            setLoading(false)
        }

        load()

        return () => {
            isMounted = false
        }
    }, [initialImages, pageSize])

    const handleLoadMore = async () => {
        if (loadingMore || !hasMore) return
        setLoadingMore(true)

        const offset = items.length
        const supabase = createSupabaseBrowserClient()
        const { data, error: fetchError } = await supabase
            .from("images")
            .select("id, url, image_description")
            .order("id", { ascending: false })
            .range(offset, offset + pageSize - 1)

        if (fetchError) {
            setError(fetchError.message)
            setLoadingMore(false)
            return
        }

        const nextItems = (data ?? []) as ImageRow[]
        setItems((prev) => [...prev, ...nextItems])
        setHasMore(nextItems.length === pageSize)
        setLoadingMore(false)
        if (nextItems.length > 0) {
            setNewItemIds(new Set(nextItems.map((item) => item.id)))
        }
    }

    const filteredAndSorted = useMemo(() => {
        const query = search.trim().toLowerCase()

        let next = items.filter((img) => {
            const description = img.image_description?.trim() ?? ""

            // filter: search query
            if (query.length === 0) return true
            return description.toLowerCase().includes(query)
        })

        if (sort === "newest") {
            return next
        }

        if (sort === "az") {
            next = [...next].sort((a, b) => {
                const aDesc = a.image_description?.trim() ?? ""
                const bDesc = b.image_description?.trim() ?? ""
                return aDesc.localeCompare(bDesc)
            })
        }

        if (sort === "za") {
            next = [...next].sort((a, b) => {
                const aDesc = a.image_description?.trim() ?? ""
                const bDesc = b.image_description?.trim() ?? ""
                return bDesc.localeCompare(aDesc)
            })
        }

        return next
    }, [items, search, sort])

    const resultsCount = filteredAndSorted.length

    const handleReset = () => {
        setSearch("")
        setSort("newest")
    }

    const handleLogout = async () => {
        if (logoutPending) return
        setLogoutPending(true)
        const supabase = createSupabaseBrowserClient()
        await supabase.auth.signOut()
        router.push("/")
        router.refresh()
    }

    useEffect(() => {
        if (!selected) return

        lastFocusedRef.current = document.activeElement as HTMLElement | null
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelected(null)
            }

            if (event.key === "Tab") {
                const container = modalRef.current
                if (!container) return
                const focusable = container.querySelectorAll<HTMLElement>(
                    [
                        "button",
                        "[href]",
                        "input",
                        "select",
                        "textarea",
                        "[tabindex]:not([tabindex='-1'])",
                    ].join(",")
                )
                if (focusable.length === 0) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                const isShift = event.shiftKey

                if (!isShift && document.activeElement === last) {
                    event.preventDefault()
                    first.focus()
                }

                if (isShift && document.activeElement === first) {
                    event.preventDefault()
                    last.focus()
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        window.setTimeout(() => {
            const container = modalRef.current
            const firstFocusable = container?.querySelector<HTMLElement>(
                [
                    "button",
                    "[href]",
                    "input",
                    "select",
                    "textarea",
                    "[tabindex]:not([tabindex='-1'])",
                ].join(",")
            )
            firstFocusable?.focus()
        }, 0)
        return () => {
            window.removeEventListener("keydown", handleKeyDown)
            document.body.style.overflow = previousOverflow
            lastFocusedRef.current?.focus()
        }
    }, [selected])

    useEffect(() => {
        if (newItemIds.size === 0) return
        const timeout = window.setTimeout(() => {
            setNewItemIds(new Set())
        }, 650)
        return () => window.clearTimeout(timeout)
    }, [newItemIds])

    return (
        <div className="page">
            <div className="container">
                {showTopBar && (
                    <div className="topbar">
                        <div className="topbar-inner">
                            <div className="topbar-title">Gallery</div>
                            <button
                                type="button"
                                className="logout"
                                onClick={handleLogout}
                                disabled={logoutPending}
                            >
                                {logoutPending ? "Signing out" : "Logout"}
                            </button>
                        </div>
                    </div>
                )}
                <div className="filter-bar">
                    <div className="filter-inner">
                        <div className="filter-row">
                            <div className="field field-search">
                                <label htmlFor="search">Search</label>
                                <input
                                    id="search"
                                    type="search"
                                    placeholder="Search descriptions"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                />
                            </div>

                            <div className="field">
                                <label htmlFor="sort">Sort</label>
                                <select
                                    id="sort"
                                    value={sort}
                                    onChange={(event) =>
                                        setSort(event.target.value as SortOption)
                                    }
                                >
                                    <option value="newest">Newest</option>
                                    <option value="az">A–Z</option>
                                    <option value="za">Z–A</option>
                                </select>
                            </div>

                            <button className="reset" type="button" onClick={handleReset}>
                                Reset
                            </button>
                        </div>

                        <div className="results">{resultsCount} results</div>
                    </div>
                </div>
                <header className="header">
                    <h1>Images</h1>
                    <p>Browse the latest uploads and filter by description.</p>
                </header>

                {error ? (
                    <div className="state">{error}</div>
                ) : loading ? (
                    <div className="state">Loading images…</div>
                ) : (
                    <>
                        {resultsCount === 0 ? (
                            <div className="empty">
                                <h2>No matches</h2>
                                <p>Try adjusting your search or turning off filters.</p>
                            </div>
                        ) : (
                            <div className="grid">
                                {filteredAndSorted.map((img) => (
                                    <button
                                        key={img.id}
                                        type="button"
                                        className={`card${newItemIds.has(img.id) ? " is-new" : ""}`}
                                        onClick={() => setSelected(img)}
                                        aria-haspopup="dialog"
                                    >
                                        <div className="image-wrap">
                                            <img src={img.url} alt="" loading="lazy" />
                                        </div>
                                        <div className="card-body">
                                            <p className="card-description">
                                                {img.image_description?.trim()
                                                    ? img.image_description
                                                    : "No description"}
                                            </p>
                                        </div>
                                        <footer className="card-footer">View details</footer>
                                    </button>
                                ))}
                            </div>
                        )}

                        {hasMore && (
                            <div className="load-more">
                                <button
                                    type="button"
                                    className="load-more-button"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? (
                                        <>
                                            <span className="spinner" aria-hidden="true" />
                                            Loading…
                                        </>
                                    ) : (
                                        "Load more"
                                    )}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {selected && (
                <div
                    className="modal-backdrop"
                    role="presentation"
                    onClick={() => setSelected(null)}
                >
                    <div
                        className="modal"
                        ref={modalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="image-modal-title"
                        aria-describedby="image-modal-description"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="modal-close"
                            onClick={() => setSelected(null)}
                            aria-label="Close dialog"
                        >
                            ×
                        </button>
                        <div className="modalImageWrap" id="image-modal-title">
                            <img src={selected.url} alt="" />
                        </div>
                        <div className="modal-body" id="image-modal-description">
                            <div className="modalDescription">
                                {selected.image_description?.trim()
                                    ? selected.image_description
                                    : "No description provided."}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                :root {
                    color-scheme: light;
                }

                body {
                    margin: 0;
                    font-family: "Helvetica Neue", "Nimbus Sans", Arial, sans-serif;
                    color: #1f2428;
                }

                .page {
                    min-height: 100vh;
                    position: relative;
                    overflow-x: hidden;
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

                .page::after {
                    content: "";
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    opacity: 0.18;
                    mix-blend-mode: multiply;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
                }

                .container {
                    max-width: 1100px;
                    margin: 0 auto;
                    padding: 40px 32px 72px;
                }

                .topbar {
                    margin-bottom: 18px;
                }

                .topbar-inner {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 18px;
                    border-radius: 18px;
                    background: rgba(255, 255, 255, 0.8);
                    border: 1px solid rgba(31, 36, 40, 0.12);
                    backdrop-filter: blur(8px);
                }

                .topbar-title {
                    font-weight: 700;
                    font-size: 1.1rem;
                    letter-spacing: 0.02em;
                }

                .logout {
                    padding: 10px 18px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.2);
                    background: rgba(255, 255, 255, 0.7);
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }

                .logout:disabled {
                    cursor: default;
                    opacity: 0.7;
                    transform: none;
                    box-shadow: none;
                }

                .logout:not(:disabled):hover {
                    transform: translateY(-1px);
                    box-shadow: 0 8px 18px rgba(31, 36, 40, 0.14);
                }

                .filter-bar {
                    position: sticky;
                    top: 0;
                    z-index: 10;
                    width: 100%;
                    padding: 0;
                    backdrop-filter: blur(10px);
                    background: linear-gradient(
                            180deg,
                            rgba(247, 245, 242, 0.85),
                            rgba(247, 245, 242, 0.55)
                    );
                    border-bottom: 1px solid rgba(31, 36, 40, 0.08);
                }

                .filter-inner {
                    width: min(1040px, calc(100% - 32px));
                    margin: 0 auto;
                    padding: 20px 24px;
                    border-radius: 28px;
                    background: rgba(255, 255, 255, 0.75);
                    border: 1px solid rgba(31, 36, 40, 0.08);
                    box-shadow: none;
                }

                .filter-row {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 240px auto;
                    gap: 16px;
                    align-items: flex-end;
                }

                .field {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .field-search {
                    min-width: 0;
                }

                label {
                    font-size: 0.85rem;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                    color: #4b5157;
                    text-transform: uppercase;
                }

                input[type="search"],
                select {
                    width: 100%;
                    padding: 14px 20px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.15);
                    background: rgba(255, 255, 255, 0.85);
                    font-size: 0.95rem;
                    transition: border 0.2s ease, box-shadow 0.2s ease;
                    outline: none;
                }

                input[type="search"]:focus,
                select:focus {
                    border-color: rgba(31, 36, 40, 0.4);
                    box-shadow: 0 0 0 3px rgba(31, 36, 40, 0.12);
                }

                .reset {
                    align-self: flex-end;
                    padding: 14px 26px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.18);
                    background: rgba(255, 255, 255, 0.7);
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }

                .reset:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 10px 20px rgba(31, 36, 40, 0.12);
                }

                .results {
                    margin-top: 8px;
                    font-size: 0.9rem;
                    color: #4a4f55;
                }

                .header {
                    padding: 28px 0 36px;
                }

                .header h1 {
                    margin: 0 0 8px;
                    font-size: clamp(2rem, 4vw, 3rem);
                }

                .header p {
                    margin: 0;
                    color: #4a4f55;
                }

                .grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 24px;
                }

                .card {
                    border: none;
                    display: flex;
                    flex-direction: column;
                    background: rgba(255, 255, 255, 0.7);
                    border-radius: 20px;
                    border: 1px solid rgba(31, 36, 40, 0.08);
                    box-shadow: 0 18px 50px rgba(31, 36, 40, 0.08);
                    overflow: hidden;
                    backdrop-filter: blur(8px);
                    text-align: left;
                    cursor: pointer;
                    padding: 0;
                    min-height: 100%;
                }

                .card.is-new {
                    animation: card-fade-in 0.5s ease both;
                }

                @keyframes card-fade-in {
                    from {
                        opacity: 0;
                        transform: translateY(6px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .card:focus-visible {
                    outline: 3px solid rgba(47, 109, 246, 0.55);
                    outline-offset: 3px;
                }

                .image-wrap {
                    width: 100%;
                    aspect-ratio: 4 / 3;
                    overflow: hidden;
                    background: #e7ebf2;
                    position: relative;
                    contain: layout paint;
                }

                .image-wrap img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                }

                .card-body {
                    padding: 16px 20px 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .card-description {
                    margin: 0;
                    color: #3f4650;
                    font-size: 0.95rem;
                    line-height: 1.4;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    min-height: 3.6em;
                }

                .card-footer {
                    padding: 10px 20px 18px;
                    font-size: 0.82rem;
                    color: #6a7178;
                    border-top: 1px solid rgba(31, 36, 40, 0.08);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .state {
                    padding: 24px 0;
                    font-weight: 600;
                }

                .empty {
                    padding: 56px 28px;
                    text-align: center;
                    background: rgba(255, 255, 255, 0.65);
                    border-radius: 20px;
                    border: 1px solid rgba(31, 36, 40, 0.08);
                }

                .empty h2 {
                    margin: 0 0 8px;
                    font-size: 1.5rem;
                }

                .empty p {
                    margin: 0;
                    color: #4a4f55;
                }

                .load-more {
                    display: flex;
                    justify-content: center;
                    padding: 28px 0 0;
                }

                .load-more-button {
                    padding: 12px 20px;
                    border-radius: 999px;
                    border: 1px solid rgba(31, 36, 40, 0.18);
                    background: rgba(255, 255, 255, 0.85);
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                }

                .load-more-button:disabled {
                    cursor: default;
                    opacity: 0.7;
                    transform: none;
                    box-shadow: none;
                }

                .load-more-button:not(:disabled):hover {
                    transform: translateY(-1px);
                    box-shadow: 0 10px 20px rgba(31, 36, 40, 0.12);
                }

                .spinner {
                    width: 16px;
                    height: 16px;
                    border-radius: 999px;
                    border: 2px solid rgba(31, 36, 40, 0.2);
                    border-top-color: rgba(31, 36, 40, 0.6);
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }

                .modal-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(31, 36, 40, 0.4);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    z-index: 30;
                }

                .modal {
                    width: min(920px, 100%);
                    max-height: 90vh;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 24px;
                    border: 1px solid rgba(31, 36, 40, 0.1);
                    box-shadow: 0 30px 80px rgba(31, 36, 40, 0.25);
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    overflow: hidden;
                }

                .modal-close {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    width: 38px;
                    height: 38px;
                    border-radius: 999px;
                    border: none;
                    background: rgba(31, 36, 40, 0.08);
                    color: #1f2428;
                    font-size: 1.5rem;
                    cursor: pointer;
                }

                .modal-close:focus-visible {
                    outline: 3px solid rgba(47, 109, 246, 0.55);
                    outline-offset: 2px;
                }

                .modalImageWrap {
                    width: 100%;
                    max-height: 60vh;
                    max-width: 90vw;
                    flex: 0 0 auto;
                    background: #f3f4f6;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto;
                    padding: 16px 16px 0;
                }

                .modalImageWrap img {
                    width: auto;
                    height: auto;
                    max-height: 60vh;
                    max-width: 90vw;
                    object-fit: contain;
                    display: block;
                }

                .modal-body {
                    padding: 18px 28px 28px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    overflow: hidden;
                }

                .modalDescription {
                    max-height: 25vh;
                    overflow-y: auto;
                    padding: 14px;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    background: rgba(255, 255, 255, 0.8);
                    border-radius: 12px;
                    border: 1px solid rgba(31, 36, 40, 0.1);
                    color: #3a4046;
                }

                @media (max-width: 900px) {
                    .grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                }

                @media (max-width: 680px) {
                    .container {
                        padding: 24px 16px 48px;
                    }

                    .topbar-inner {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 10px;
                    }

                    .filter-inner {
                        width: min(1040px, calc(100% - 20px));
                        padding: 16px 16px;
                    }

                    .filter-row {
                        grid-template-columns: 1fr;
                        align-items: stretch;
                    }

                    .reset {
                        width: 100%;
                    }

                    .header {
                        padding: 22px 0 28px;
                    }

                    .card-body {
                        padding: 14px 16px 8px;
                    }

                    .card-footer {
                        padding: 8px 16px 14px;
                    }

                    .grid {
                        grid-template-columns: 1fr;
                    }

                    .modal {
                        max-height: 92vh;
                    }

                    .modal-body {
                        padding: 16px 18px 22px;
                    }
                }
            `}</style>
        </div>
    )
}
