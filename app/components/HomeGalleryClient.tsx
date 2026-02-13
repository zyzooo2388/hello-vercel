"use client"

type ImageRow = {
    id: number | string
    url: string
    image_description: string | null
}

type HomeGalleryClientProps = {
    initialImages: ImageRow[]
    errorMessage?: string | null
}

export default function HomeGalleryClient({
    initialImages,
    errorMessage = null,
}: HomeGalleryClientProps) {
    if (errorMessage) {
        return <div>Failed to load images: {errorMessage}</div>
    }

    if (initialImages.length === 0) {
        return <div>No images yet.</div>
    }

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 20,
            }}
        >
            {initialImages.map((img) => (
                <div
                    key={img.id}
                    style={{
                        border: "1px solid #e3e6ea",
                        borderRadius: 16,
                        overflow: "hidden",
                        background: "#fff",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.04)",
                    }}
                >
                    <div style={{ aspectRatio: "4 / 3", overflow: "hidden" }}>
                        <img
                            src={img.url}
                            alt=""
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                            }}
                        />
                    </div>
                    <div style={{ padding: 14 }}>
                        <p style={{ margin: 0 }}>
                            {img.image_description?.trim()
                                ? img.image_description
                                : "No description"}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    )
}
